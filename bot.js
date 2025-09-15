const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// =========================
// CONFIGURACIÓN PRINCIPAL
// =========================

const config = {
    // Configuración de Railway vs Termux
    isRailway: process.env.RAILWAY_ENVIRONMENT === 'production',
    port: process.env.PORT || 3000,
    
    // Configuración del bot
    groupName: 'PEDIDOS DAATCS',
    maxMessages: process.env.NODE_ENV === 'production' ? 15 : 30, // Menos en Railway
    messageDelay: process.env.NODE_ENV === 'production' ? 5000 : 2000, // Más delay en Railway
    
    // Horarios de funcionamiento
    workingHours: {
        start: 6, // 6:00 AM
        end: 22   // 10:00 PM
    }
};

// =========================
// VARIABLES GLOBALES
// =========================

let client;
let botStatus = 'initializing';
let qrString = '';
let targetGroupId = null;
let messageCount = 0;
let lastReset = Date.now();

// Estadísticas
let stats = {
    messagesReceived: 0,
    messagesSent: 0,
    commandsExecuted: 0,
    startTime: new Date(),
    lastActivity: new Date(),
    errors: 0
};

// Base de datos de pedidos
let pedidosDB = {
    pedidos: [],
    nextId: 1,
    stats: { total: 0, activos: 0 }
};

// =========================
// SERVIDOR EXPRESS
// =========================

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rutas
app.get('/', (req, res) => {
    res.json({
        service: 'Bot DAATCS',
        status: botStatus,
        uptime: Math.floor((Date.now() - stats.startTime.getTime()) / 1000),
        environment: config.isRailway ? 'Railway' : 'Termux',
        stats: {
            ...stats,
            messagesInHour: messageCount,
            lastReset: new Date(lastReset).toISOString()
        },
        pedidos: {
            total: pedidosDB.pedidos.length,
            activos: pedidosDB.pedidos.filter(p => !['entregado', 'cancelado'].includes(p.estado)).length
        }
    });
});

app.get('/qr', (req, res) => {
    if (qrString) {
        // Para web (Railway)
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Bot DAATCS - Código QR</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial; text-align: center; padding: 20px; background: #f0f0f0; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                .qr { margin: 20px 0; }
                .info { color: #666; margin: 10px 0; }
                .status { padding: 10px; background: #e7f3ff; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Bot DAATCS</h1>
                <div class="status">
                    <strong>Estado:</strong> ${botStatus}<br>
                    <strong>Entorno:</strong> ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}
                </div>
                <div class="qr">
                    <div id="qrcode"></div>
                </div>
                <div class="info">
                    <p><strong>📱 Instrucciones:</strong></p>
                    <p>1. Abre <strong>WhatsApp Business</strong> (no WhatsApp normal)</p>
                    <p>2. Ve a <strong>Configuración → Dispositivos vinculados</strong></p>
                    <p>3. Toca <strong>"Vincular dispositivo"</strong></p>
                    <p>4. Escanea este código QR</p>
                    <p>⏰ El código expira en 20 segundos</p>
                </div>
            </div>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js"></script>
            <script>
                const qr = new QRious({
                    element: document.getElementById('qrcode'),
                    value: '${qrString}',
                    size: 300,
                    padding: 20
                });
                
                // Auto refresh cada 30 segundos
                setTimeout(() => location.reload(), 30000);
            </script>
        </body>
        </html>
        `);
    } else {
        res.send(`
        <html>
        <head><title>Bot DAATCS</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>🤖 Bot DAATCS</h1>
            <p>⏳ Generando código QR...</p>
            <p>Estado: ${botStatus}</p>
            <script>setTimeout(() => location.reload(), 5000);</script>
        </body>
        </html>
        `);
    }
});

app.get('/stats', (req, res) => {
    res.json({
        bot: stats,
        pedidos: {
            total: pedidosDB.pedidos.length,
            activos: pedidosDB.pedidos.filter(p => !['entregado', 'cancelado'].includes(p.estado)).length,
            porEstado: getEstadisticasEstados()
        },
        system: {
            uptime: Math.floor((Date.now() - stats.startTime.getTime()) / 1000),
            environment: config.isRailway ? 'Railway' : 'Termux',
            messagesInHour: messageCount,
            maxMessages: config.maxMessages
        }
    });
});

// =========================
// INICIALIZACIÓN DEL BOT
// =========================

async function initializeBot() {
    try {
        console.log('🚀 Iniciando Bot DAATCS...');
        console.log(`📍 Entorno: ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}`);
        
        // Cargar base de datos
        await loadDatabase();
        
        // Configurar cliente
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'bot-daatcs',
                dataPath: './auth_data'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--override-plugin-power-saver-for-testing=never',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees'
                ]
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            }
        });

        // Configurar eventos
        setupClientEvents();
        
        // Inicializar cliente
        await client.initialize();
        
        botStatus = 'connecting';
        
    } catch (error) {
        console.error('❌ Error inicializando bot:', error);
        botStatus = 'error';
        stats.errors++;
        
        // Reintentar en 30 segundos
        setTimeout(initializeBot, 30000);
    }
}

// =========================
// EVENTOS DEL CLIENTE
// =========================

function setupClientEvents() {
    
    // Evento QR - CRÍTICO PARA TERMUX
    client.on('qr', (qr) => {
        console.log('\n' + '='.repeat(50));
        console.log('📱 CÓDIGO QR PARA WHATSAPP BUSINESS');
        console.log('='.repeat(50));
        
        // MOSTRAR QR EN TERMINAL (Para Termux)
        qrcode.generate(qr, { small: true });
        
        console.log('='.repeat(50));
        console.log('✅ QR generado correctamente');
        console.log('');
        console.log('📲 INSTRUCCIONES:');
        console.log('1. Abre WhatsApp Business (NO WhatsApp normal)');
        console.log('2. Ve a Configuración → Dispositivos vinculados');
        console.log('3. Toca "Vincular dispositivo"');
        console.log('4. Escanea el código QR de arriba');
        console.log('');
        console.log('⏰ El código expira en 20 segundos');
        if (!config.isRailway) {
            console.log(`🌐 También disponible en: http://localhost:${config.port}/qr`);
        }
        console.log('='.repeat(50) + '\n');
        
        // Guardar QR para web
        qrString = qr;
        botStatus = 'waiting_for_qr';
    });

    // Conexión exitosa
    client.on('ready', async () => {
        console.log('✅ Bot conectado exitosamente!');
        botStatus = 'connected';
        
        try {
            // Buscar grupo objetivo
            await findTargetGroup();
            
            if (targetGroupId) {
                const chat = await client.getChatById(targetGroupId);
                const message = `🤖 *BOT DAATCS CONECTADO*\n\n✅ Estado: Activo\n🏠 Entorno: ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}\n⏰ ${new Date().toLocaleString()}\n\n💡 Usa */ayuda* para ver comandos disponibles`;
                
                await sendMessage(chat, message);
                console.log(`📋 Bot conectado al grupo: ${chat.name}`);
            } else {
                console.log('⚠️ Grupo "PEDIDOS DAATCS" no encontrado');
            }
            
        } catch (error) {
            console.error('❌ Error en ready:', error);
        }
    });

    // Manejo de mensajes
    client.on('message', handleMessage);

    // Eventos de error
    client.on('auth_failure', () => {
        console.error('❌ Error de autenticación');
        botStatus = 'auth_failed';
        stats.errors++;
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ Bot desconectado:', reason);
        botStatus = 'disconnected';
        
        // Reintentar conexión
        setTimeout(() => {
            console.log('🔄 Intentando reconectar...');
            initializeBot();
        }, 10000);
    });
}

// =========================
// MANEJO DE MENSAJES
// =========================

async function handleMessage(message) {
    try {
        stats.messagesReceived++;
        stats.lastActivity = new Date();
        
        // Verificar límites de tiempo y mensajes
        if (!isWorkingTime()) return;
        if (!checkMessageLimit()) return;
        
        const chat = await message.getChat();
        
        // Solo procesar grupos con "pedidos" y "daatcs"
        if (!chat.isGroup) return;
        
        const groupName = chat.name.toLowerCase();
        if (!groupName.includes('pedidos') || !groupName.includes('daatcs')) return;
        
        const body = message.body.trim();
        const contact = await message.getContact();
        const userName = contact.pushname || contact.number;
        
        console.log(`📩 ${userName}: ${body}`);
        
        // Procesar comandos
        if (body.startsWith('/') || body.startsWith('.') || body.startsWith('!')) {
            await handleCommand(body, chat, userName, message);
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
        stats.errors++;
    }
}

// =========================
// MANEJO DE COMANDOS
// =========================

async function handleCommand(command, chat, userName, message) {
    try {
        stats.commandsExecuted++;
        
        const args = command.slice(1).trim().split(' ');
        const cmd = args[0].toLowerCase();
        const params = args.slice(1).join(' ');
        
        // Delay anti-ban
        await delay(config.messageDelay);
        
        switch (cmd) {
            case 'ayuda':
            case 'help':
                await sendHelpMessage(chat);
                break;
                
            case 'nuevo':
            case 'pedido':
                if (params) {
                    await createNewOrder(chat, userName, message.author || message.from, params);
                } else {
                    await sendMessage(chat, '❌ *Formato incorrecto*\n\n📝 Uso: `/nuevo [descripción]`\n💡 Ejemplo: `/nuevo Camiseta M azul diseño personalizado`');
                }
                break;
                
            case 'lista':
            case 'pedidos':
                await showActiveOrders(chat);
                break;
                
            case 'estado':
                if (args.length >= 3) {
                    const isAdmin = await checkAdminPermissions(message);
                    if (isAdmin) {
                        await changeOrderStatus(chat, args[1], args.slice(2).join(' '), userName);
                    } else {
                        await sendMessage(chat, '❌ Solo administradores pueden cambiar estados de pedidos');
                    }
                } else {
                    await sendMessage(chat, '❌ *Formato incorrecto*\n\n📝 Uso: `/estado [ID] [nuevo_estado]`\n💡 Ejemplo: `/estado 001 confirmado`');
                }
                break;
                
            case 'info':
                if (params) {
                    await showOrderInfo(chat, params);
                } else {
                    await sendMessage(chat, '❌ *ID requerido*\n\n📝 Uso: `/info [ID]`\n💡 Ejemplo: `/info 001`');
                }
                break;
                
            case 'stats':
            case 'estadisticas':
                await showStats(chat);
                break;
                
            case 'salud':
            case 'status':
                await showBotHealth(chat);
                break;
                
            default:
                if (command.startsWith('/') || command.startsWith('.') || command.startsWith('!')) {
                    await sendMessage(chat, `❓ Comando no reconocido: \`${cmd}\`\n💡 Usa */ayuda* para ver comandos disponibles`);
                }
        }
        
    } catch (error) {
        console.error('❌ Error ejecutando comando:', error);
        await sendMessage(chat, '❌ Error ejecutando comando. Inténtalo de nuevo.');
        stats.errors++;
    }
}

// =========================
// FUNCIONES DE PEDIDOS
// =========================

async function createNewOrder(chat, userName, userPhone, description) {
    const order = {
        id: String(pedidosDB.nextId).padStart(3, '0'),
        descripcion: description,
        cliente: userName,
        telefono: userPhone.replace('@c.us', ''),
        estado: 'pendiente',
        fechaCreacion: new Date().toISOString(),
        fechaActualizacion: new Date().toISOString(),
        historial: [{
            estado: 'pendiente',
            fecha: new Date().toISOString(),
            usuario: 'Sistema'
        }]
    };
    
    pedidosDB.pedidos.push(order);
    pedidosDB.nextId++;
    pedidosDB.stats.total++;
    pedidosDB.stats.activos++;
    
    await saveDatabase();
    
    const message = `✅ *PEDIDO CREADO EXITOSAMENTE*

🆔 *ID:* #${order.id}
👤 *Cliente:* ${order.cliente}
📝 *Descripción:* ${order.descripcion}
📊 *Estado:* PENDIENTE
⏰ *Fecha:* ${new Date().toLocaleString()}

💡 *Próximos pasos:*
• Tu pedido será revisado por nuestro equipo
• Recibirás actualizaciones del estado
• Usa \`/info ${order.id}\` para ver detalles

🏭 *DAATCS - Tu pedido está en buenas manos*`;

    await sendMessage(chat, message);
}

async function showActiveOrders(chat) {
    const activeOrders = pedidosDB.pedidos.filter(p => !['entregado', 'cancelado'].includes(p.estado));
    
    if (activeOrders.length === 0) {
        await sendMessage(chat, '📋 *No hay pedidos activos*\n\n💡 Usa `/nuevo [descripción]` para crear un pedido');
        return;
    }
    
    let statsText = `📊 *ESTADÍSTICAS DAATCS*

⏰ *Tiempo activo:* ${hours}h ${minutes}m
📩 *Mensajes recibidos:* ${stats.messagesReceived}
📤 *Mensajes enviados:* ${stats.messagesSent}
🔧 *Comandos ejecutados:* ${stats.commandsExecuted}
❌ *Errores:* ${stats.errors}
🕐 *Última actividad:* ${formatDate(stats.lastActivity.toISOString())}

📋 *PEDIDOS:*
• Total: ${pedidosDB.pedidos.length}
• Activos: ${pedidosDB.pedidos.filter(p => !['entregado', 'cancelado'].includes(p.estado)).length}
• Entregados: ${estadisticas.entregado || 0}
• Cancelados: ${estadisticas.cancelado || 0}

📊 *POR ESTADO:*`;

    Object.entries(estadisticas).forEach(([estado, cantidad]) => {
        const emoji = getStatusEmoji(estado);
        statsText += `\n• ${emoji} ${estado}: ${cantidad}`;
    });

    statsText += `\n\n💻 *Sistema:* ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}
🔋 *Estado:* ${botStatus}
📈 *Límite/hora:* ${messageCount}/${config.maxMessages}

✅ Bot funcionando correctamente`;

    await sendMessage(chat, statsText);
}

async function showBotHealth(chat) {
    const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    const healthText = `🏥 *ESTADO DE SALUD DEL BOT*

✅ *Estado general:* ${botStatus}
⏰ *Tiempo activo:* ${hours}h ${minutes}m
💻 *Entorno:* ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}
📊 *Rendimiento:* ${stats.errors === 0 ? 'Óptimo' : 'Con errores'}
🔋 *Memoria:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
📡 *Conexión:* ${client && client.info ? 'Estable' : 'Verificando'}

📈 *Actividad última hora:*
• Mensajes procesados: ${messageCount}
• Comandos ejecutados: ${stats.commandsExecuted}
• Errores registrados: ${stats.errors}

🕐 *Horario de servicio:* ${config.workingHours.start}:00 - ${config.workingHours.end}:00
📱 *Grupo objetivo:* ${targetGroupId ? 'Conectado' : 'Buscando...'}

${isWorkingTime() ? '🟢 En horario de servicio' : '🟡 Fuera de horario'}`;

    await sendMessage(chat, healthText);
}

// =========================
// HEARTBEAT Y MANTENIMIENTO
// =========================

// Heartbeat para Railway
if (config.isRailway) {
    setInterval(async () => {
        try {
            console.log('💓 Heartbeat - Manteniendo servicio activo');
            const response = await fetch(`http://localhost:${config.port}/`);
            const data = await response.json();
            console.log(`📊 Estado: ${data.status}, Uptime: ${data.uptime}s`);
        } catch (error) {
            console.error('❌ Error en heartbeat:', error);
        }
    }, 25 * 60 * 1000); // Cada 25 minutos
}

// Limpieza de memoria periódica
setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Limpieza de memoria ejecutada');
    }
}, 30 * 60 * 1000); // Cada 30 minutos

// Backup de base de datos periódico
setInterval(async () => {
    try {
        const backupData = { ...pedidosDB, timestamp: new Date().toISOString() };
        const backupPath = path.join(__dirname, 'database', `backup-${Date.now()}.json`);
        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
        console.log('💾 Backup de base de datos creado');
        
        // Mantener solo los últimos 5 backups
        const backupDir = path.join(__dirname, 'database');
        const files = await fs.readdir(backupDir);
        const backups = files.filter(f => f.startsWith('backup-')).sort();
        
        if (backups.length > 5) {
            for (const old of backups.slice(0, -5)) {
                await fs.unlink(path.join(backupDir, old));
            }
        }
    } catch (error) {
        console.error('❌ Error creando backup:', error);
    }
}, 6 * 60 * 60 * 1000); // Cada 6 horas

// =========================
// INICIAR APLICACIÓN
// =========================

// Iniciar servidor web
const server = app.listen(config.port, () => {
    console.log('='.repeat(60));
    console.log('🤖 BOT DAATCS - INICIANDO');
    console.log('='.repeat(60));
    console.log(`🌐 Servidor web: http://localhost:${config.port}`);
    console.log(`📱 Código QR: http://localhost:${config.port}/qr`);
    console.log(`📊 Estadísticas: http://localhost:${config.port}/stats`);
    console.log(`💻 Entorno: ${config.isRailway ? 'Railway (Nube)' : 'Termux (Local)'}`);
    console.log(`🔧 Límite mensajes/hora: ${config.maxMessages}`);
    console.log(`🕐 Horario servicio: ${config.workingHours.start}:00 - ${config.workingHours.end}:00`);
    console.log('='.repeat(60));
});

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando bot de manera segura...');
    
    try {
        if (client) {
            await saveDatabase();
            await client.destroy();
            console.log('✅ Cliente WhatsApp cerrado');
        }
        
        if (server) {
            server.close(() => {
                console.log('✅ Servidor web cerrado');
            });
        }
        
        console.log('👋 Bot DAATCS finalizado correctamente');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error cerrando aplicación:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('🔄 Señal SIGTERM recibida - Railway redeploy');
    await saveDatabase();
    process.exit(0);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Error no manejado en Promise:', reason);
    stats.errors++;
});

process.on('uncaughtException', (error) => {
    console.error('❌ Excepción no capturada:', error);
    stats.errors++;
});

// Iniciar bot
console.log('⚡ Iniciando Bot DAATCS...');
initializeBot();

// Exportar para testing (opcional)
if (process.env.NODE_ENV === 'test') {
    module.exports = { app, client, stats, pedidosDB };
} message = '📋 *PEDIDOS ACTIVOS - DAATCS*\n\n';
    
    activeOrders.slice(0, 10).forEach(order => {
        const emoji = getStatusEmoji(order.estado);
        message += `${emoji} *#${order.id}* - ${order.cliente}\n`;
        message += `   📊 ${order.estado.toUpperCase()}\n`;
        message += `   📝 ${order.descripcion.substring(0, 40)}${order.descripcion.length > 40 ? '...' : ''}\n`;
        message += `   ⏰ ${formatDate(order.fechaActualizacion)}\n\n`;
    });
    
    if (activeOrders.length > 10) {
        message += `📊 *Mostrando 10 de ${activeOrders.length} pedidos activos*\n`;
    }
    
    message += `💡 Usa \`/info [ID]\` para ver detalles completos`;
    
    await sendMessage(chat, message);
}

async function changeOrderStatus(chat, orderId, newStatus, adminName) {
    const validStatuses = ['pendiente', 'confirmado', 'proceso', 'diseño', 'produccion', 'control', 'listo', 'entregado', 'cancelado', 'pausado'];
    
    if (!validStatuses.includes(newStatus.toLowerCase())) {
        await sendMessage(chat, `❌ *Estado inválido*\n\n📊 Estados disponibles:\n${validStatuses.join(', ')}`);
        return;
    }
    
    const order = pedidosDB.pedidos.find(p => p.id === orderId.padStart(3, '0'));
    
    if (!order) {
        await sendMessage(chat, `❌ *Pedido no encontrado*\n\nID: ${orderId}\n💡 Usa \`/lista\` para ver IDs válidos`);
        return;
    }
    
    const previousStatus = order.estado;
    order.estado = newStatus.toLowerCase();
    order.fechaActualizacion = new Date().toISOString();
    
    // Añadir al historial
    order.historial.push({
        estado: newStatus.toLowerCase(),
        fecha: new Date().toISOString(),
        usuario: adminName
    });
    
    // Actualizar estadísticas
    if (['entregado', 'cancelado'].includes(newStatus.toLowerCase()) && 
        !['entregado', 'cancelado'].includes(previousStatus)) {
        pedidosDB.stats.activos--;
    } else if (!['entregado', 'cancelado'].includes(newStatus.toLowerCase()) && 
               ['entregado', 'cancelado'].includes(previousStatus)) {
        pedidosDB.stats.activos++;
    }
    
    await saveDatabase();
    
    const message = `✅ *ESTADO ACTUALIZADO*

🆔 *Pedido:* #${order.id}
👤 *Cliente:* ${order.cliente}
📊 *Estado anterior:* ${previousStatus.toUpperCase()}
📊 *Estado nuevo:* ${newStatus.toUpperCase()}
👮 *Actualizado por:* ${adminName}
⏰ *Fecha:* ${new Date().toLocaleString()}

💡 El cliente será notificado automáticamente`;

    await sendMessage(chat, message);
    
    // Notificar al cliente si es posible
    await notifyCustomer(order, newStatus);
}

async function showOrderInfo(chat, orderId) {
    const order = pedidosDB.pedidos.find(p => p.id === orderId.padStart(3, '0'));
    
    if (!order) {
        await sendMessage(chat, `❌ *Pedido no encontrado*\n\nID: ${orderId}\n💡 Usa \`/lista\` para ver IDs válidos`);
        return;
    }
    
    let message = `📋 *INFORMACIÓN COMPLETA DEL PEDIDO*\n\n`;
    message += `🆔 *ID:* #${order.id}\n`;
    message += `👤 *Cliente:* ${order.cliente}\n`;
    message += `📱 *Teléfono:* ${order.telefono}\n`;
    message += `📊 *Estado actual:* ${order.estado.toUpperCase()}\n`;
    message += `📝 *Descripción:* ${order.descripcion}\n`;
    message += `⏰ *Creado:* ${formatDate(order.fechaCreacion)}\n`;
    message += `🔄 *Última actualización:* ${formatDate(order.fechaActualizacion)}\n\n`;
    
    message += `📊 *HISTORIAL DE ESTADOS:*\n`;
    [...order.historial].reverse().slice(0, 5).forEach(h => {
        const emoji = getStatusEmoji(h.estado);
        message += `${emoji} ${h.estado.toUpperCase()} - ${formatDate(h.fecha)}\n`;
        if (h.usuario) message += `   👤 ${h.usuario}\n`;
    });
    
    await sendMessage(chat, message);
}

// =========================
// FUNCIONES DE UTILIDAD
// =========================

async function sendMessage(chat, text) {
    try {
        messageCount++;
        stats.messagesSent++;
        await chat.sendMessage(text);
        console.log(`📤 Mensaje enviado: ${text.substring(0, 50)}...`);
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error);
        stats.errors++;
    }
}

async function findTargetGroup() {
    try {
        const chats = await client.getChats();
        const targetGroup = chats.find(chat => 
            chat.isGroup && 
            chat.name.toLowerCase().includes('pedidos') && 
            chat.name.toLowerCase().includes('daatcs')
        );
        
        if (targetGroup) {
            targetGroupId = targetGroup.id._serialized;
            return targetGroup;
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error buscando grupo:', error);
        return null;
    }
}

async function checkAdminPermissions(message) {
    try {
        const chat = await message.getChat();
        if (!chat.isGroup) return false;
        
        const participant = chat.participants.find(p => p.id._serialized === message.author);
        return participant && participant.isAdmin;
    } catch (error) {
        console.error('❌ Error verificando permisos:', error);
        return false;
    }
}

async function notifyCustomer(order, newStatus) {
    try {
        const customerJid = order.telefono + '@c.us';
        const notification = `🔔 *ACTUALIZACIÓN DE PEDIDO DAATCS*\n\n🆔 *ID:* #${order.id}\n📊 *Nuevo estado:* ${newStatus.toUpperCase()}\n⏰ ${new Date().toLocaleString()}\n\n💬 Para más información, contacta el grupo de pedidos`;
        
        await client.sendMessage(customerJid, notification);
        console.log(`📤 Cliente notificado: ${order.telefono}`);
    } catch (error) {
        console.log('❌ No se pudo notificar al cliente:', error.message);
    }
}

function isWorkingTime() {
    const hour = new Date().getHours();
    return hour >= config.workingHours.start && hour <= config.workingHours.end;
}

function checkMessageLimit() {
    const now = Date.now();
    
    // Reset contador cada hora
    if (now - lastReset > 3600000) {
        messageCount = 0;
        lastReset = now;
    }
    
    return messageCount < config.maxMessages;
}

function getStatusEmoji(status) {
    const emojis = {
        'pendiente': '⏳',
        'confirmado': '✅',
        'proceso': '🔄',
        'diseño': '🎨',
        'produccion': '🏭',
        'control': '🔍',
        'listo': '📦',
        'entregado': '🎁',
        'cancelado': '❌',
        'pausado': '⏸️'
    };
    return emojis[status] || '❓';
}

function formatDate(isoString) {
    return new Date(isoString).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getEstadisticasEstados() {
    const stats = {};
    pedidosDB.pedidos.forEach(order => {
        stats[order.estado] = (stats[order.estado] || 0) + 1;
    });
    return stats;
}

// =========================
// BASE DE DATOS
// =========================

async function loadDatabase() {
    try {
        const dbPath = path.join(__dirname, 'database', 'pedidos.json');
        const data = await fs.readFile(dbPath, 'utf8');
        pedidosDB = { ...pedidosDB, ...JSON.parse(data) };
        console.log('📊 Base de datos cargada');
    } catch (error) {
        console.log('📊 Creando nueva base de datos');
        await saveDatabase();
    }
}

async function saveDatabase() {
    try {
        const dbDir = path.join(__dirname, 'database');
        const dbPath = path.join(dbDir, 'pedidos.json');
        
        await fs.mkdir(dbDir, { recursive: true });
        await fs.writeFile(dbPath, JSON.stringify(pedidosDB, null, 2));
    } catch (error) {
        console.error('❌ Error guardando base de datos:', error);
    }
}

// =========================
// MENSAJES DEL SISTEMA
// =========================

async function sendHelpMessage(chat) {
    const helpText = `🤖 *BOT DAATCS - SISTEMA DE PEDIDOS*

📝 *COMANDOS PARA CLIENTES:*
• \`/nuevo [descripción]\` - Crear nuevo pedido
• \`/info [ID]\` - Ver detalles de pedido  
• \`/lista\` - Ver pedidos activos

👮 *COMANDOS PARA ADMINISTRADORES:*
• \`/estado [ID] [nuevo_estado]\` - Cambiar estado
• \`/stats\` - Ver estadísticas completas

📊 *ESTADOS DISPONIBLES:*
• pendiente, confirmado, proceso, diseño
• produccion, control, listo, entregado
• cancelado, pausado

💡 *EJEMPLOS:*
• \`/nuevo Camiseta talla M color azul\`
• \`/estado 001 confirmado\`
• \`/info 001\`

🕐 *Horario:* ${config.workingHours.start}:00 - ${config.workingHours.end}:00
🏭 *DAATCS - Sistema de Gestión de Pedidos*`;

    await sendMessage(chat, helpText);
}

async function showStats(chat) {
    const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    const estadisticas = getEstadisticasEstados();
    let
