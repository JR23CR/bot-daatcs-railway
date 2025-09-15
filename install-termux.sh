#!/bin/bash

# =========================
# Bot DAATCS - Instalador para Termux
# =========================

echo "🤖 Instalador Bot DAATCS para Termux"
echo "====================================="

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Verificar si estamos en Termux
if [ ! -d "/data/data/com.termux" ]; then
    print_error "Este script debe ejecutarse en Termux"
    exit 1
fi

print_status "Detectado entorno Termux correctamente"

# Paso 1: Configurar storage
echo ""
echo "📁 Paso 1: Configurando acceso a storage..."
if [ ! -d "$HOME/storage" ]; then
    termux-setup-storage
    print_status "Storage configurado"
else
    print_warning "Storage ya configurado"
fi

# Paso 2: Actualizar paquetes
echo ""
echo "📦 Paso 2: Actualizando paquetes del sistema..."
apt update && apt upgrade -y
print_status "Paquetes actualizados"

# Paso 3: Instalar dependencias básicas
echo ""
echo "🔧 Paso 3: Instalando dependencias básicas..."
pkg install -y nodejs npm git python

# Verificar instalación de Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_status "Node.js instalado: $NODE_VERSION"
else
    print_error "Error instalando Node.js"
    exit 1
fi

# Paso 4: Instalar dependencias adicionales para WhatsApp
echo ""
echo "📱 Paso 4: Instalando dependencias para WhatsApp..."
pkg install -y chromium

# Configurar variables de entorno para Puppeteer
echo ""
echo "🔧 Configurando variables de entorno..."
echo 'export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true' >> ~/.bashrc
echo 'export PUPPETEER_EXECUTABLE_PATH=`which chromium-browser`' >> ~/.bashrc
source ~/.bashrc

print_status "Variables de entorno configuradas"

# Paso 5: Clonar repositorio (si no existe)
echo ""
echo "📂 Paso 5: Obteniendo código del bot..."

BOT_DIR="$HOME/bot-daatcs"

if [ -d "$BOT_DIR" ]; then
    print_warning "Directorio del bot ya existe, actualizando..."
    cd "$BOT_DIR"
    git pull origin main
else
    print_status "Clonando repositorio..."
    cd "$HOME"
    git clone https://github.com/JR23CR/bot-daatcs-railway.git bot-daatcs
    cd "$BOT_DIR"
fi

# Paso 6: Instalar dependencias del bot
echo ""
echo "📦 Paso 6: Instalando dependencias del bot..."
npm install

if [ $? -eq 0 ]; then
    print_status "Dependencias instaladas correctamente"
else
    print_error "Error instalando dependencias"
    exit 1
fi

# Paso 7: Crear directorios necesarios
echo ""
echo "📁 Paso 7: Creando estructura de directorios..."
mkdir -p database
mkdir -p auth_data
mkdir -p logs

print_status "Directorios creados"

# Paso 8: Configurar PM2 para mantener el bot activo
echo ""
echo "🔄 Paso 8: Configurando PM2 para mantener bot activo..."
npm install -g pm2

print_status "PM2 instalado"

# Crear script de inicio
cat > start-bot.sh << 'EOF'
#!/bin/bash
cd ~/bot-daatcs
echo "🤖 Iniciando Bot DAATCS..."
echo "📱 El código QR aparecerá en unos segundos..."
echo "=================================="
node bot.js
EOF

chmod +x start-bot.sh

# Paso 9: Crear scripts útiles
echo ""
echo "📜 Paso 9: Creando scripts útiles..."

# Script para iniciar con PM2
cat > start-pm2.sh << 'EOF'
#!/bin/bash
cd ~/bot-daatcs
termux-wake-lock
pm2 start bot.js --name "daatcs-bot"
pm2 save
echo "🤖 Bot DAATCS iniciado con PM2"
echo "📊 Ver logs: pm2 logs daatcs-bot"
echo "🛑 Detener: pm2 stop daatcs-bot"
EOF

chmod +x start-pm2.sh

# Script para regenerar QR
cat > regenerate-qr.sh << 'EOF'
#!/bin/bash
cd ~/bot-daatcs
echo "🔄 Regenerando código QR..."
rm -rf auth_data
node bot.js
EOF

chmod +x regenerate-qr.sh

# Script de backup
cat > backup-data.sh << 'EOF'
#!/bin/bash
cd ~/bot-daatcs
BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r database "$BACKUP_DIR/"
cp -r auth_data "$BACKUP_DIR/"
echo "💾 Backup creado en: $BACKUP_DIR"
EOF

chmod +x backup-data.sh

print_status "Scripts útiles creados"

# Paso 10: Información final
echo ""
echo "🎉 INSTALACIÓN COMPLETADA EXITOSAMENTE"
echo "======================================"
echo ""
echo "📱 Para iniciar el bot:"
echo "   cd ~/bot-daatcs"
echo "   ./start-bot.sh"
echo ""
echo "🔄 Para mantener activo 24/7:"
echo "   ./start-pm2.sh"
echo ""
echo "📱 Para regenerar QR:"
echo "   ./regenerate-qr.sh"
echo ""
echo "💾 Para hacer backup:"
echo "   ./backup-data.sh"
echo ""
echo "📊 Comandos PM2 útiles:"
echo "   pm2 logs daatcs-bot    # Ver logs"
echo "   pm2 stop daatcs-bot    # Detener bot"
echo "   pm2 start daatcs-bot   # Iniciar bot"
echo "   pm2 restart daatcs-bot # Reiniciar bot"
echo ""
echo "🔗 URLs importantes (cuando el bot esté activo):"
echo "   http://localhost:3000     # Estado del bot"
echo "   http://localhost:3000/qr  # Código QR"
echo ""
print_status "Bot DAATCS listo para usar en Termux! 🚀"
echo ""
echo "🏭 DAATCS - Sistema de Gestión de Pedidos"
