#!/bin/bash

# Script de inicio universal para Bot DAATCS
# Funciona en: Termux, Linux, Railway

echo "🤖 Iniciando Bot DAATCS..."

# Detectar entorno
if [[ -d "/data/data/com.termux" ]]; then
    ENTORNO="termux"
    echo "📱 Ejecutando en Termux"
elif [[ -n "$RAILWAY_ENVIRONMENT" ]] || [[ -n "$PORT" ]]; then
    ENTORNO="railway"
    echo "☁️ Ejecutando en Railway"
else
    ENTORNO="local"
    echo "💻 Ejecutando en entorno local"
fi

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no encontrado"
    
    if [[ "$ENTORNO" == "termux" ]]; then
        echo "📦 Instalando Node.js en Termux..."
        pkg install nodejs -y
    else
        echo "Por favor instala Node.js"
        exit 1
    fi
fi

echo "🔧 Node.js: $(node --version)"

# Verificar dependencias
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Crear directorios necesarios
mkdir -p logs data auth_data

# Mostrar información del entorno
echo "📂 Directorio: $(pwd)"
echo "🌍 Entorno: $ENTORNO"

if [[ "$ENTORNO" == "railway" ]]; then
    echo "🌐 Puerto: ${PORT:-3000}"
    echo "📊 URL: ${RAILWAY_STATIC_URL:-'No disponible'}"
fi

echo ""
echo "🚀 Iniciando bot..."
echo "📱 El código QR aparecerá aquí abajo"
echo "⚠️  Usa WhatsApp Business para escanear"
echo ""

# Iniciar bot
node bot.js
