/**
 * server/ws-server.ts
 * Unified server running Next.js App Router, WebSocket signaling, and mediasoup SFU.
 */
import http from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { config } from './config';
import { roomManager } from './rooms';
import { sfuManager } from './sfu';
import { ClientMessage, ServerMessage } from '../lib/types';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

interface ExtendedWebSocket extends WebSocket {
  id: string;
  meetingId?: string;
  isAlive: boolean;
}

// Map peerId -> ExtendedWebSocket
const clientSockets = new Map<string, ExtendedWebSocket>();

/**
 * Send JSON message safely to a WebSocket client.
 */
function send(ws: ExtendedWebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast message to all peers in a meeting room, optionally excluding sender.
 */
function broadcastToRoom(
  meetingId: string,
  message: ServerMessage,
  excludePeerId?: string
): void {
  const room = roomManager.getRoom(meetingId);
  if (!room) return;

  for (const peer of room.peers) {
    if (excludePeerId && peer.id === excludePeerId) continue;
    const peerSocket = clientSockets.get(peer.id);
    if (peerSocket) {
      send(peerSocket, message);
    }
  }
}

async function startServer() {
  await sfuManager.init();
  await app.prepare();

  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  const nextUpgradeHandler = (app as any).getUpgradeHandler ? (app as any).getUpgradeHandler() : null;

  // Handle HTTP Upgrade to WebSocket
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    console.log(`[WS Upgrade] Received upgrade request for URL: "${request.url}", pathname: "${pathname}"`);

    if (pathname === '/ws' || pathname === '/ws/') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (nextUpgradeHandler) {
      nextUpgradeHandler(request, socket, head);
    }
  });

  // Heartbeat ping/pong
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (!extWs.isAlive) {
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', (ws: ExtendedWebSocket) => {
    ws.id = crypto.randomUUID();
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    clientSockets.set(ws.id, ws);
    console.log(`[WS] Peer connected: ${ws.id}`);

    ws.on('message', async (raw: string) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        await handleClientMessage(ws, msg);
      } catch (err: any) {
        console.error(`[WS] Error processing message from ${ws.id}:`, err);
        send(ws, {
          type: 'error',
          code: 'SERVER_ERROR',
          message: err.message || 'Server error occurred',
        });
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Peer disconnected: ${ws.id}`);
      handlePeerDisconnect(ws);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Socket error for ${ws.id}:`, err);
    });
  });

  const port = config.server.port;
  const host = config.server.host;

  server.listen(port, host, () => {
    console.log(`> Collabo ready on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
}

/**
 * Handle messages received from clients.
 */
async function handleClientMessage(ws: ExtendedWebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'join': {
      const { meetingId, name, authCode } = msg;
      ws.meetingId = meetingId;

      const result = roomManager.addPeer(meetingId, ws.id, name, authCode);
      if ('error' in result) {
        return send(ws, {
          type: 'error',
          code: result.error,
          message: result.message,
        });
      }

      const { peer, room } = result;
      const routerRtpCapabilities = await sfuManager.getRouterRtpCapabilities(meetingId);

      // Acknowledge join with current room state and SFU router capabilities
      send(ws, {
        type: 'join-ack',
        you: {
          id: peer.id,
          name: peer.name,
          color: peer.color,
          isHost: peer.isHost,
        },
        room,
        routerRtpCapabilities,
      });

      // Announce new peer to everyone else in the room
      broadcastToRoom(meetingId, { type: 'peer-joined', peer }, ws.id);

      // Inform newly joined peer about existing producers in the room
      const existingProducers = sfuManager.getRoomProducers(meetingId, ws.id);
      for (const prod of existingProducers) {
        send(ws, {
          type: 'new-producer',
          peerId: prod.peerId,
          producerId: prod.producerId,
          kind: prod.kind,
        });
      }
      break;
    }

    case 'create-transport': {
      if (!ws.meetingId) return;
      const { direction } = msg;
      const params = await sfuManager.createWebRtcTransport(ws.meetingId, ws.id, direction);
      send(ws, {
        type: 'transport-created',
        direction,
        ...params,
      });
      break;
    }

    case 'connect-transport': {
      const { transportId, dtlsParameters } = msg;
      await sfuManager.connectWebRtcTransport(ws.id, transportId, dtlsParameters);
      send(ws, {
        type: 'transport-connected',
        transportId,
      });
      break;
    }

    case 'produce': {
      if (!ws.meetingId) return;
      const { transportId, kind, rtpParameters, appData } = msg;

      // Ensure only host can produce video (screen share)
      const room = roomManager.getRoom(ws.meetingId);
      if (kind === 'video' && room && room.hostId !== ws.id) {
        return send(ws, {
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Only the active presenter (host) can share their screen.',
        });
      }

      const producer = await sfuManager.produce(ws.id, transportId, kind, rtpParameters, appData);

      if (kind === 'video') {
        roomManager.updatePeer(ws.meetingId, ws.id, { screenSharing: true });
      }

      send(ws, {
        type: 'produced',
        producerId: producer.id,
        kind,
      });

      // Notify all other peers in the room about this new producer
      broadcastToRoom(
        ws.meetingId,
        {
          type: 'new-producer',
          peerId: ws.id,
          producerId: producer.id,
          kind,
        },
        ws.id
      );
      break;
    }

    case 'consume': {
      if (!ws.meetingId) return;
      const { producerId, rtpCapabilities } = msg;
      const { params } = await sfuManager.consume(ws.meetingId, ws.id, producerId, rtpCapabilities);
      send(ws, {
        type: 'consumed',
        ...params,
      });
      break;
    }

    case 'resume-consumer': {
      const { consumerId } = msg;
      await sfuManager.resumeConsumer(ws.id, consumerId);
      break;
    }

    case 'pause-producer': {
      if (!ws.meetingId) return;
      const { producerId } = msg;
      await sfuManager.pauseProducer(ws.id, producerId);
      roomManager.updatePeer(ws.meetingId, ws.id, { audioMuted: true });
      broadcastToRoom(ws.meetingId, { type: 'producer-paused', producerId, peerId: ws.id }, ws.id);
      break;
    }

    case 'resume-producer': {
      if (!ws.meetingId) return;
      const { producerId } = msg;
      await sfuManager.resumeProducer(ws.id, producerId);
      roomManager.updatePeer(ws.meetingId, ws.id, { audioMuted: false });
      broadcastToRoom(ws.meetingId, { type: 'producer-resumed', producerId, peerId: ws.id }, ws.id);
      break;
    }

    case 'close-producer': {
      if (!ws.meetingId) return;
      const { producerId } = msg;
      const producer = sfuManager.findProducerById(producerId);
      const kind = producer?.kind || 'video';

      await sfuManager.closeProducer(ws.id, producerId);

      if (kind === 'video') {
        roomManager.updatePeer(ws.meetingId, ws.id, { screenSharing: false });
      }

      broadcastToRoom(
        ws.meetingId,
        {
          type: 'producer-closed',
          producerId,
          peerId: ws.id,
          kind,
        },
        ws.id
      );
      break;
    }

    case 'draw-stroke': {
      if (!ws.meetingId) return;
      const room = roomManager.getRoom(ws.meetingId);
      if (!room) return;

      const peer = room.peers.find((p) => p.id === ws.id);
      const color = peer?.color || '#2563eb';

      const stroke = {
        id: msg.strokeId,
        peerId: ws.id,
        color,
        points: msg.points,
        timestamp: Date.now(),
      };

      roomManager.addOrUpdateStroke(ws.meetingId, stroke);

      // Broadcast drawing stroke to all participants in room including host
      broadcastToRoom(
        ws.meetingId,
        {
          type: 'draw-stroke',
          peerId: ws.id,
          color,
          strokeId: msg.strokeId,
          points: msg.points,
          isEnd: msg.isEnd,
        },
        ws.id
      );
      break;
    }

    case 'clear-strokes': {
      if (!ws.meetingId) return;
      const room = roomManager.getRoom(ws.meetingId);
      if (!room) return;

      const isHost = room.hostId === ws.id;
      const scope = isHost && msg.scope === 'all' ? 'all' : 'own';

      roomManager.clearStrokes(ws.meetingId, ws.id, scope);

      broadcastToRoom(ws.meetingId, {
        type: 'clear-strokes',
        peerId: ws.id,
        scope,
      });
      break;
    }

    case 'grant-host': {
      if (!ws.meetingId) return;
      const room = roomManager.getRoom(ws.meetingId);
      if (!room || room.hostId !== ws.id) {
        return send(ws, {
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Only current host can transfer host rights.',
        });
      }

      // If old host had active screen sharing, close it on the SFU and notify
      const videoProducer = sfuManager.findVideoProducerByPeer(ws.id);
      if (videoProducer) {
        await sfuManager.closeProducer(ws.id, videoProducer.id);
        roomManager.updatePeer(ws.meetingId, ws.id, { screenSharing: false });
        broadcastToRoom(ws.meetingId, {
          type: 'producer-closed',
          producerId: videoProducer.id,
          peerId: ws.id,
          kind: 'video',
        });
      }

      const success = roomManager.setHost(ws.meetingId, msg.targetPeerId);
      if (success) {
        broadcastToRoom(ws.meetingId, {
          type: 'host-changed',
          hostId: msg.targetPeerId,
        });
      }
      break;
    }

    case 'request-host': {
      // In v1, request-host can alert current host or allow anyone to claim if host is absent
      if (!ws.meetingId) return;
      const room = roomManager.getRoom(ws.meetingId);
      if (room && (!room.hostId || !room.peers.some((p) => p.id === room.hostId))) {
        roomManager.setHost(ws.meetingId, ws.id);
        broadcastToRoom(ws.meetingId, {
          type: 'host-changed',
          hostId: ws.id,
        });
      }
      break;
    }

    case 'leave': {
      handlePeerDisconnect(ws);
      break;
    }
  }
}

/**
 * Handle peer disconnection and cleanup.
 */
function handlePeerDisconnect(ws: ExtendedWebSocket) {
  clientSockets.delete(ws.id);

  if (!ws.meetingId) return;
  const meetingId = ws.meetingId;
  ws.meetingId = undefined;

  // Clean SFU producers/transports
  const { closedProducers } = sfuManager.cleanPeer(ws.id);

  // Notify other peers about closed producers
  for (const prod of closedProducers) {
    broadcastToRoom(meetingId, {
      type: 'producer-closed',
      producerId: prod.producerId,
      peerId: ws.id,
      kind: prod.kind,
    });
  }

  // Remove peer from RoomManager
  const result = roomManager.removePeer(meetingId, ws.id);
  if (!result) return;

  if (result.remainingPeersCount === 0) {
    // Room is empty -> close SFU router and delete room
    console.log(`[Room] Meeting ${meetingId} is empty. Tearing down...`);
    sfuManager.closeRoomRouter(meetingId);
  } else {
    // Room still active -> broadcast peer-left
    broadcastToRoom(meetingId, {
      type: 'peer-left',
      peerId: ws.id,
    });

    // If host changed, broadcast host-changed
    if (result.newHostId) {
      broadcastToRoom(meetingId, {
        type: 'host-changed',
        hostId: result.newHostId,
      });
    }
  }
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
