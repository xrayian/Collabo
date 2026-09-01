/**
 * tests/e2e-room.test.ts
 * Comprehensive E2E integration test suite for Collabo SFU, Signaling, and Room lifecycle.
 */
import { WebSocket } from 'ws';

const BASE_HTTP = process.env.COLLABO_HTTP_URL || 'http://localhost:3000';
const BASE_WS = process.env.COLLABO_WS_URL || 'ws://localhost:3000/ws';

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_WS);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for matching message`));
    }, timeoutMs);

    const handler = (data: any) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(parsed);
        }
      } catch (err) {
        // ignore parse error
      }
    };

    ws.on('message', handler);
  });
}

export async function runE2ERoomTests() {
  console.log('=== [1/3] RUNNING COLLABO E2E INTEGRATION TESTS ===\n');

  // 1. Create meeting
  console.log('[Test 1] Creating new meeting via POST /api/meetings...');
  const res = await fetch(`${BASE_HTTP}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const meetingData = await res.json();
  console.log('Meeting created:', meetingData);
  if (!meetingData.success || !meetingData.meetingId || !meetingData.authCode) {
    throw new Error('Failed to create meeting');
  }
  const { meetingId, authCode } = meetingData;

  // 2. Test invalid auth code rejection
  console.log('\n[Test 2] Testing join rejection on invalid auth code...');
  const wsInvalid = await connectWs();
  wsInvalid.send(
    JSON.stringify({
      type: 'join',
      meetingId,
      name: 'Hacker',
      authCode: 'WRONG9',
    })
  );
  const badAuthMsg = await waitForMessage(wsInvalid, (m) => m.type === 'error');
  console.log('Received expected error:', badAuthMsg);
  if (badAuthMsg.code !== 'BAD_AUTH_CODE') {
    throw new Error(`Expected BAD_AUTH_CODE, got ${badAuthMsg.code}`);
  }
  wsInvalid.close();

  // 3. Test Host Join
  console.log('\n[Test 3] Testing Host join with valid auth code...');
  const wsHost = await connectWs();
  wsHost.send(
    JSON.stringify({
      type: 'join',
      meetingId,
      name: 'Alice (Host)',
      authCode,
    })
  );
  const hostJoinAck = await waitForMessage(wsHost, (m) => m.type === 'join-ack');
  console.log('Host joined successfully:', {
    you: hostJoinAck.you,
    peerCount: hostJoinAck.room.peers.length,
    hasRouterCaps: !!hostJoinAck.routerRtpCapabilities,
  });
  if (!hostJoinAck.you.isHost || hostJoinAck.you.name !== 'Alice (Host)') {
    throw new Error('Host status incorrect');
  }

  // 4. Test Peer 2 Join & Color Assignment
  console.log('\n[Test 4] Testing Peer 2 join and color distinction...');
  const wsPeer2 = await connectWs();
  wsPeer2.send(
    JSON.stringify({
      type: 'join',
      meetingId,
      name: 'Bob',
      authCode,
    })
  );

  const [peer2JoinAck, hostPeerJoined] = await Promise.all([
    waitForMessage(wsPeer2, (m) => m.type === 'join-ack'),
    waitForMessage(wsHost, (m) => m.type === 'peer-joined'),
  ]);

  console.log('Peer 2 joined:', peer2JoinAck.you);
  console.log('Host notified of peer-joined:', hostPeerJoined.peer.name);
  if (peer2JoinAck.you.color === hostJoinAck.you.color) {
    throw new Error('Color collision detected! Peers must receive distinct colors.');
  }

  // 5. Test Mediasoup WebRtcTransport creation on server SFU
  console.log('\n[Test 5] Testing Mediasoup WebRtcTransport creation...');
  wsHost.send(JSON.stringify({ type: 'create-transport', direction: 'send' }));
  const sendTransportMsg = await waitForMessage(wsHost, (m) => m.type === 'transport-created');
  console.log('SFU Send Transport created:', {
    id: sendTransportMsg.id,
    iceCandidatesCount: sendTransportMsg.iceCandidates.length,
    dtlsRole: sendTransportMsg.dtlsParameters.role,
  });

  // 6. Test Screen Share Initiation by Host on SFU
  console.log('\n[Test 6] Testing Screen Share produce and broadcast...');
  const dummyVideoRtpParams = {
    codecs: [
      {
        mimeType: 'video/VP8',
        payloadType: 96,
        clockRate: 90000,
        rtcpFeedback: [],
        parameters: {},
      },
    ],
    headerExtensions: [],
    encodings: [{ ssrc: 22222222 }],
    rtcp: { cname: 'host-screen-share' },
  };

  wsHost.send(
    JSON.stringify({
      type: 'produce',
      transportId: sendTransportMsg.id,
      kind: 'video',
      rtpParameters: dummyVideoRtpParams,
    })
  );

  const [hostProducedVideo, peer2NotifiedOfScreen] = await Promise.all([
    waitForMessage(wsHost, (m) => m.type === 'produced' && m.kind === 'video'),
    waitForMessage(wsPeer2, (m) => m.type === 'new-producer' && m.kind === 'video'),
  ]);
  console.log('Host produced video screen share:', hostProducedVideo.producerId);
  console.log('Peer 2 received new-producer for screen share:', peer2NotifiedOfScreen.producerId);

  // 7. Test Late-Joining Peer 3 Receiving Ongoing Screen Share
  console.log('\n[Test 7] Testing late-joining participant receives ongoing screen share...');
  const wsPeer3 = await connectWs();

  const peer3JoinAckPromise = waitForMessage(wsPeer3, (m) => m.type === 'join-ack');
  const peer3ScreenProducerPromise = waitForMessage(
    wsPeer3,
    (m) => m.type === 'new-producer' && m.kind === 'video'
  );

  wsPeer3.send(
    JSON.stringify({
      type: 'join',
      meetingId,
      name: 'Charlie (Late Joiner)',
      authCode,
    })
  );

  const [peer3JoinAck, peer3ScreenProducerMsg] = await Promise.all([
    peer3JoinAckPromise,
    peer3ScreenProducerPromise,
  ]);

  console.log('Late-joining Peer 3 successfully received ongoing screen producer:', {
    producerId: peer3ScreenProducerMsg.producerId,
    kind: peer3ScreenProducerMsg.kind,
  });
  if (peer3ScreenProducerMsg.producerId !== hostProducedVideo.producerId) {
    throw new Error('Late joiner received incorrect video producer ID');
  }

  // 8. Test Live Stroke Drawing Synchronization Over Screen Share
  console.log('\n[Test 8] Testing normalized stroke broadcast and sync across participants and host...');
  const strokePayload = {
    type: 'draw-stroke',
    strokeId: 'stroke-test-over-screen',
    points: [
      [0.25, 0.35],
      [0.30, 0.40],
      [0.35, 0.45],
    ],
    isEnd: true,
  };
  wsPeer3.send(JSON.stringify(strokePayload));

  const [hostReceivedStroke, peer2ReceivedStroke] = await Promise.all([
    waitForMessage(wsHost, (m) => m.type === 'draw-stroke' && m.strokeId === 'stroke-test-over-screen'),
    waitForMessage(wsPeer2, (m) => m.type === 'draw-stroke' && m.strokeId === 'stroke-test-over-screen'),
  ]);
  console.log('Host and Peer 2 both received drawing stroke from late joiner Peer 3:', {
    hostGotPeer: hostReceivedStroke.peerId,
    pointsCount: hostReceivedStroke.points.length,
  });

  // 9. Test Presenter Handoff (Transfers presenter role & automatically closes old screen share)
  console.log('\n[Test 9] Testing Presenter role handoff and auto screen share cleanup...');
  wsHost.send(
    JSON.stringify({
      type: 'grant-host',
      targetPeerId: peer2JoinAck.you.id,
    })
  );

  const [hostChangedOnHost, hostChangedOnPeer2, producerClosedMsg] = await Promise.all([
    waitForMessage(wsHost, (m) => m.type === 'host-changed'),
    waitForMessage(wsPeer2, (m) => m.type === 'host-changed'),
    waitForMessage(wsPeer2, (m) => m.type === 'producer-closed' && m.kind === 'video'),
  ]);

  console.log('Presenter role successfully transferred to Peer 2:', {
    newHostId: hostChangedOnPeer2.hostId,
    oldProducerClosed: producerClosedMsg.producerId,
  });
  if (hostChangedOnPeer2.hostId !== peer2JoinAck.you.id) {
    throw new Error('Host handoff target mismatch');
  }

  // 10. Test 10-Peer Capacity Enforcement
  console.log('\n[Test 10] Testing 10-peer maximum room capacity limit...');
  const otherPeers: WebSocket[] = [];
  for (let i = 4; i <= 10; i++) {
    const ws = await connectWs();
    otherPeers.push(ws);
    ws.send(
      JSON.stringify({
        type: 'join',
        meetingId,
        name: `Guest ${i}`,
        authCode,
      })
    );
    await waitForMessage(ws, (m) => m.type === 'join-ack');
  }
  console.log('Successfully filled room to 10 participants.');

  // Attempt 11th participant
  const ws11th = await connectWs();
  ws11th.send(
    JSON.stringify({
      type: 'join',
      meetingId,
      name: 'Guest 11 (Overflow)',
      authCode,
    })
  );
  const roomFullError = await waitForMessage(ws11th, (m) => m.type === 'error');
  console.log('11th participant received expected error:', roomFullError);
  if (roomFullError.code !== 'ROOM_FULL') {
    throw new Error(`Expected ROOM_FULL error, got ${roomFullError.code}`);
  }
  ws11th.close();

  // Cleanup all sockets
  console.log('\n[Cleanup] Closing peer connections...');
  wsHost.close();
  wsPeer2.close();
  wsPeer3.close();
  otherPeers.forEach((ws) => ws.close());

  console.log('✅ E2E Room integration suite completed successfully!\n');
}

if (require.main === module) {
  runE2ERoomTests().catch((err) => {
    console.error('\n❌ E2E TEST SUITE FAILED:', err);
    process.exit(1);
  });
}
