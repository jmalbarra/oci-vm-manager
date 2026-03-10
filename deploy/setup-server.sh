#!/bin/bash
# Deploy OCI VM Manager al servidor y dejarlo corriendo.
# Uso: ./deploy/setup-server.sh [IP]
set -e
HOST="${1:-137.131.152.248}"
USER="${OCI_USER:-ubuntu}"
KEY="${OCI_SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"

echo "🖥️  Deploy OCI VM Manager → $USER@$HOST"
echo ""

# Crear directorio si no existe
ssh -i "$KEY" -o StrictHostKeyChecking=no "$USER@$HOST" "sudo mkdir -p /opt/oci-vm-manager && sudo chown $USER:$USER /opt/oci-vm-manager"

# Sync code
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  . "$USER@$HOST:/opt/oci-vm-manager/"

# Setup and start on server
ssh -i "$KEY" -o StrictHostKeyChecking=no "$USER@$HOST" << 'REMOTE'
set -e
cd /opt/oci-vm-manager
npm install --omit=dev
# Crear .env si no existe (desde env.server.example)
if [ ! -f .env ]; then
  if [ -f deploy/env.server.example ]; then
    cp deploy/env.server.example .env
    echo "⚠️  Creado .env desde plantilla. Revisá SESSION_SECRET y OCI_SSH_KEY_PATH."
  else
    echo "❌ Crear .env manualmente. Ver deploy/env.server.example"
    exit 1
  fi
fi
pm2 delete oci-vm-manager 2>/dev/null || true
pm2 start index.js --name oci-vm-manager
pm2 save
echo ""
echo "✅ OCI VM Manager corriendo en puerto 3080."
REMOTE

echo ""
echo "✅ Deploy listo. Ahora:"
echo "   1. Entrá a http://localhost:3080 (manager local)"
echo "   2. Verificá que oci-vm-manager.duckdns.org esté en la lista (puerto 3080)"
echo "   3. Clic en 'Desplegar a VM' para actualizar Caddy"
echo "   4. Entrá a https://oci-vm-manager.duckdns.org"
