# Hosting Collabo on Google Cloud Platform (GCP)

This guide walks you through deploying the Collabo Web & Mediasoup SFU platform to **Google Compute Engine (GCE)** in under 5 minutes.

---

## Why Google Compute Engine (VM) instead of Cloud Run?

WebRTC media servers (**mediasoup**) require:
1. **Direct UDP port routing (`40000–49999`)** for low-latency RTP audio and video packet transmission.
2. **Persistent C++ worker subprocesses** that remain in memory across calls.

*Cloud Run only supports HTTP/gRPC traffic and drops raw UDP WebRTC streams. A lightweight GCE VM (e.g. `e2-medium` or `e2-standard-2`) is the ideal, production-grade choice on GCP.*

---

## 🚀 Fast Track: 1-Click Deployment via Google Cloud Shell

Open the [Google Cloud Console](https://console.cloud.google.com/) and click the **Cloud Shell (`>_`)** icon in the top-right toolbar. Paste the following commands:

### Step 1: Set Your Project and Region
```bash
# Set your GCP Project ID
gcloud config set project YOUR_PROJECT_ID

# Define your preferred zone (e.g., us-central1-a, europe-west1-b)
export ZONE="us-central1-a"
```

---

### Step 2: Create GCP Firewall Rules for WebRTC & HTTP/S
```bash
# 1. Allow HTTP (80) & HTTPS (443)
gcloud compute firewall-rules create allow-collabo-web \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=collabo-server

# 2. Allow Mediasoup WebRTC UDP RTP Ports (40000-49999)
gcloud compute firewall-rules create allow-collabo-webrtc \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=udp:40000-49999 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=collabo-server
```

---

### Step 3: Launch Compute Engine VM with Auto-Startup Script
```bash
gcloud compute instances create collabo-instance \
    --zone=$ZONE \
    --machine-type=e2-standard-2 \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --tags=collabo-server,http-server,https-server \
    --metadata=startup-script-url=https://raw.githubusercontent.com/xrayian/Collabo/main/deploy/gcp-startup.sh
```

---

### Step 4: Get Your Live URL
```bash
# Retrieve the external IP address of your new instance:
gcloud compute instances describe collabo-instance \
    --zone=$ZONE \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

The startup script will automatically:
1. Install Docker & Compose.
2. Clone Collabo from GitHub.
3. Bind Mediasoup to your external GCP IP.
4. Launch the application stack on port 3000 with Caddy automatic SSL.

**Access your app immediately at:**
- `http://<YOUR_EXTERNAL_IP>:3000`
- Or `https://<YOUR_EXTERNAL_IP>.nip.io` (Auto SSL)

---

## 🖥️ Alternative: Deploying via GCP Web Console UI

If you prefer using the browser interface:

1. Go to **Compute Engine** > **VM instances** > **Create Instance**.
2. **Name:** `collabo-server`
3. **Machine Configuration:** `e2-standard-2` (2 vCPU, 8 GB RAM) or `e2-medium`.
4. **Boot Disk:** Click *Change* > Choose **Ubuntu 22.04 LTS** (30 GB standard disk).
5. **Firewall:** Check both:
   - ☑ *Allow HTTP traffic*
   - ☑ *Allow HTTPS traffic*
6. **Network Tag:** In *Networking* > *Network tags*, add `collabo-server`.
7. **Startup Script:** In *Management* > *Automation* > *Startup script*, paste:
   ```bash
   #!/bin/bash
   curl -sSL https://raw.githubusercontent.com/xrayian/Collabo/main/deploy/gcp-startup.sh | bash
   ```
8. Click **Create**.
9. Go to **VPC network** > **Firewall** > **Create Firewall Rule**:
   - **Name:** `allow-collabo-webrtc`
   - **Target tags:** `collabo-server`
   - **Source IPv4 ranges:** `0.0.0.0/0`
   - **Protocols and ports:** Specified protocols > `udp: 40000-49999`.

---

## 🔧 Managing & Inspecting Your Running Instance

To SSH into your instance from Cloud Shell or your local terminal:
```bash
gcloud compute ssh collabo-instance --zone=$ZONE
```

Check logs:
```bash
# View startup log
sudo journalctl -u google-startup-scripts.service -f

# View running Docker containers
sudo docker ps

# View live Collabo application logs
cd /opt/collabo && sudo docker compose logs -f collabo
```

---

## 💰 GCP Cost Estimate

| Resource | Configuration | Est. Monthly Cost |
| :--- | :--- | :--- |
| **GCE Instance (`e2-standard-2`)** | 2 vCPU, 8 GB RAM | ~$48 / month |
| **GCE Instance (`e2-medium` budget)**| 2 vCPU (burstable), 4 GB RAM | ~$24 / month |
| **Persistent Disk** | 30 GB Standard PD | ~$1.20 / month |
| **Egress Bandwidth** | First 100 GB Free, then $0.08/GB | Dependent on meeting hours |
