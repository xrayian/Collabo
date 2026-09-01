/**
 * tests/draw-freeform.test.ts
 * Verifies that open curve freeform strokes (like parentheses, arcs, lines)
 * preserve open start/end points and never close prematurely into loops.
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

export async function runDrawFreeformTests() {
  console.log('=== [2/3] RUNNING FREEFORM OPEN CURVE STROKE TESTS ===\n');

  // 1. Create meeting
  const res = await fetch(`${BASE_HTTP}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const { meetingId, authCode } = await res.json();
  console.log(`Meeting created: ${meetingId}`);

  // 2. Connect Host
  const wsHost = await connectWs();
  wsHost.send(JSON.stringify({ type: 'join', meetingId, name: 'Host', authCode }));
  await waitForMessage(wsHost, (m) => m.type === 'join-ack');

  // 3. Connect Drawer
  const wsDrawer = await connectWs();
  wsDrawer.send(JSON.stringify({ type: 'join', meetingId, name: 'Drawer', authCode }));
  await waitForMessage(wsDrawer, (m) => m.type === 'join-ack');

  // 4. Simulate freeform curve ')' (p0 -> p1 -> p2 -> p3 -> p4)
  const strokeId = 'curve_test_' + Date.now();
  const curvePoints: Array<[number, number]> = [
    [0.30, 0.20], // top of curve
    [0.40, 0.35], // middle right bulge of ')'
    [0.45, 0.50], // apex of bulge
    [0.40, 0.65], // lower right bulge
    [0.30, 0.80], // bottom of curve
  ];

  console.log('Simulating drawing of open curve ) with points:', curvePoints);

  // Pointer Down (sends first point)
  wsDrawer.send(
    JSON.stringify({
      type: 'draw-stroke',
      strokeId,
      points: [curvePoints[0]],
      isEnd: false,
    })
  );

  // Pointer Moves (sends intermediate points incrementally)
  for (let i = 1; i < curvePoints.length; i++) {
    wsDrawer.send(
      JSON.stringify({
        type: 'draw-stroke',
        strokeId,
        points: [curvePoints[i]],
        isEnd: false,
      })
    );
  }

  // Pointer Up (disengaging mouse -> sends empty delta points with isEnd: true)
  wsDrawer.send(
    JSON.stringify({
      type: 'draw-stroke',
      strokeId,
      points: [],
      isEnd: true,
    })
  );

  // 5. Connect Late Joiner to inspect accumulated room stroke on server
  console.log('Connecting new peer to inspect accumulated stroke in room state...');
  const wsInspector = await connectWs();
  wsInspector.send(JSON.stringify({ type: 'join', meetingId, name: 'Inspector', authCode }));
  const inspectorAck = await waitForMessage(wsInspector, (m) => m.type === 'join-ack');

  const savedStroke = inspectorAck.room.strokes.find((s: any) => s.id === strokeId);
  if (!savedStroke) {
    throw new Error('Stroke was not found in room state!');
  }

  console.log('\nStroke points in room state:', savedStroke.points);
  console.log(`Total points count: ${savedStroke.points.length} (Expected: ${curvePoints.length})`);

  // Verify points match exactly 1:1 without repeating back to start
  if (savedStroke.points.length !== curvePoints.length) {
    throw new Error(`Points count mismatch! Expected ${curvePoints.length}, got ${savedStroke.points.length}`);
  }

  for (let i = 0; i < curvePoints.length; i++) {
    const expected = curvePoints[i];
    const actual = savedStroke.points[i];
    if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
      throw new Error(`Point ${i} mismatch! Expected [${expected}], got [${actual}]`);
    }
  }

  const firstPoint = savedStroke.points[0];
  const lastPoint = savedStroke.points[savedStroke.points.length - 1];
  console.log(`Start point: [${firstPoint}], End point: [${lastPoint}]`);

  if (firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1]) {
    throw new Error('Stroke was closed into a loop! Start and end points collided.');
  }

  console.log('✅ Freeform curve test completed successfully!\n');

  wsHost.close();
  wsDrawer.close();
  wsInspector.close();
}

if (require.main === module) {
  runDrawFreeformTests().catch((err) => {
    console.error('\n❌ FREEFORM TEST FAILED:', err);
    process.exit(1);
  });
}
