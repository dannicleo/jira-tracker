#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Jira Tracker — Script de Setup
#  Pré-requisitos: Node.js 18+, Rust, Xcode Command Line Tools
# ─────────────────────────────────────────────────────────────

set -e

echo "🚀 Configurando Jira Tracker..."

# Verifica dependências
command -v node >/dev/null 2>&1 || { echo "❌ Node.js não encontrado. Instale em https://nodejs.org"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "❌ Rust não encontrado. Instale em https://rustup.rs"; exit 1; }

echo "✅ Node.js $(node -v)"
echo "✅ Rust $(rustc --version)"

# Instala dependências npm
echo ""
echo "📦 Instalando dependências npm..."
npm install

# Gera ícones placeholder se não existirem
if [ ! -f "src-tauri/icons/icon.icns" ]; then
  echo ""
  echo "🎨 Gerando ícones placeholder..."
  mkdir -p src-tauri/icons

  # Cria um ícone PNG simples via sips (macOS nativo)
  # Em produção, substitua por ícones reais
  if command -v sips >/dev/null 2>&1; then
    # Cria um PNG mínimo (1x1 pixel azul como placeholder)
    python3 -c "
import struct, zlib

def create_png(width, height, color=(0, 82, 204)):
    def write_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr = write_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += bytes(color)

    idat = write_chunk(b'IDAT', zlib.compress(raw))
    iend = write_chunk(b'IEND', b'')
    return signature + ihdr + idat + iend

for size in [16, 32, 128]:
    with open(f'src-tauri/icons/{size}x{size}.png', 'wb') as f:
        f.write(create_png(size, size))
    with open(f'src-tauri/icons/{size}x{size}@2x.png', 'wb') as f:
        f.write(create_png(size*2, size*2))

with open('src-tauri/icons/tray-icon.png', 'wb') as f:
    f.write(create_png(22, 22, (0, 0, 0)))  # preto para template
"
    echo "   ℹ️  Ícones placeholder criados. Substitua por ícones reais antes de distribuir."
  fi
fi

echo ""
echo "✅ Setup concluído!"
echo ""
echo "─────────────────────────────────────────────────────"
echo "  Para rodar em desenvolvimento:"
echo "  $ npm run tauri dev"
echo ""
echo "  Para fazer o build:"
echo "  $ npm run tauri build"
echo ""
echo "  Configure suas credenciais Jira na primeira execução:"
echo "  1. Clique no ícone na barra de menu"
echo "  2. Acesse Configurações (ícone de engrenagem)"
echo "  3. Preencha: Base URL, Email e API Token"
echo "─────────────────────────────────────────────────────"
