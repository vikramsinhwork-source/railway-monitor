/**
 * Division scoping for live kiosk presence (LIVE LOBBIES).
 * SUPER_ADMIN sees all unless a selected division is set on the socket.
 * DIVISION_ADMIN / MONITOR only see kiosks in their division.
 */

import { normalizeRole, ROLES } from '../middleware/rbac.middleware.js';

export function canMonitorSeeKiosk(monitorUser, kioskDivisionId, selectedDivisionId = null) {
  if (!monitorUser) return true;

  const role = normalizeRole(monitorUser.role);
  const scopedDivisionId = selectedDivisionId || monitorUser.division_id || null;

  if (role === ROLES.SUPER_ADMIN) {
    if (!scopedDivisionId) return true;
    if (!kioskDivisionId) return false;
    return kioskDivisionId === scopedDivisionId;
  }

  if (!scopedDivisionId) return false;
  if (!kioskDivisionId) return true;
  return kioskDivisionId === scopedDivisionId;
}

export function filterKiosksForMonitor(kiosks, monitorUser, selectedDivisionId = null) {
  return (kiosks || []).filter((kiosk) =>
    canMonitorSeeKiosk(
      monitorUser,
      kiosk.divisionId ?? kiosk.division_id ?? null,
      selectedDivisionId
    )
  );
}

export function emitToEligibleMonitors(io, event, payload, kioskDivisionId) {
  const room = io.sockets.adapter.rooms.get('monitors');
  if (!room) return;

  const body = {
    ...payload,
    division_id: kioskDivisionId || null,
  };

  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const selectedDivisionId = socket.data?.selectedDivisionId || null;
    if (canMonitorSeeKiosk(socket.data?.user || null, kioskDivisionId, selectedDivisionId)) {
      socket.emit(event, body);
    }
  }
}
