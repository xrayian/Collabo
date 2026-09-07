#!/usr/bin/env bash
set -e

# ==============================================================================
# Collabo — Oracle Cloud Infrastructure (OCI) Automated Setup Script
# ==============================================================================

echo "=== [1/6] Unblocking Oracle Cloud OS-level iptables firewall ==="
# OCI Ubuntu images block inbound non-SSH traffic by default in iptables
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p udp --dport 40000:49999 -j ACCEPT 2>/dev/null || true

echo "=== [2/6] Updating packages and installing prerequisites ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git iptables-persistent netfilter-persistent
netfilter-persistent save 2>/dev/null || true

echo "=== [3/6] Installing Docker and Docker Compose ==="
mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "=== [4/6] Cloning Collabo repository ==="
if [ ! -d "/opt/collabo" ]; then
  git clone https://github.com/xrayian/Collabo.git /opt/collabo
else
  cd /opt/collabo && git pull origin main
fi

cd /opt/collabo

echo "=== [5/6] Detecting Public IP and Configuring Environment ==="
PUBLIC_IP=$(curl -s ifconfig.me)

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

echo "=== [6/6] Launching Collabo Container Stack ==="
docker compose down || true
docker compose up -d --build

echo "=================================================================="
echo "🎉 Collabo is now running live on Oracle Cloud (Always Free)!"
echo "Access URL: https://${DOMAIN:-${PUBLIC_IP}.nip.io}"
echo "(Note: Port 3000 is internal and reverse-proxied via HTTPS on port 443)"
echo "=================================================================="
