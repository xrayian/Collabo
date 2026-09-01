/**
 * tests/run-all.ts
 * Master integration test suite runner for Collabo.
 */
import { runE2ERoomTests } from './e2e-room.test';
import { runDrawFreeformTests } from './draw-freeform.test';
import { runDrawTtlTests } from './draw-ttl.test';

async function runAllTests() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('       COLLABO AUTOMATED INTEGRATION TEST SUITE      ');
  console.log('====================================================\n');

  try {
    await runE2ERoomTests();
    await runDrawFreeformTests();
    await runDrawTtlTests();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('====================================================');
    console.log(`🎉 ALL TEST SUITES PASSED SUCCESSFULLY IN ${duration}s!`);
    console.log('====================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('\n====================================================');
    console.error('❌ TEST SUITE RUNNER FAILED:');
    console.error(err);
    console.error('====================================================');
    process.exit(1);
  }
}

runAllTests();
