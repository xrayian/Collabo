# Hosting Collabo on Azure for Students

This guide walks you through deploying Collabo to **Microsoft Azure** using an **Azure for Students** subscription.

---

## 1. Azure for Students Overview & VM Sizing

**Azure for Students** includes:
- **$100 credit** (renewable annually with university/school email, no credit card required).
- **12 Months of Popular Free Services**, including **750 hours/month of a B1s Linux VM** (runs 24/7 without consuming credits).
- **100 GB free monthly internet egress bandwidth**.
- **Free Azure DNS hostname** (e.g. `collabo-meeting.eastus.cloudapp.azure.com`) with automatic Let's Encrypt SSL via Caddy.

### Recommended VM Sizes

| VM Size | Specs | Cost Under Student Tier | Recommendation |
| :--- | :--- | :--- | :--- |
| **`Standard_B2s`** | **2 vCPU, 4 GiB RAM** | ~$30 / month *(covered by $100 credit)* | ⭐ **Best Performance.** Fast builds, seamless multi-user SFU video routing. |
| **`Standard_B1s`** | **1 vCPU, 1 GiB RAM** | **Free for 12 months** *(750 hrs/mo allowance)* | 💡 **100% Free Option.** Requires swap memory (our setup script automatically configures a 4 GB swapfile so Next.js build never runs out of memory). |

---

## 2. Step 1: Create the Virtual Machine in Azure Portal

1. Log into the [Azure Portal](https://portal.azure.com/).
2. In the top search bar, search for **Virtual machines** and click **Create** > **Azure virtual machine**.
3. Under the **Basics** tab:
   - **Subscription:** Select `Azure for Students`.
   - **Resource Group:** Click *Create new* > enter `rg-collabo`.
   - **Virtual machine name:** `collabo-server`
   - **Region:** Choose a region close to you (e.g., `East US`, `West Europe`, `Southeast Asia`).
   - **Availability options:** *No infrastructure redundancy required*.
   - **Security type:** *Standard*.
   - **Image:** Choose **Ubuntu Server 22.04 LTS - x64 Gen2** (or 24.04 LTS).
   - **Size:**
     - Select **`Standard_B2s`** (recommended) OR click *See all sizes* and pick **`Standard_B1s`** (for the 12-month free allowance).
4. **Administrator account:**
   - **Authentication type:** SSH public key.
   - **Username:** `azureuser`
   - **SSH public key source:** *Generate new key pair* (download when prompted) or *Use existing key*.
5. **Inbound port rules:**
   - Public inbound ports: Select **Allow selected ports**.
   - Select: **SSH (22)**, **HTTP (80)**, **HTTPS (443)**.
6. Click **Review + create**, then click **Create**. Wait 1–2 minutes for deployment to complete.

---

## 3. Step 2: Open Ingress Ports in Network Security Group (NSG)

WebRTC RTP media streams (audio and screen video) require UDP port range `40000–49999`.

1. In the Azure Portal, navigate to your newly created VM (`collabo-server`).
2. In the left navigation menu under **Settings**, click **Networking** (or **Network settings**).
3. Under the **Inbound port rules** tab, click **Add inbound port rule**:
   - **Source:** `Any`
   - **Source port ranges:** `*`
   - **Destination:** `Any`
   - **Service:** `Custom`
   - **Destination port ranges:** `40000-49999`
   - **Protocol:** `UDP`
   - **Action:** `Allow`
   - **Priority:** `310` (or any available number between 100–4096)
   - **Name:** `Allow_Mediasoup_WebRTC_UDP`
   - **Description:** `Mediasoup WebRTC audio and video RTP streams`
4. Click **Add**.

---

## 4. Step 3: Assign a Free Azure DNS Domain Name (Recommended)

Azure allows you to assign a permanent, free DNS subdomain name to your VM's public IP address. Caddy will use this to automatically provision a valid Let's Encrypt SSL certificate!

1. On your VM overview page in the Azure Portal, click the link next to **Public IP address** (e.g., `collabo-server-ip`).
2. In the left menu, click **Configuration**.
3. Under **DNS name label (optional)**, enter a unique subdomain name, such as:
   ```
   my-collabo-meeting
   ```
4. Click **Save**.
5. Your VM now has a fully qualified domain name (FQDN):
   ```
   my-collabo-meeting.<region>.cloudapp.azure.com
   ```

---

## 5. Step 4: ⚡ 1-Command Automated Setup

Connect to your VM via SSH:

```bash
ssh -i /path/to/private-key.pem azureuser@<YOUR_VM_PUBLIC_IP_OR_DNS>
```

Run the automated Azure setup script:

```bash
curl -sSL https://raw.githubusercontent.com/xrayian/Collabo/main/deploy/azure-setup.sh | sudo bash
```

### What this script automatically does:
1. **Configures 4 GB Swap Memory:** Guarantees that even on `B1s` (1 GB RAM), `npm run build` and Mediasoup native C++ workers compile smoothly without getting killed by the Linux Out-Of-Memory (OOM) killer.
2. **Installs Docker & Docker Compose plugin.**
3. **Clones Collabo** to `/opt/collabo`.
4. **Auto-detects Azure Public IP and Azure FQDN.**
5. **Configures `.env`** with `MEDIASOUP_ANNOUNCED_IP` and your domain.
6. **Launches the container stack** with `docker compose up -d --build`.

---

## 6. Manual Setup (Alternative to Script)

If you prefer to configure the server manually:

### 1. Add Swap Space (Crucial for B1s 1 GB RAM)
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Install Docker & Prerequisites
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release git

sudo mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 3. Clone Repository & Configure Environment
```bash
sudo git clone https://github.com/xrayian/Collabo.git /opt/collabo
cd /opt/collabo

# Query Azure Instance Metadata Service for public IP
PUBLIC_IP=$(curl -s -H Metadata:true --noproxy "*" "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text" || curl -s ifconfig.me)

# If you configured an Azure DNS label, set your full FQDN below (e.g. collabo-backend.eastasia.cloudapp.azure.com)
# Otherwise, fall back to nip.io:
DOMAIN="${DOMAIN:-${PUBLIC_IP}.nip.io}"

sudo tee /opt/collabo/.env <<EOF
PORT=3000
NODE_ENV=production
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP}
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
DOMAIN=${DOMAIN}
EOF
```

> [!NOTE]
> **Domain Formatting Rule for Caddy:** Always specify a single clean domain (`DOMAIN=my-app.eastasia.cloudapp.azure.com`). If specifying multiple domains, separate them with a space (`DOMAIN="site1.com site2.com"`). Never join with commas without spaces (`site1,site2`), as Caddy will reject it as an invalid hostname.
>
> **Port 3000 vs 443:** Port 3000 is internal and intentionally blocked in the Azure NSG firewall. Caddy automatically listens on standard HTTPS (port 443) and proxies requests to `localhost:3000`. Access your site via `https://<YOUR_DOMAIN>`.

### 4. Build and Start
```bash
sudo docker compose up -d --build
```

### 5. Changing Domain After Deployment
If you update `DOMAIN` in `/opt/collabo/.env` later, recreate the Caddy container so it obtains a new Let's Encrypt certificate:
```bash
cd /opt/collabo
sudo docker compose up -d caddy
sudo docker compose logs --tail=30 -f caddy
```

---

## 7. Verifying Deployment & Connecting

### Check Container Status
```bash
sudo docker compose ps
```

### View Live Logs
```bash
# Application logs (Next.js & Mediasoup SFU)
sudo docker compose logs -f collabo

# Caddy automatic HTTPS logs
sudo docker compose logs -f caddy
```

### Accessing Collabo
- **Browser:** `https://<YOUR_AZURE_DNS_NAME>` (or `https://<PUBLIC_IP>.nip.io`)
- **Desktop Host App:**
  In your local `collabo` desktop `.env`, set:
  ```env
  COLLABO_HOST_URL=https://<YOUR_AZURE_DNS_NAME>/desktop-host
  ```
