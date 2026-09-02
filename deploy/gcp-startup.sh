#!/usr/bin/env bash
set -e

# ==============================================================================
# Collabo — Google Cloud Platform (GCP) Compute Engine Automated Startup Script
# ==============================================================================

echo "=== [1/5] Updating packages and installing prerequisites ==="
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git

echo "=== [2/5] Installing Docker and Docker Compose ==="
mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "=== [3/5] Cloning Collabo repository ==="
if [ ! -d "/opt/collabo" ]; then
  git clone https://github.com/xrayian/Collabo.git /opt/collabo
else
  cd /opt/collabo && git pull origin main
fi

cd /opt/collabo

echo "=== [4/5] Detecting Public IP and Configuring Environment ==="
# Fetch public IP from GCP metadata server
PUBLIC_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || curl -s ifconfig.me)

cat <<EOF > /opt/collabo/.env
PORT=3000
NODE_ENV=production
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP}
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
DOMAIN=${DOMAIN:-${PUBLIC_IP}.nip.io}
EOF

echo "Public IP detected: ${PUBLIC_IP}"
echo "Collabo domain configured: ${DOMAIN:-${PUBLIC_IP}.nip.io}"

echo "=== [5/5] Launching Collabo Container Stack ==="
docker compose down || true
docker compose up -d --build

echo "=================================================================="
echo "🎉 Collabo is now running live on Google Cloud!"
echo "Access URL: http://${PUBLIC_IP}:3000 or https://${DOMAIN:-${PUBLIC_IP}.nip.io}"
echo "=================================================================="
