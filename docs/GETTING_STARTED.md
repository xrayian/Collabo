# Getting Started with Collabo

Collabo is a high-performance, invite-only screen-draw meeting platform with a hybrid architecture:
- **Web Clients:** Zero-install browser participation (viewing, drawing, audio conferencing) on desktop and mobile.
- **Desktop Host App (Electron):** Presenter application with a transparent, click-through, always-on-top OS overlay.
- **Backend SFU (mediasoup):** Node.js WebSocket signaling and server-relayed WebRTC media distribution.

---

## 1. Prerequisites

- **Node.js:** v18.0.0 or higher (tested on Node.js v20+ and v26+)
- **npm:** v9.0.0 or higher
- **Operating System:** Windows 10/11, macOS, or Linux (X11 recommended for desktop hosting)
- **C++ Build Tools & Python:** Required for compiling `mediasoup` native worker binaries (`windows-build-tools` on Windows or `build-essential` on Ubuntu/Debian).

---

## 2. Installation

Clone the repository and install all dependencies:

```bash
git clone https://github.com/your-username/collabo.git
cd collabo
npm install
```

---

## 3. Development Workflow

### Starting the Web & SFU Server

Run the unified Next.js + WebSocket + Mediasoup SFU server:

```bash
npm run dev
```

The server will start on `http://localhost:3000` (HTTP and WebSocket signaling on `ws://localhost:3000/ws`).

### Building and Running the Electron Desktop Host App

To launch the native presenter desktop app with the transparent click-through overlay:

```bash
# Bundle Electron main and preload scripts
npm run build:electron

# Launch Collabo Desktop Host
npm run desktop
# or
npm run electron:start
```

---

## 4. Running the Automated Test Suite

Collabo includes a full suite of integration and math verification tests:

```bash
# Run all tests sequentially
npm test

# Run individual test suites
npm run test:e2e        # SFU transports, video producers, 10-peer room capacity
npm run test:freeform   # Open-curve stroke non-looping verification
npm run test:ttl        # 5s lifetime + 0.5s blur-fade-away transition
```

---

## 5. Production Build & Deployment

### Building Next.js

```bash
npm run build
```

### Running in Production

```bash
NODE_ENV=production npm start
```

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP & WebSocket server port | `3000` |
| `MEDIASOUP_LISTEN_IP` | Bind IP for Mediasoup RTP transports | `0.0.0.0` |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP for WebRTC ICE candidate routing | `127.0.0.1` |
| `MEDIASOUP_MIN_PORT` | Start of UDP port range for media RTP | `40000` |
| `MEDIASOUP_MAX_PORT` | End of UDP port range for media RTP | `49999` |
| `COLLABO_HOST_URL` | Host control page loaded by Electron | `http://localhost:3000/desktop-host` |
