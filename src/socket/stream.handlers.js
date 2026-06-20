/**
 * Legacy Pi CCTV stream-session signaling removed (MediaMTX uses direct browser URLs).
 * Handler registration kept as a no-op so socket disconnect wiring stays stable.
 */
export function registerStreamHandlers(_io, _socket) {
  return {
    handleDisconnect: async () => {},
    closeSession: async () => {},
  };
}
