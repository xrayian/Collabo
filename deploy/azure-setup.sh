#!/usr/bin/env bash
set -e

# ==============================================================================
# Collabo — Microsoft Azure (Azure for Students) Automated Setup Script
# ==============================================================================

echo "=== [1/6] Configuring 4GB Swap Space (Protects against OOM on B1s 1GB VMs) ==="
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  echo "Swapfile created and activated successfully."
else
  echo "Swapfile already exists. Skipping."
fi

echo "=== [2/6] Updating packages and installing prerequisites ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git dnsutils

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

echo "=== [5/6] Detecting Public IP and Configuring Domain ==="
# Attempt to fetch public IP from Azure Instance Metadata Service (IMDS)
PUBLIC_IP=$(curl -s -H Metadata:true --noproxy "*" "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text" 2>/dev/null || true)

if [ -z "$PUBLIC_IP" ] || [[ "$PUBLIC_IP" =~ "error" ]]; then
  PUBLIC_IP=$(curl -s ifconfig.me)
fi

# Detect domain: User override -> Azure reverse DNS FQDN -> nip.io fallback
if [ -n "$DOMAIN" ]; then
  APP_DOMAIN="$DOMAIN"
else
  # Check if an Azure DNS name label is configured on the Public IP
  DETECTED_FQDN=$(getent hosts "$PUBLIC_IP" 2>/dev/null | awk '{print $2}' || true)
  if [[ -z "$DETECTED_FQDN" ]]; then
    DETECTED_FQDN=$(nslookup "$PUBLIC_IP" 2>/dev/null | awk -F'= ' '/name =/ {print $2}' | sed 's/\.$//' || true)
  fi

  if [[ "$DETECTED_FQDN" =~ \.cloudapp\.azure\.com$ ]]; then
    APP_DOMAIN="$DETECTED_FQDN"
  else
    APP_DOMAIN="${PUBLIC_IP}.nip.io"
  fi
fi

cat <<EOF > /opt/collabo/.env
PORT=3000
NODE_ENV=production
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP}
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
DOMAIN=${APP_DOMAIN}
EOF

echo "Public IP: ${PUBLIC_IP}"
echo "Configured Domain: ${APP_DOMAIN}"

echo "=== [6/6] Launching Collabo Container Stack ==="
docker compose down || true
docker compose up -d --build

echo "=================================================================="
echo "🎉 Collabo is now running live on Azure!"
echo "Access URL: https://${APP_DOMAIN}"
echo "(Note: Port 3000 is internal and reverse-proxied via HTTPS on port 443)"
echo "=================================================================="
