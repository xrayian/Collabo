/**
 * tests/draw-ttl.test.ts
 * Verifies annotation lifecycle: 5s solid lifetime + 0.5s blur-fade transition and automated server pruning.
 */
import { WebSocket } from 'ws';
import { STROKE_LIFETIME_MS, STROKE_FADE_DURATION_MS, STROKE_TOTAL_TTL_MS } from '../lib/draw-sync';

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

export async function runDrawTtlTests() {
  console.log('=== [3/3] RUNNING ANNOTATION 5S LIFETIME & 0.5S FADE-AWAY TTL TESTS ===\n');
  console.log(`Constants: Lifetime = ${STROKE_LIFETIME_MS}ms, Fade = ${STROKE_FADE_DURATION_MS}ms, Total TTL = ${STROKE_TOTAL_TTL_MS}ms`);

  // 1. Create meeting
  const res = await fetch(`${BASE_HTTP}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const { meetingId, authCode } = await res.json();
  console.log(`Meeting created: ${meetingId}`);

  // 2. Connect Drawer
  const wsDrawer = await connectWs();
  wsDrawer.send(JSON.stringify({ type: 'join', meetingId, name: 'Drawer', authCode }));
  await waitForMessage(wsDrawer, (m) => m.type === 'join-ack');

  // 3. Draw a stroke
  const strokeId = 'ttl_test_' + Date.now();
  wsDrawer.send(
    JSON.stringify({
      type: 'draw-stroke',
      strokeId,
      points: [
        [0.2, 0.2],
        [0.3, 0.3],
      ],
      isEnd: true,
    })
  );
  console.log(`Stroke ${strokeId} created.`);

  // 4. Inspect at t = 1s (Should still be fully active)
  await new Promise((r) => setTimeout(r, 1000));
  const wsChecker1 = await connectWs();
  wsChecker1.send(JSON.stringify({ type: 'join', meetingId, name: 'Checker1', authCode }));
  const ack1 = await waitForMessage(wsChecker1, (m) => m.type === 'join-ack');
  const found1 = ack1.room.strokes.some((s: any) => s.id === strokeId);
  console.log(`[t = 1.0s] Stroke present in room state: ${found1} (Expected: true)`);
  if (!found1) throw new Error('Stroke prematurely vanished at t = 1s!');
  wsChecker1.close();

  // 5. Wait until t = 5.8s (> 5.5s Total TTL)
  console.log('Waiting for 5.5s TTL window to expire...');
  await new Promise((r) => setTimeout(r, 4800));

  // 6. Draw a new stroke to trigger server state pruning & inspect
  const wsChecker2 = await connectWs();
  wsChecker2.send(JSON.stringify({ type: 'join', meetingId, name: 'Checker2', authCode }));
  const ack2 = await waitForMessage(wsChecker2, (m) => m.type === 'join-ack');

  // Trigger prune
  wsChecker2.send(
    JSON.stringify({
      type: 'draw-stroke',
      strokeId: 'trigger_prune',
      points: [[0.5, 0.5]],
      isEnd: true,
    })
  );

  const found2 = ack2.room.strokes.some((s: any) => s.id === strokeId);
  console.log(`[t = 5.8s] Old stroke present in fresh join state: ${found2} (Expected: false)`);
  if (found2) throw new Error('Expired stroke was not pruned from room state after TTL!');

  console.log('✅ Annotation TTL test completed successfully!\n');

  wsDrawer.close();
  wsChecker2.close();
}

if (require.main === module) {
  runDrawTtlTests().catch((err) => {
    console.error('\n❌ TTL TEST FAILED:', err);
    process.exit(1);
  });
}
