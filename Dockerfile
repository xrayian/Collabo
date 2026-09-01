# ===================================================
# Collabo — Production Dockerfile (Next.js + Mediasoup SFU)
# ===================================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native compilation dependencies for mediasoup workers
RUN apt-get update && apt-get install -y python3 make g++ gcc libssl-dev && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm run build:electron

# Production runtime image
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install minimal runtime dependencies for mediasoup native workers
RUN apt-get update && apt-get install -y python3 make g++ gcc && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app ./

# Expose HTTP/WS port and WebRTC UDP RTP port range
EXPOSE 3000
EXPOSE 40000-49999/udp

CMD ["npm", "start"]
