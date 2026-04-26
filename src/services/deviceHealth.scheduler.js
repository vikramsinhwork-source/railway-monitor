import { runHealthTier } from '../modules/health/health.service.js';
import { logInfo, logWarn } from '../utils/logger.js';

let started = false;

export function startDeviceHealthScheduler(io) {
  if (started) return;
  started = true;

  // 30 sec heartbeat checks
  setInterval(async () => {
    try {
      await runHealthTier(io, 'HEARTBEAT_30S');
    } catch (error) {
      logWarn('HealthScheduler', 'Heartbeat tier failed', { error: error.message });
    }
  }, 30_000);

  // 2 min ping/http checks
  setInterval(async () => {
    try {
      await runHealthTier(io, 'PING_2M');
    } catch (error) {
      logWarn('HealthScheduler', 'Ping tier failed', { error: error.message });
    }
  }, 120_000);

  // 10 min deep stream checks
  setInterval(async () => {
    try {
      await runHealthTier(io, 'DEEP_STREAM_10M');
    } catch (error) {
      logWarn('HealthScheduler', 'Deep stream tier failed', { error: error.message });
    }
  }, 600_000);

  logInfo('HealthScheduler', 'Device health scheduler started', {
    heartbeatMs: 30_000,
    pingMs: 120_000,
    deepMs: 600_000,
  });
}
