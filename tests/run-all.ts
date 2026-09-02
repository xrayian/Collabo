/**
 * tests/run-all.ts
 * Master integration test suite runner for Collabo.
 * Automatically spawns the server if not already running.
 */
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { runE2ERoomTests } from './e2e-room.test';
import { runDrawFreeformTests } from './draw-freeform.test';
import { runDrawTtlTests } from './draw-ttl.test';

const BASE_HTTP = process.env.COLLABO_HTTP_URL || 'http://localhost:3000';

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_HTTP}/api/meetings?meetingId=healthcheck`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function startServer(): Promise<ChildProcess> {
  console.log('🔄 Server not detected on port 3000. Launching temporary server for test suite...');
  const serverProcess = spawn('npx', ['tsx', 'server/ws-server.ts'], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'inherit',
  });

  // Wait up to 15s for server to become healthy
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) {
      console.log('✅ Server ready on http://localhost:3000\n');
      return serverProcess;
    }
  }

  serverProcess.kill();
  throw new Error('Server failed to start within 15 seconds.');
}

async function runAllTests() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('       COLLABO AUTOMATED INTEGRATION TEST SUITE      ');
  console.log('====================================================\n');

  let spawnedServer: ChildProcess | null = null;

  try {
    const alreadyRunning = await isServerRunning();
    if (!alreadyRunning) {
      spawnedServer = await startServer();
    }

    await runE2ERoomTests();
    await runDrawFreeformTests();
    await runDrawTtlTests();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('====================================================');
    console.log(`🎉 ALL TEST SUITES PASSED SUCCESSFULLY IN ${duration}s!`);
    console.log('====================================================');

    if (spawnedServer) {
      spawnedServer.kill();
    }
    process.exit(0);
  } catch (err: any) {
    console.error('\n====================================================');
    console.error('❌ TEST SUITE RUNNER FAILED:');
    console.error(err);
    console.error('====================================================');

    if (spawnedServer) {
      spawnedServer.kill();
    }
    process.exit(1);
  }
}

runAllTests();
