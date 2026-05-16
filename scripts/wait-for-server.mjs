/**
 * Poll GET /health until the API is accepting connections.
 * Used by `npm test` so E2E tests do not run during a dev-server restart.
 */

const base = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const maxWaitMs = Number(process.env.TEST_SERVER_WAIT_MS || 120_000);
const intervalMs = Number(process.env.TEST_SERVER_POLL_MS || 500);

const deadline = Date.now() + maxWaitMs;

async function probe() {
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
  return res.ok;
}

while (Date.now() < deadline) {
  try {
    if (await probe()) {
      console.log(`[test] Server ready at ${base}`);
      process.exit(0);
    }
  } catch {
    // still starting or restarting
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}

console.error(
  `[test] Server not reachable at ${base} after ${maxWaitMs}ms.\n` +
    '  Start the API and wait for "Server started successfully", then run npm test again.\n' +
    '  Tip: use `npm start` (no --watch) while testing so saves do not restart the server.'
);
process.exit(1);
