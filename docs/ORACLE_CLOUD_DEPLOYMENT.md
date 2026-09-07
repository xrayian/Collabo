# Hosting Collabo on Oracle Cloud Infrastructure (OCI) Always Free Tier

This guide provides a complete, step-by-step walkthrough for deploying Collabo to **Oracle Cloud Infrastructure (OCI)** using their **Always Free Tier**.

---

## 1. Why Oracle Cloud Always Free Tier?

Oracle Cloud provides one of the most generous free-tier compute offerings in the cloud industry:

| Resource | Always Free Allowance | Collabo Suitability |
| :--- | :--- | :--- |
| **Ampere A1 Compute (ARM64)** | **Up to 4 OCPUs (physical cores) + 24 GB RAM** | ⭐ **Ideal & Recommended.** Can easily host 20+ concurrent 10-person meetings 24/7. |
| **AMD Compute (`VM.Standard.E2.1.Micro`)** | 1/8 OCPU, 1 GB RAM | ❌ **Not recommended.** 1 GB RAM is too constrained for Next.js compilation and Mediasoup SFU workers. |
| **Outbound Data Transfer (Egress)** | **10 TB / month** | Ample bandwidth to cover dozens of simultaneous WebRTC video streams. |
| **Block Storage** | **200 GB Total** | More than enough for OS, Docker images, and application logs. |

---

## 2. Step 1: Create the Ampere A1 Compute Instance

1. Sign in to the [Oracle Cloud Console](https://cloud.oracle.com/).
2. From the navigation menu, select **Compute** > **Instances**, then click **Create Instance**.
3. Configure the instance:
   - **Name:** `collabo-server`
   - **Placement:** Any available fault domain.
   - **Image:** Click *Change Image* > choose **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS** (Canonical Ubuntu).
   - **Shape:** Click *Change Shape*:
     - Select **Ampere (ARM Processor)**.
     - Choose `VM.Standard.A1.Flex`.
     - Configure OCPUs and RAM:
       - **OCPUs:** `2` to `4` (Always Free allows up to 4).
       - **Memory (GB):** `8` to `24` GB (Always Free allows up to 24 GB).
4. **Networking:**
   - Select your existing Virtual Cloud Network (VCN) and public subnet (or allow OCI to create a new one).
   - Ensure **Assign a public IPv4 address** is selected.
5. **Add SSH Keys:**
   - Select *Generate a key pair for me* (and save both private and public keys) OR choose *Upload public key files (.pub)* to supply your own key.
6. **Boot Volume:**
   - Standard 47 GB or up to 100 GB (Always Free covers up to 200 GB across your account).
7. Click **Create**. Wait 1–2 minutes for the instance status to transition to **Running**.

---

## 3. Step 2: Open Ingress Ports in the OCI Security List

By default, OCI security lists drop all incoming traffic except SSH (TCP port 22). You must allow HTTP, HTTPS, and Mediasoup's WebRTC UDP port range.

1. In the OCI Console, navigate to **Networking** > **Virtual Cloud Networks**.
2. Click your VCN name > **Security Lists** (in the left sidebar) > click **Default Security List for...**
3. Click **Add Ingress Rules** and add the following two rules:

### Rule A: Web Traffic (HTTP & HTTPS)
- **Source Type:** CIDR
- **Source CIDR:** `0.0.0.0/0`
- **IP Protocol:** `TCP`
- **Source Port Range:** *Leave blank (All)*
- **Destination Port Range:** `80, 443`
- **Description:** `Allow HTTP and HTTPS/WebSocket traffic for Collabo`

### Rule B: WebRTC Media Streams (UDP RTP)
- **Source Type:** CIDR
- **Source CIDR:** `0.0.0.0/0`
- **IP Protocol:** `UDP`
- **Source Port Range:** *Leave blank (All)*
- **Destination Port Range:** `40000-49999`
- **Description:** `Allow Mediasoup WebRTC audio and video RTP streams`

4. Click **Add Ingress Rules**.

---

## 4. Step 3: ⚠️ Critical Step — Unblock Host OS Firewall (`iptables`)

> [!CAUTION]
> **Common Oracle Cloud Trap:** Oracle-provided Ubuntu and Linux VM images have an internal `iptables` firewall running inside the operating system that rejects all non-SSH inbound traffic, even if you open ports in the OCI Web Console!

1. Connect to your instance via SSH:
   ```bash
   ssh -i /path/to/your/private-key ubuntu@<YOUR_VM_PUBLIC_IP>
   ```

2. Open TCP 80, 443 and UDP 40000–49999 in the OS-level `iptables` chain:
   ```bash
   # Insert accept rules before the default reject rule (rule 6)
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 40000:49999 -j ACCEPT

   # Persist the rules across reboots
   sudo apt-get update && sudo apt-get install -y iptables-persistent netfilter-persistent
   sudo netfilter-persistent save
   ```

*(Alternatively, if you prefer UFW):*
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 40000:49999/udp
sudo ufw --force enable
```

---

## 5. Step 4: Install Docker & Docker Compose

Run the official Docker convenience script:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Allow non-root docker execution
sudo usermod -aG docker $USER
newgrp docker
```

Verify Docker is running:
```bash
docker --version && docker compose version
```

---

## 6. Step 5: Deploy Collabo

1. Clone the Collabo repository:
   ```bash
   git clone https://github.com/xrayian/Collabo.git /opt/collabo
   cd /opt/collabo
   ```

2. Detect your public IP address and configure the environment:
   ```bash
   # Fetch the VM's public IPv4
   PUBLIC_IP=$(curl -s ifconfig.me)
   echo "Public IP is: $PUBLIC_IP"

   # Create production .env file
   cat <<EOF > /opt/collabo/.env
   PORT=3000
   NODE_ENV=production
   MEDIASOUP_LISTEN_IP=0.0.0.0
   MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP}
   MEDIASOUP_MIN_PORT=40000
   MEDIASOUP_MAX_PORT=49999
   DOMAIN=${PUBLIC_IP}.nip.io
   EOF
   ```

3. Launch the container stack:
   ```bash
   docker compose up -d --build
   ```

Docker will build the Next.js frontend, compile Mediasoup native workers for ARM64, and start Caddy with automatic Let's Encrypt SSL.

---

## 7. Step 6: Verify Deployment

Check that containers are running and healthy:
```bash
docker compose ps
```

View application and reverse proxy logs:
```bash
# View Collabo application logs
docker compose logs -f collabo

# View Caddy SSL & routing logs
docker compose logs -f caddy
```

---

## 8. Accessing the Application

- **Web Application:**
  - Standard HTTP: `http://<YOUR_PUBLIC_IP>:3000`
  - Automatic HTTPS (via nip.io): `https://<YOUR_PUBLIC_IP>.nip.io`
- **Custom Domain (Optional):**
  - Point an `A` record on your domain (e.g., `meet.yourdomain.com`) to `<YOUR_PUBLIC_IP>`.
  - In `/opt/collabo/.env`, update:
    ```env
    DOMAIN=meet.yourdomain.com
    ```
  - Restart the stack: `docker compose up -d`
- **Connecting the Desktop Host App:**
  - In your local development/desktop `.env`, point the host URL to your Oracle Cloud instance:
    ```env
    COLLABO_HOST_URL=https://<YOUR_PUBLIC_IP>.nip.io/desktop-host
    ```

---

## 9. Automated 1-Script Setup (Optional)

You can also run the automated provisioning script directly on a fresh Ubuntu OCI instance:

```bash
curl -sSL https://raw.githubusercontent.com/xrayian/Collabo/main/deploy/oci-setup.sh | bash
```
