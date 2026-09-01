# Collabo — Production Hosting & Deployment Plan

This guide outlines the complete infrastructure, network requirements, deployment procedures, and cost analysis for hosting the Collabo platform in production.

---

## 1. Infrastructure Architecture & Constraints

```
                                [ Public Internet ]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
         TCP 443 (HTTPS / WSS)                       UDP 40000–49999 (RTP)
                   │                                           │
         ┌─────────▼─────────┐                       ┌─────────▼─────────┐
         │   Reverse Proxy   │                       │   mediasoup SFU   │
         │  (Caddy / Nginx)  │                       │  (C++ Worker RTP) │
         └─────────┬─────────┘                       └─────────┬─────────┘
                   │                                           │
         ┌─────────▼───────────────────────────────────────────▼─────────┐
         │                    Collabo Node.js Host Server                │
         │         - Next.js Web App (SSR, Landing, Join, Room)          │
         │         - WebSocket Signaling Server (Presence & Drawing)     │
         │         - In-Memory Room & Peer Manager                       │
         └───────────────────────────────────────────────────────────────┘
```

### Critical Infrastructure Constraint (Why Serverless Fails)
- **mediasoup is NOT serverless-compatible:** It requires persistent C++ worker subprocesses running on a long-lived OS kernel.
- **UDP Port Ranges:** WebRTC audio and video packets are transmitted over UDP ports (default: `40000–49999`). Cloudflare Proxy (orange cloud) and standard HTTP edge proxies drop non-HTTP traffic.
- **WebSockets:** Persistent bidirectional TCP connections are needed for sub-millisecond drawing and signaling sync.

---

## 2. Recommended Hosting Providers

| Provider | Recommended Tier | Specs | Est. Cost / Mo | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud** *(Top Pick)* | CPX31 / CCX13 | 4 vCPU, 8GB RAM, 20TB Traffic | **~$15–$25** | Best price-to-performance, generous unmetered bandwidth |
| **DigitalOcean** | Dedicated Droplet | 4 vCPU (CPU-Optimized), 8GB RAM | **~$48** | Easy setup, reliable global datacenters |
| **AWS EC2** | `c6i.xlarge` / `c7g.xlarge` | 4 vCPU, 8GB RAM | **~$70–$100** + Bandwidth | Enterprise compliance, AWS ecosystem integration |
| **Fly.io / Railway** | Dedicated App with UDP | 4 vCPU, 8GB RAM, Public IPv4 | **~$35–$50** | Managed container workflows with open UDP ports |

---

## 3. Network & Firewall Configuration

Configure your cloud provider's firewall / security group with the following rules:

| Protocol | Port / Range | Source | Purpose |
| :--- | :--- | :--- | :--- |
| **TCP** | `80` | `0.0.0.0/0` | HTTP (Redirects to HTTPS via Caddy / Let's Encrypt) |
| **TCP** | `443` | `0.0.0.0/0` | HTTPS (Next.js) & WSS (WebSocket Signaling) |
| **UDP** | `40000–49999` | `0.0.0.0/0` | **mediasoup WebRTC RTP media streams** |
| **UDP/TCP** | `3478`, `49152–65535` | `0.0.0.0/0` | coturn STUN/TURN fallback server (optional) |
| **TCP** | `22` | Your IP only | Secure SSH administration |

> [!IMPORTANT]
> If using **Cloudflare DNS**, keep the record for your media domain set to **DNS Only (Grey Cloud)** so that WebRTC UDP traffic on ports 40000–49999 reaches your server directly.

---

## 4. Production Deployment Methods

### Method A: Docker Compose Deployment (Recommended)

#### 1. `Dockerfile`
```dockerfile
FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ gcc libssl-dev

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm run build:electron

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y python3 make g++ gcc && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app ./

EXPOSE 3000
EXPOSE 40000-49999/udp

CMD ["npm", "start"]
```

#### 2. `docker-compose.yml`
```yaml
version: '3.8'

services:
  collabo:
    build: .
    restart: always
    network_mode: "host" # Allows direct binding to announced public IP for WebRTC
    environment:
      - PORT=3000
      - MEDIASOUP_LISTEN_IP=0.0.0.0
      - MEDIASOUP_ANNOUNCED_IP=YOUR_SERVER_PUBLIC_IP
      - MEDIASOUP_MIN_PORT=40000
      - MEDIASOUP_MAX_PORT=49999
      - NODE_ENV=production

  caddy:
    image: caddy:2-alpine
    restart: always
    network_mode: "host"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

#### 3. `Caddyfile` (Automatic HTTPS & Reverse Proxy)
```caddyfile
collabo.yourdomain.com {
    reverse_proxy localhost:3000
}
```

---

### Method B: Native Systemd + Node.js Deployment

#### 1. Provision Server
```bash
# Update Ubuntu/Debian packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl build-essential python3 git

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Caddy web server
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

#### 2. Clone & Build
```bash
git clone https://github.com/your-username/collabo.git /opt/collabo
cd /opt/collabo
npm ci
npm run build
npm run build:electron
```

#### 3. Systemd Service (`/etc/systemd/system/collabo.service`)
```ini
[Unit]
Description=Collabo Screen-Draw & SFU Platform
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/collabo
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=MEDIASOUP_LISTEN_IP=0.0.0.0
Environment=MEDIASOUP_ANNOUNCED_IP=203.0.113.10
Environment=MEDIASOUP_MIN_PORT=40000
Environment=MEDIASOUP_MAX_PORT=49999
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now collabo
```

---

## 5. Desktop App Distribution & Auto-Updates

To distribute the presenter application (**Collabo Desktop**):

### 1. Build Distributables
```bash
npm run build:dist
```
This produces:
- **Windows:** `release/Collabo Setup 1.0.0.exe` (NSIS) and `release/Collabo 1.0.0.exe` (Portable).
- **macOS:** `release/Collabo-1.0.0.dmg`.
- **Linux:** `release/Collabo-1.0.0.AppImage` and `.deb`.

### 2. Hosting Download Artifacts
Host the compiled installation binaries on:
- **GitHub Releases:** Directly integrated with `electron-updater`.
- **Cloudflare R2 / AWS S3:** Low-cost storage bucket (e.g. `https://downloads.collabo.app/releases/...`).

### 3. Code Signing Requirements
- **Windows:** Sign with an EV Code Signing Certificate or **Azure Trusted Signing** to eliminate Windows SmartScreen warnings.
- **macOS:** Sign with an **Apple Developer ID Application** certificate and submit to Apple Notary Service (`xcrun notarytool`).

---

## 6. Sizing, Bandwidth & Capacity Planning

| Metric | Per 10-Person Room | 10 Concurrent Rooms (100 Users) | 50 Concurrent Rooms (500 Users) |
| :--- | :--- | :--- | :--- |
| **CPU Usage** | ~5–10% of 1 core | ~1–2 cores | ~4–6 cores |
| **RAM Usage** | ~120 MB | ~1.2 GB | ~5 GB |
| **Inbound Bandwidth** | ~2.5 Mbps (1 screen + 10 mic audio) | ~25 Mbps | ~125 Mbps |
| **Outbound Bandwidth** | ~18 Mbps (9 viewers @ 2 Mbps) | ~180 Mbps | ~900 Mbps |
| **Monthly Egress (100 hrs/mo)**| ~800 GB | ~8 TB | ~40 TB |

> [!TIP]
> **Hetzner Cloud** includes 20 TB of free outbound traffic per month, making it capable of running 25+ simultaneous 10-person meetings around the clock at under $25/month.
