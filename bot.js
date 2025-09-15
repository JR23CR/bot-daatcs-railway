const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');

// Variables globales
let client;
let botStatus = 'disconnected';
let qrString = '';
let stats = {
    messagesReceived: 0,
    messagesSent: 0,
    startTime: new Date(),
    lastActivity: new Date()
};

// Configurar Express (opcional para Termux)
const app = express();
const PORT = process.env.PORT || 3000;

// Endpoints web (opcional)
app.get('/', (req, res) => {
    res.json({
        status: botStatus,
        uptime: Date.now() - stats.startTime,
        stats: stats
    });
});

app.get('/qr', (req, res) => {
    if (qrString) {
        res.send(`<pre>${qrString}</pre>`);
    } else {
        res.send('QR no disponible');
    }
});

// Inicializar cliente WhatsApp
function initializeBot() {
    console.log('🚀 Iniciando Bot DAATCS para Termux...');
    
    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'bot-daatcs'
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
                '--disable-gpu'
            ]
        }
    });

    // Evento QR - MOSTRAR EN TERMINAL
    client.on('qr', (qr) => {
        console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP BUSINESS:\n');
        
        // Mostrar QR en terminal (Termux)
        qrcode.generate(qr, { small: true });
        
        // Guardar QR para web (opcional)
        qrString = qr;
        
        console.log('\n✅ QR generado correctamente');
        console.log('📲 Abre WhatsApp Business > Dispositivos vinculados > Vincular dispositivo');
        console.log('⏰ El QR expira en 20 segundos, refresca si es necesario\n');
    });

    // Evento de conexión exitosa
    client.on('ready', async () => {
        console.log('✅ Bot conectado exitosamente!');
        botStatus = 'connected';
        
        // Buscar grupo PEDIDOS DAATCS
        const chats = await client.getChats();
        const targetGroup = chats.find(chat => 
            chat.isGroup && 
            chat.name.toLowerCase().includes('pedidos') && 
            chat.name.toLowerCase().includes('daatcs')
        );

        if (targetGroup) {
            console.log(`📋 Grupo encontrado: ${targetGroup.name}`);
            await targetGroup.sendMessage('🤖 Bot DAATCS conectado y listo!\nUsa /ayuda para ver comandos disponibles.');
        } else {
            console.log('⚠️  Grupo "PEDIDOS DAATCS" no encontrado');
            console.log('💡 Crea un grupo con ese nombre y agrega el bot');
        }
    });

    // Manejo de mensajes
    client.on('message', async (message) => {
        try {
            stats.messagesReceived++;
            stats.lastActivity = new Date();

            // Solo responder en grupos con "pedidos" y "daatcs"
            const chat = await message.getChat();
            if (!chat.isGroup) return;
            
            const groupName = chat.name.toLowerCase();
            if (!groupName.includes('pedidos') || !groupName.includes('daatcs')) return;

            const body = message.body.toLowerCase().trim();
            const contact = await message.getContact();
            const userName = contact.pushname || contact.number;

            console.log(`📩 Mensaje de ${userName}: ${message.body}`);

            // Comandos del bot
            if (body.startsWith('/')) {
                await handleCommand(body, chat, userName, message);
            }
        } catch (error) {
            console.error('❌ Error procesando mensaje:', error);
        }
    });

    // Eventos de error
    client.on('auth_failure', () => {
        console.error('❌ Error de autenticación');
        botStatus = 'auth_failed';
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️  Bot desconectado:', reason);
        botStatus = 'disconnected';
    });

    // Inicializar cliente
    client.initialize();
}

// Manejar comandos
async function handleCommand(command, chat, userName, message) {
    try {
        const args = command.split(' ');
        const cmd = args[0];

        // Delay para evitar ban
        await delay(2000);

        switch (cmd) {
            case '/ayuda':
            case '/help':
                await sendHelpMessage(chat);
                break;

            case '/stats':
                await sendStatsMessage(chat);
                break;

            case '/estado':
                if (args.length >= 3) {
                    await handleEstadoCommand(chat, args[1], args.slice(2).join(' '));
                } else {
                    await chat.sendMessage('❌ Uso: /estado [ID] [nuevo_estado]\nEjemplo: /estado 001 confirmado');
                }
                break;

            case '/lista':
                await chat.sendMessage('📋 *PEDIDOS ACTIVOS*\n\n🔄 Función en desarrollo...\nPronto podrás ver todos los pedidos activos aquí.');
                break;

            case '/salud':
                await chat.sendMessage(`🏥 *ESTADO DEL BOT*\n\n✅ Estado: ${botStatus}\n⏰ Activo desde: ${stats.startTime.toLocaleString()}\n📨 Mensajes procesados: ${stats.messagesReceived}\n📤 Mensajes enviados: ${stats.messagesSent}`);
                break;

            case '/termux':
                await chat.sendMessage('📱 *BOT EN TERMUX*\n\n✅ Ejecutándose localmente\n🔋 Depende de tu dispositivo\n💡 Mantén Termux activo\n📶 Verifica tu conexión');
                break;

            default:
                if (command.startsWith('/')) {
                    await chat.sendMessage(`❓ Comando no reconocido: ${cmd}\nUsa /ayuda para ver comandos disponibles`);
                }
        }

        stats.messagesSent++;
    } catch (error) {
        console.error('❌ Error ejecutando comando:', error);
        await chat.sendMessage('❌ Error ejecutando comando. Inténtalo de nuevo.');
    }
}

// Mensajes de ayuda
async function sendHelpMessage(chat) {
    const helpText = `🤖 *BOT DAATCS - COMANDOS*

📋 *GESTIÓN DE PEDIDOS:*
• /lista - Ver pedidos activos
• /estado [ID] [estado] - Cambiar estado
• /stats - Estadísticas del bot

🔧 *SISTEMA:*
• /ayuda - Esta ayuda
• /salud - Estado del bot
• /termux - Info del entorno

📊 *ESTADOS DISPONIBLES:*
• pendiente, confirmado, proceso
• diseño, produccion, control
• listo, entregado, cancelado

💡 *EJEMPLO:*
/estado 001 confirmado

🚀 Bot optimizado para Termux`;

    await chat.sendMessage(helpText);
}

// Mensaje de estadísticas
async function sendStatsMessage(chat) {
    const uptime = Date.now() - stats.startTime;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);

    const statsText = `📊 *ESTADÍSTICAS BOT DAATCS*

⏰ *Tiempo activo:* ${hours}h ${minutes}m
📩 *Mensajes recibidos:* ${stats.messagesReceived}
📤 *Mensajes enviados:* ${stats.messagesSent}
🕐 *Última actividad:* ${stats.lastActivity.toLocaleString()}
💻 *Entorno:* Termux Local
🔋 *Estado:* ${botStatus}

✅ Bot funcionando correctamente`;

    await chat.sendMessage(statsText);
}

// Manejar cambio de estado
async function handleEstadoCommand(chat, pedidoId, nuevoEstado) {
    const estadosValidos = [
        'pendiente', 'confirmado', 'proceso', 'diseño',
        'produccion', 'control', 'listo', 'entregado',
        'cancelado', 'pausado'
    ];

    if (!estadosValidos.includes(nuevoEstado.toLowerCase())) {
        await chat.sendMessage(`❌ Estado inválido: ${nuevoEstado}\n\n📋 Estados válidos:\n${estadosValidos.join(', ')}`);
        return;
    }

    // Aquí se integraría con base de datos real
    const mensaje = `✅ *ESTADO ACTUALIZADO*\n\n🆔 Pedido: ${pedidoId}\n📊 Nuevo estado: ${nuevoEstado}\n⏰ ${new Date().toLocaleString()}\n👤 Actualizado por sistema`;
    
    await chat.sendMessage(mensaje);
}

// Función de delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Iniciar servidor web (opcional para Termux)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🌐 Servidor web corriendo en puerto ${PORT}`);
        console.log(`📱 QR disponible en: http://localhost:${PORT}/qr`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando bot...');
    if (client) {
        await client.destroy();
    }
    process.exit(0);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Error no manejado:', reason);
});

// Iniciar bot
console.log('🤖 Bot DAATCS - Versión Termux');
console.log('📱 Optimizado para mostrar QR en terminal');
console.log('⚡ Iniciando...\n');

initializeBot();
