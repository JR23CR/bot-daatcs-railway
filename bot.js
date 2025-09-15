const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');

class BotDAATCS_Railway {
    constructor() {
        // Configurar servidor Express para Railway
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.setupExpress();
        
        // Crear cliente con configuración optimizada para Railway
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './auth_data'
            }),
            puppeteer: {
                headless: 'new', // Usar nuevo modo headless
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-default-apps',
                    '--disable-background-networking',
                    '--disable-background-updates',
                    '--disable-client-side-phishing-detection',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--no-crash-upload',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                    '--single-process' // Importante para Railway
                ],
                timeout: 60000,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            }
        });
        
        // Configuración de seguridad anti-baneo
        this.LIMITE_MENSAJES_HORA = 15; // Reducido para Railway
        this.MIN_DELAY = 3000;  // 3 segundos mínimo (más conservador)
        this.MAX_DELAY = 7000;  // 7 segundos máximo
        this.HORA_INICIO = 6;   // 6 AM
        this.HORA_FIN = 22;     // 10 PM
        
        // Estado del bot
        this.isReady = false;
        this.lastHeartbeat = Date.now();
        this.qrCodeGenerated = false;
        this.currentQR = '';
        
        // Contadores de seguridad
        this.mensajesEnviados = {};
        this.ultimoMensaje = {};
        
        // Configuración del bot DAATCS
        this.grupoAutorizado = "PEDIDOS DAATCS";
        this.grupoId = null;
        
        // Base de datos (usar variables de entorno en Railway)
        this.pedidos = [];
        this.clientes = {};
        
        this.estadosPedidos = {
            'pendiente': '🟡 Pendiente',
            'confirmado': '🟢 Confirmado',
            'proceso': '🔄 En Proceso',
            'diseño': '🎨 En Diseño',
            'produccion': '⚙️ En Producción',
            'control': '🔍 Control de Calidad',
            'listo': '✅ Listo',
            'entregado': '📦 Entregado',
            'cancelado': '❌ Cancelado',
            'pausado': '⏸️ Pausado'
        };
        
        // Inicializar
        this.crearDirectorios();
        this.cargarDatosIniciales();
        this.inicializar();
        this.iniciarMantenimiento();
        this.iniciarServidor();
    }
    
    // === CONFIGURACIÓN PARA RAILWAY ===
    
    setupExpress() {
        this.app.use(express.json());
        
        // Ruta de salud para Railway
        this.app.get('/', (req, res) => {
            res.json({
                status: 'Bot DAATCS funcionando',
                ready: this.isReady,
                uptime: process.uptime(),
                lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
                qrGenerated: this.qrCodeGenerated,
                grupo: this.grupoId ? 'Conectado' : 'No encontrado'
            });
        });
        
        // Ruta para obtener QR (útil para Railway)
        this.app.get('/qr', (req, res) => {
            if (this.currentQR) {
                res.json({
                    qr: this.currentQR,
                    generated: this.qrCodeGenerated
                });
            } else {
                res.json({
                    message: 'No hay QR disponible o ya está autenticado',
                    ready: this.isReady
                });
            }
        });
        
        // Ruta para estadísticas
        this.app.get('/stats', (req, res) => {
            res.json({
                totalPedidos: this.pedidos.length,
                totalClientes: Object.keys(this.clientes).length,
                mensajesHoy: Object.values(this.mensajesEnviados).reduce((a, b) => a + b, 0),
                grupo: this.grupoId,
                uptime: process.uptime()
            });
        });
        
        // Webhook para mantener el bot activo
        this.app.post('/webhook', (req, res) => {
            this.lastHeartbeat = Date.now();
            res.json({ status: 'ok', timestamp: this.lastHeartbeat });
        });
    }
    
    iniciarServidor() {
        this.app.listen(this.port, '0.0.0.0', () => {
            this.log(`🌐 Servidor Express iniciado en puerto ${this.port}`, 'success');
        });
    }
    
    crearDirectorios() {
        const dirs = ['auth_data', 'data'];
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }
    
    cargarDatosIniciales() {
        try {
            // Cargar datos desde archivos si existen
            if (fs.existsSync('./data/pedidos.json')) {
                this.pedidos = JSON.parse(fs.readFileSync('./data/pedidos.json', 'utf8'));
            }
            if (fs.existsSync('./data/clientes.json')) {
                this.clientes = JSON.parse(fs.readFileSync('./data/clientes.json', 'utf8'));
            }
        } catch (error) {
            this.log(`⚠️ Error cargando datos iniciales: ${error.message}`, 'warning');
        }
    }
    
    guardarDatos() {
        try {
            fs.writeFileSync('./data/pedidos.json', JSON.stringify(this.pedidos, null, 2));
            fs.writeFileSync('./data/clientes.json', JSON.stringify(this.clientes, null, 2));
        } catch (error) {
            this.log(`❌ Error guardando datos: ${error.message}`, 'error');
        }
    }
    
    // === FUNCIONES DE SEGURIDAD ANTI-BANEO ===
    
    async enviarMensajeSeguro(chatId, mensaje, esUrgente = false) {
        try {
            // Verificar si es horario permitido (excepto urgentes)
            if (!esUrgente && !this.esHorarioPermitido()) {
                this.log('⏰ Mensaje fuera de horario', 'info');
                return false;
            }
            
            // Verificar límite de mensajes por hora
            if (!this.puedeEnviarMensaje(chatId)) {
                this.log(`⚠️ Límite de mensajes alcanzado`, 'warning');
                return false;
            }
            
            // Aplicar delay anti-baneo
            await this.aplicarDelayNatural(chatId);
            
            // Enviar mensaje
            const resultado = await this.client.sendMessage(chatId, mensaje);
            this.registrarMensajeEnviado(chatId);
            this.lastHeartbeat = Date.now();
            
            this.log(`✅ Mensaje enviado correctamente`, 'success');
            return resultado;
            
        } catch (error) {
            this.log(`❌ Error enviando mensaje: ${error.message}`, 'error');
            return false;
        }
    }
    
    esHorarioPermitido() {
        const hora = new Date().getHours();
        return hora >= this.HORA_INICIO && hora <= this.HORA_FIN;
    }
    
    puedeEnviarMensaje(chatId) {
        const horaActual = new Date().getHours();
        const clave = `${horaActual}`;
        
        if (!this.mensajesEnviados[clave]) {
            this.mensajesEnviados[clave] = 0;
        }
        
        return this.mensajesEnviados[clave] < this.LIMITE_MENSAJES_HORA;
    }
    
    async aplicarDelayNatural(chatId) {
        const ultimoMensaje = this.ultimoMensaje[chatId] || 0;
        const tiempoTranscurrido = Date.now() - ultimoMensaje;
        
        let delayMinimo = this.MIN_DELAY;
        if (tiempoTranscurrido < 30000) {
            delayMinimo = this.MIN_DELAY + 3000;
        }
        
        const delay = delayMinimo + Math.random() * (this.MAX_DELAY - delayMinimo);
        
        this.log(`⏳ Esperando ${Math.round(delay/1000)} segundos...`, 'info');
        await this.sleep(delay);
    }
    
    registrarMensajeEnviado(chatId) {
        const horaActual = new Date().getHours();
        const clave = `${horaActual}`;
        
        this.mensajesEnviados[clave] = (this.mensajesEnviados[clave] || 0) + 1;
        this.ultimoMensaje[chatId] = Date.now();
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // === SISTEMA DE LOGS OPTIMIZADO ===
    
    log(mensaje, tipo = 'info') {
        const timestamp = new Date().toISOString();
        
        const colores = {
            info: '\x1b[36m',
            success: '\x1b[32m',
            warning: '\x1b[33m',
            error: '\x1b[31m',
            reset: '\x1b[0m'
        };
        
        console.log(`${colores[tipo]}[${timestamp}] ${mensaje}${colores.reset}`);
        
        // En Railway, los logs van a stdout automáticamente
        // No necesitamos archivos de log locales
    }
    
    // === MANTENIMIENTO AUTOMÁTICO PARA RAILWAY ===
    
    iniciarMantenimiento() {
        // Limpiar contadores cada hora
        setInterval(() => {
            this.limpiarContadores();
        }, 60 * 60 * 1000);
        
        // Heartbeat cada 25 minutos para evitar sleep de Railway
        setInterval(() => {
            this.enviarHeartbeat();
        }, 25 * 60 * 1000);
        
        // Guardar datos cada 10 minutos
        setInterval(() => {
            this.guardarDatos();
        }, 10 * 60 * 1000);
        
        this.log('🔧 Mantenimiento para Railway iniciado', 'success');
    }
    
    enviarHeartbeat() {
        this.lastHeartbeat = Date.now();
        this.log('💓 Heartbeat - Bot activo', 'info');
        
        // Hacer una petición a sí mismo para mantenerse activo
        if (process.env.RAILWAY_STATIC_URL) {
            fetch(`${process.env.RAILWAY_STATIC_URL}/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ heartbeat: true })
            }).catch(() => {}); // Ignorar errores
        }
    }
    
    limpiarContadores() {
        const horaActual = new Date().getHours();
        const clavesAnteriores = Object.keys(this.mensajesEnviados).filter(
            clave => parseInt(clave) !== horaActual
        );
        
        clavesAnteriores.forEach(clave => {
            delete this.mensajesEnviados[clave];
        });
        
        this.log(`🧹 Contadores limpiados: ${clavesAnteriores.length}`, 'info');
    }
    
    // === INICIALIZACIÓN PARA RAILWAY ===
    
    inicializar() {
        // QR Code mejorado para Railway
        this.client.on('qr', (qr) => {
            this.currentQR = qr;
            this.qrCodeGenerated = true;
            
            console.log('\n🔍 CÓDIGO QR - Bot DAATCS (Railway):');
            qrcode.generate(qr, { small: true });
            console.log('\n⚠️  IMPORTANTE: Usa WhatsApp Business');
            console.log(`🌐 También disponible en: ${process.env.RAILWAY_STATIC_URL || 'localhost:' + this.port}/qr`);
            console.log('📱 Escanea este QR con WhatsApp Business\n');
        });
        
        // Bot conectado
        this.client.on('ready', async () => {
            this.isReady = true;
            this.qrCodeGenerated = false;
            this.currentQR = '';
            
            this.log('🤖 Bot DAATCS conectado en Railway!', 'success');
            await this.encontrarGrupo();
            
            if (this.grupoId && this.esHorarioPermitido()) {
                setTimeout(async () => {
                    await this.enviarMensajeBienvenida();
                }, 5000);
            }
        });
        
        // Manejar desconexiones
        this.client.on('disconnected', (reason) => {
            this.isReady = false;
            this.log(`🔌 Bot desconectado: ${reason}`, 'warning');
        });
        
        // Manejar errores
        this.client.on('auth_failure', (msg) => {
            this.isReady = false;
            this.log(`❌ Error de autenticación: ${msg}`, 'error');
        });
        
        // Procesar mensajes
        this.client.on('message', async (message) => {
            try {
                await this.procesarMensaje(message);
            } catch (error) {
                this.log(`❌ Error procesando mensaje: ${error.message}`, 'error');
            }
        });
        
        // Inicializar cliente con manejo de errores
        this.client.initialize().catch(error => {
            this.log(`❌ Error inicializando cliente: ${error.message}`, 'error');
        });
    }
    
    async encontrarGrupo() {
        try {
            await this.sleep(3000);
            
            const chats = await this.client.getChats();
            const grupo = chats.find(chat => 
                chat.isGroup && 
                chat.name.toLowerCase().includes('pedidos daatcs')
            );
            
            if (grupo) {
                this.grupoId = grupo.id._serialized;
                this.log(`✅ Grupo encontrado: ${grupo.name}`, 'success');
            } else {
                this.log('❌ Grupo "PEDIDOS DAATCS" no encontrado', 'error');
                this.log('Grupos disponibles:', 'info');
                chats.filter(chat => chat.isGroup).forEach(chat => {
                    console.log(`  - ${chat.name}`);
                });
            }
        } catch (error) {
            this.log(`❌ Error buscando grupo: ${error.message}`, 'error');
        }
    }
    
    async enviarMensajeBienvenida() {
        const mensaje = `
🤖 *Bot DAATCS Online (Railway)* 

Sistema optimizado para la nube ☁️
Horario: ${this.HORA_INICIO}:00 - ${this.HORA_FIN}:00
Límite: ${this.LIMITE_MENSAJES_HORA} msg/hora

Escribe \`/ayuda\` para comandos disponibles.`;

        await this.enviarMensajeSeguro(this.grupoId, mensaje, true);
    }
    
    // === PROCESAMIENTO DE MENSAJES ===
    
    async procesarMensaje(message) {
        if (!message.from.includes('@g.us')) return;
        if (!this.grupoId || message.from !== this.grupoId) return;
        if (message.fromMe) return;
        
        const texto = message.body.trim();
        const autor = await message.getContact();
        const nombreAutor = autor.pushname || autor.name || 'Usuario';
        
        this.log(`📩 Mensaje de ${nombreAutor}: ${texto.substring(0, 30)}...`, 'info');
        
        if (texto.startsWith('/')) {
            await this.procesarComando(message, texto, nombreAutor);
        }
    }
    
    async procesarComando(message, comando, autor) {
        const partes = comando.split(' ');
        const cmd = partes[0].toLowerCase();
        const args = partes.slice(1);
        
        let respuesta = '';
        
        try {
            switch (cmd) {
                case '/ayuda':
                case '/help':
                    respuesta = this.generarAyuda();
                    break;
                case '/lista':
                    respuesta = this.generarListaPedidos();
                    break;
                case '/stats':
                    respuesta = this.generarEstadisticas();
                    break;
                case '/estado':
                    if (args.length >= 2) {
                        respuesta = this.cambiarEstado(args[0], args[1], autor);
                    } else {
                        respuesta = '❌ Uso: `/estado [ID] [nuevo_estado]`';
                    }
                    break;
                case '/salud':
                    respuesta = this.verificarSaludBot();
                    break;
                case '/railway':
                    respuesta = this.infoRailway();
                    break;
                default:
                    return;
            }
            
            if (respuesta) {
                await this.enviarMensajeSeguro(message.from, respuesta);
            }
        } catch (error) {
            this.log(`❌ Error procesando comando ${cmd}: ${error.message}`, 'error');
        }
    }
    
    generarAyuda() {
        return `
📖 *COMANDOS BOT DAATCS (Railway)*

🔧 *Principales:*
• \`/lista\` - Ver pedidos activos
• \`/stats\` - Estadísticas  
• \`/estado [ID] [estado]\` - Cambiar estado
• \`/salud\` - Estado del bot
• \`/railway\` - Info del servidor

🛡️ *Configuración:*
• Horario: ${this.HORA_INICIO}:00 - ${this.HORA_FIN}:00
• Límite: ${this.LIMITE_MENSAJES_HORA} msg/hora
• Servidor: Railway Cloud ☁️

🤖 Bot optimizado anti-baneo`;
    }
    
    verificarSaludBot() {
        const uptime = Math.floor(process.uptime() / 60);
        const memoria = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        
        return `
💚 *ESTADO DEL BOT (Railway)*

🔌 Conexión: ${this.isReady ? 'CONECTADO' : 'DESCONECTADO'}
⏰ Tiempo activo: ${uptime} minutos
💾 Memoria: ${memoria} MB
📊 Mensajes hoy: ${Object.values(this.mensajesEnviados).reduce((a, b) => a + b, 0)}
☁️ Servidor: Railway
🌐 Puerto: ${this.port}

Sistema funcionando correctamente ✅`;
    }
    
    infoRailway() {
        return `
☁️ *INFORMACIÓN RAILWAY*

🌐 URL: ${process.env.RAILWAY_STATIC_URL || 'No disponible'}
🆔 ID: ${process.env.RAILWAY_SERVICE_ID || 'Local'}
📊 Stats: ${process.env.RAILWAY_STATIC_URL || 'localhost:' + this.port}/stats
🔍 QR: ${process.env.RAILWAY_STATIC_URL || 'localhost:' + this.port}/qr

Bot ejecutándose en la nube 🚀`;
    }
    
    generarListaPedidos() {
        if (this.pedidos.length === 0) {
            return '📋 No hay pedidos registrados.';
        }
        
        const pedidosActivos = this.pedidos.filter(p => 
            !['entregado', 'cancelado'].includes(p.estado)
        );
        
        if (pedidosActivos.length === 0) {
            return '📋 No hay pedidos activos.';
        }
        
        let mensaje = `📋 *PEDIDOS ACTIVOS (${pedidosActivos.length})*\n\n`;
        
        pedidosActivos.slice(-10).forEach(pedido => {
            mensaje += `🆔 *${pedido.id}* | ${this.estadosPedidos[pedido.estado]}\n`;
            mensaje += `👤 ${pedido.cliente?.nombre || 'Sin nombre'}\n`;
            mensaje += `📦 ${pedido.producto} x${pedido.cantidad}\n`;
            mensaje += `💰 $${pedido.total || 0}\n`;
            mensaje += `─────────────\n`;
        });
        
        return mensaje;
    }
    
    cambiarEstado(idPedido, nuevoEstado, autor) {
        const pedido = this.pedidos.find(p => 
            p.id.toLowerCase() === idPedido.toLowerCase()
        );
        
        if (!pedido) {
            return `❌ No se encontró el pedido: ${idPedido}`;
        }
        
        if (!this.estadosPedidos[nuevoEstado.toLowerCase()]) {
            const estadosDisponibles = Object.keys(this.estadosPedidos).join(', ');
            return `❌ Estado no válido. Disponibles: ${estadosDisponibles}`;
        }
        
        const estadoAnterior = pedido.estado;
        pedido.estado = nuevoEstado.toLowerCase();
        
        if (!pedido.historial) pedido.historial = [];
        pedido.historial.push({
            fecha: new Date().toISOString(),
            estado: nuevoEstado.toLowerCase(),
            usuario: autor
        });
        
        this.guardarDatos();
        
        return `
✅ *ESTADO ACTUALIZADO*

🆔 *Pedido:* ${pedido.id}
👤 *Cliente:* ${pedido.cliente?.nombre || 'Sin nombre'}
📊 *Estado:* ${this.estadosPedidos[estadoAnterior]} → ${this.estadosPedidos[nuevoEstado.toLowerCase()]}
👨‍💼 *Por:* ${autor}`;
    }
    
    generarEstadisticas() {
        const total = this.pedidos.length;
        const ingresos = this.pedidos.reduce((sum, p) => sum + (p.total || 0), 0);
        
        const hoy = new Date().toDateString();
        const pedidosHoy = this.pedidos.filter(p => 
            new Date(p.fecha_creacion || p.fecha || 0).toDateString() === hoy
        ).length;
        
        const uptime = Math.floor(process.uptime() / 60);
        
        return `
📊 *ESTADÍSTICAS DAATCS (Railway)*

📈 *Resumen:*
• Total pedidos: ${total}
• Ingresos: $${ingresos.toLocaleString()}
• Pedidos hoy: ${pedidosHoy}
• Tiempo activo: ${uptime} min

☁️ *Servidor:*
• Plataforma: Railway
• Estado: ${this.isReady ? 'Online' : 'Offline'}
• Puerto: ${this.port}

🛡️ Sistema anti-baneo activo
📅 ${new Date().toLocaleString()}`;
    }
}

// Manejo de errores optimizado para Railway
process.on('uncaughtException', (error) => {
    console.error('💥 Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Promesa rechazada:', reason);
});

// Función de cierre limpio
function cierreLimpio() {
    console.log('\n👋 Cerrando bot DAATCS (Railway)...');
    process.exit(0);
}

process.on('SIGINT', cierreLimpio);
process.on('SIGTERM', cierreLimpio);

// Iniciar el bot
console.log('🚀 Iniciando Bot DAATCS en Railway...');
console.log('☁️ Optimizaciones para Railway activadas:');
console.log('  - Servidor Express integrado');
console.log('  - Heartbeat automático');
console.log('  - Puppeteer optimizado para contenedores');
console.log('  - Gestión de memoria mejorada');
console.log('  - Logs a stdout\n');

const bot = new BotDAATCS_Railway();

module.exports = BotDAATCS_Railway;