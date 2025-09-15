#!/data/data/com.termux/files/usr/bin/bash

# Instalador Bot DAATCS para Termux
# Ejecutar: chmod +x install-termux.sh && ./install-termux.sh

echo "🤖 Bot DAATCS - Instalador Termux"
echo "================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar que estamos en Termux
if [[ ! -d "/data/data/com.termux" ]]; then
    print_error "Este script es solo para Termux"
    exit 1
fi

print_status "Iniciando instalación en Termux..."

# 1. Actualizar Termux
print_status "Actualizando paquetes de Termux..."
pkg update -y && pkg upgrade -y

# 2. Instalar dependencias básicas
print_status "Instalando dependencias básicas..."
pkg install -y nodejs git python

# Verificar Node.js
NODE_VERSION=$(node --version)
print_success "Node.js instalado: $NODE_VERSION"

# 3. Instalar dependencias para WhatsApp Web
print_status "Configurando para WhatsApp Web..."

# En Termux no necesitamos todas las librerías del sistema
# pero sí configurar correctamente

# 4. Instalar dependencias de Node.js
print_status "Instalando dependencias de Node.js..."
if [ -f "package.json" ]; then
    npm install
    print_success "Dependencias instaladas"
else
    print_error "No se encontró package.json"
    exit 1
fi

# 5. Crear directorios necesarios
print_status "Creando directorios..."
mkdir -p logs data auth_data

# 6. Configurar permisos de almacenamiento (importante para Termux)
print_status "Configurando permisos de almacenamiento..."
if ! ls ~/storage >/dev/null 2>&1; then
    print_warning "Configurando acceso a almacenamiento..."
    termux-setup-storage
fi

# 7. Verificar configuración
print_status "Verificando configuración..."

if [ -f "bot.js" ]; then
    print_success "bot.js encontrado"
else
    print_error "bot.js no encontrado"
fi

if [ -d "node_modules" ]; then
    print_success "node_modules instalado"
else
    print_error "Problemas con node_modules"
fi

# 8. Crear script de inicio específico para Termux
cat > start-termux.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

echo "🤖 Iniciando Bot DAATCS en Termux..."

# Verificar dependencias
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias faltantes..."
    npm install
fi

# Crear logs si no existen
mkdir -p logs data auth_data

# Mostrar información
echo "📱 Ejecutando en: $(uname -o)"
echo "🔧 Node.js: $(node --version)"
echo "📂 Directorio: $(pwd)"
echo ""

# Iniciar bot
echo "🚀 Iniciando bot..."
node bot.js

EOF

chmod +x start-termux.sh

# 9. Mostrar información final
print_success "¡Instalación completada!"
echo ""
echo "📱 Bot DAATCS configurado para Termux"
echo "📁 Directorio actual: $(pwd)"
echo "🔧 Node.js: $NODE_VERSION"
echo ""
echo "🚀 Para iniciar el bot:"
echo "   ./start-termux.sh"
echo "   # o"
echo "   node bot.js"
echo ""
echo "📋 Comandos útiles en Termux:"
echo "   pkg update          # Actualizar Termux"
echo "   npm install         # Reinstalar dependencias"
echo "   ls -la              # Ver archivos"
echo "   pwd                 # Ver directorio actual"
echo ""
echo "⚠️  IMPORTANTE:"
echo "   1. Usa WhatsApp Business en tu teléfono"
echo "   2. Mantén Termux abierto mientras el bot funciona"
echo "   3. El QR aparecerá en la terminal"
echo "   4. Crea grupo 'PEDIDOS DAATCS' en WhatsApp"
echo ""
echo "🔧 Para desarrollo:"
echo "   git add ."
echo "   git commit -m 'mensaje'"
echo "   git push origin main"
echo ""
print_success "¡Bot listo para Termux!"
