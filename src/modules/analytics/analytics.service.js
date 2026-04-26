import { QueryTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';
import Lobby from '../divisions/lobby.model.js';
import Device from '../divisions/device.model.js';
import MonitorLobbyAccess from '../access/monitorLobby.model.js';
import { ROLES, isSuperAdminRole, normalizeRole } from '../../middleware/rbac.middleware.js';

const DEFAULT_RANGE_DAYS = 30;
const MAX_LIMIT = 200;

const INCIDENT_SEVERITY_MAP = {
  CRITICAL: ['CRITICAL'],
  HIGH: ['DEGRADED', 'OFFLINE'],
  MEDIUM: ['UNKNOWN', 'RECOVERING'],
};

function parseDateRange(query) {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  let from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86400000);
  }
  return { from, to };
}

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function parseSort(query, allowed, defaultField = 'created_at', defaultDirection = 'DESC') {
  const raw = (query.sort || '').trim();
  if (!raw) return { field: defaultField, direction: defaultDirection };
  const [field, dirRaw] = raw.split(':');
  const f = (field || '').trim();
  const d = (dirRaw || 'desc').trim().toLowerCase();
  const direction = d === 'asc' ? 'ASC' : 'DESC';
  if (!allowed.includes(f)) return { field: defaultField, direction: defaultDirection };
  return { field: f, direction };
}

async function selectAll(sql, replacements) {
  return sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
}

async function selectOne(sql, replacements) {
  const rows = await selectAll(sql, replacements);
  return rows[0] || {};
}

function tierDowntimeMinutesSql(column = 'check_tier') {
  return `
    CASE ${column}
      WHEN 'HEARTBEAT_30S' THEN 0.5
      WHEN 'PING_2M' THEN 2
      WHEN 'DEEP_STREAM_10M' THEN 10
      ELSE 1
    END
  `;
}

function isHealthySnapshotStatus() {
  return `health_status IN ('ONLINE','RECOVERING','MAINTENANCE')`;
}

export async function resolveAnalyticsScope(user, query) {
  const role = normalizeRole(user.role);
  const { from, to } = parseDateRange(query);
  const requestedDivisionId = query.division_id || query.divisionId || null;

  const scope = {
    from,
    to,
    role,
    divisionIds: null,
    lobbyIds: null,
    scopeEmpty: false,
  };

  if (role === ROLES.SUPER_ADMIN) {
    if (requestedDivisionId) scope.divisionIds = [requestedDivisionId];
    return scope;
  }

  if (role === ROLES.DIVISION_ADMIN) {
    if (!user.division_id) {
      const err = new Error('NO_DIVISION');
      err.code = 'NO_DIVISION';
      throw err;
    }
    if (requestedDivisionId && requestedDivisionId !== user.division_id) {
      const err = new Error('DIVISION_MISMATCH');
      err.code = 'FORBIDDEN';
      throw err;
    }
    scope.divisionIds = [user.division_id];
    return scope;
  }

  if (role === ROLES.MONITOR) {
    if (!user.division_id) {
      const err = new Error('NO_DIVISION');
      err.code = 'NO_DIVISION';
      throw err;
    }
    if (requestedDivisionId && requestedDivisionId !== user.division_id) {
      const err = new Error('DIVISION_MISMATCH');
      err.code = 'FORBIDDEN';
      throw err;
    }
    scope.divisionIds = [user.division_id];
    const rows = await MonitorLobbyAccess.findAll({
      where: {
        user_id: user.id,
        division_id: user.division_id,
        is_active: true,
      },
      attributes: ['lobby_id'],
    });
    scope.lobbyIds = rows.map((r) => r.lobby_id);
    if (scope.lobbyIds.length === 0) scope.scopeEmpty = true;
    return scope;
  }

  const err = new Error('ROLE');
  err.code = 'FORBIDDEN';
  throw err;
}

function bindScope(scope, binds) {
  if (scope.scopeEmpty) return 'AND 1=0';
  const parts = [];
  if (scope.divisionIds?.length) {
    parts.push('division_id IN (:divisionIds)');
    binds.divisionIds = scope.divisionIds;
  }
  if (scope.lobbyIds?.length) {
    parts.push('lobby_id IN (:lobbyIds)');
    binds.lobbyIds = scope.lobbyIds;
  }
  return parts.length ? `AND ${parts.join(' AND ')}` : '';
}

function bindScopeDeviceAlias(scope, binds, alias = 'd') {
  if (scope.scopeEmpty) return `AND 1=0`;
  const parts = [];
  if (scope.divisionIds?.length) {
    parts.push(`${alias}.division_id IN (:divisionIds)`);
    binds.divisionIds = scope.divisionIds;
  }
  if (scope.lobbyIds?.length) {
    parts.push(`${alias}.lobby_id IN (:lobbyIds)`);
    binds.lobbyIds = scope.lobbyIds;
  }
  return parts.length ? `AND ${parts.join(' AND ')}` : '';
}

function bindScopeDl(scope, binds) {
  if (scope.scopeEmpty) return 'AND 1=0';
  const parts = [];
  if (scope.divisionIds?.length) {
    parts.push('dl.division_id IN (:divisionIds)');
    binds.divisionIds = scope.divisionIds;
  }
  if (scope.lobbyIds?.length) {
    parts.push('dl.lobby_id IN (:lobbyIds)');
    binds.lobbyIds = scope.lobbyIds;
  }
  return parts.length ? `AND ${parts.join(' AND ')}` : '';
}

export async function getSummary(user, query) {
  const scope = await resolveAnalyticsScope(user, query);
  const binds = {
    from: scope.from,
    to: scope.to,
  };
  const divFilter = bindScope(scope, binds);
  const divFilterD = bindScopeDeviceAlias(scope, binds, 'd');
  const divFilterDl = bindScopeDl(scope, binds);

  const uptimeRow = await selectOne(
    `
    SELECT
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        100
      )::float AS uptime_pct,
      COALESCE(SUM(CASE WHEN health_status IN ('OFFLINE','CRITICAL','UNKNOWN')
        THEN (${tierDowntimeMinutesSql()}) ELSE 0 END), 0)::float AS downtime_minutes
    FROM device_health_snapshots
    WHERE created_at >= :from AND created_at <= :to
    ${divFilter}
    `,
    binds
  );

  const incidentRow = await selectOne(
    `
    SELECT COUNT(*)::int AS critical_incidents
    FROM device_logs dl
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' = 'CRITICAL'
    `,
    binds
  );

  const mttrRow = await selectOne(
    `
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (processed_at - requested_at)) / 60.0), 0)::float AS mttr_minutes
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.status = 'COMPLETED'
      AND dcq.processed_at IS NOT NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    `,
    binds
  );

  const failCount = await selectOne(
    `
    SELECT COUNT(DISTINCT (dl.device_id, date_trunc('minute', dl.created_at)))::int AS failure_events
    FROM device_logs dl
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
    `,
    binds
  );

  const windowMinutes = Math.max(1, (scope.to - scope.from) / 60000);
  const deviceCountRows = await selectAll(
    `SELECT COUNT(*)::int AS c FROM devices d WHERE d.is_active = true ${divFilterD}`,
    binds
  );
  const deviceCount = Math.max(1, deviceCountRows[0]?.c || 1);
  const mtbfMinutes =
    failCount.failure_events > 0 ? (windowMinutes * deviceCount) / failCount.failure_events : null;

  const autohealRow = await selectOne(
    `
    SELECT
      COUNT(*) FILTER (WHERE dcq.status = 'COMPLETED')::int AS ok,
      COUNT(*) FILTER (WHERE dcq.status = 'FAILED')::int AS fail
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.requested_by IS NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    `,
    binds
  );

  const ok = autohealRow?.ok || 0;
  const fail = autohealRow?.fail || 0;
  const autohealSuccessPct = ok + fail > 0 ? (100.0 * ok) / (ok + fail) : null;

  const topFailing = await selectAll(
    `
    SELECT d.id, d.device_name, d.division_id, d.lobby_id,
      COUNT(*)::int AS failure_events
    FROM device_logs dl
    INNER JOIN devices d ON d.id = dl.device_id
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterD}
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
    GROUP BY d.id, d.device_name, d.division_id, d.lobby_id
    ORDER BY failure_events DESC
    LIMIT 10
    `,
    binds
  );

  const divisionBinds = { ...binds };
  const divisionWhere = scope.divisionIds?.length ? 'AND dvs.id IN (:divisionIds)' : '';
  if (scope.divisionIds?.length) divisionBinds.divisionIds = scope.divisionIds;
  const divisionLobbyJoin =
    scope.lobbyIds?.length > 0 ? 'AND dhs.lobby_id IN (:lobbyIds)' : '';
  if (scope.lobbyIds?.length) divisionBinds.lobbyIds = scope.lobbyIds;

  const divisionRanking = await selectAll(
    `
    SELECT dvs.id AS division_id, dvs.name AS division_name,
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(dhs.id), 0),
        100
      )::float AS uptime_pct,
      COALESCE(SUM(CASE WHEN dhs.health_status IN ('OFFLINE','CRITICAL','UNKNOWN')
        THEN (${tierDowntimeMinutesSql('dhs.check_tier')}) ELSE 0 END), 0)::float AS downtime_minutes
    FROM divisions dvs
    LEFT JOIN device_health_snapshots dhs ON dhs.division_id = dvs.id
      AND dhs.created_at >= :from AND dhs.created_at <= :to
      ${divisionLobbyJoin}
    WHERE 1=1
    ${divisionWhere}
    GROUP BY dvs.id, dvs.name
    HAVING COUNT(dhs.id) > 0 OR EXISTS (
      SELECT 1 FROM devices dev WHERE dev.division_id = dvs.id AND dev.is_active = true LIMIT 1
    )
    ORDER BY uptime_pct ASC
    LIMIT 50
    `,
    divisionBinds
  );

  const operatorBinds = { from: scope.from, to: scope.to };
  const operatorDivClause = scope.divisionIds?.length ? 'AND u.division_id IN (:divisionIds)' : '';
  if (scope.divisionIds?.length) operatorBinds.divisionIds = scope.divisionIds;

  const operatorActivity = await selectAll(
    `
    SELECT u.id AS user_id, u.name, u.user_id AS login_id, COUNT(al.id)::int AS actions
    FROM audit_logs al
    INNER JOIN users u ON u.id = al.user_id
    WHERE al.created_at >= :from AND al.created_at <= :to
    ${operatorDivClause}
    GROUP BY u.id, u.name, u.user_id
    ORDER BY actions DESC
    LIMIT 15
    `,
    operatorBinds
  );

  const highRisk = await loadHighRiskDevices(scope, binds);

  return {
    range: { from: scope.from.toISOString(), to: scope.to.toISOString() },
    uptime_pct: Math.round((uptimeRow?.uptime_pct ?? 100) * 100) / 100,
    downtime_minutes: Math.round((uptimeRow?.downtime_minutes ?? 0) * 100) / 100,
    critical_incidents: incidentRow?.critical_incidents ?? 0,
    mttr_minutes: Math.round((mttrRow?.mttr_minutes ?? 0) * 100) / 100,
    mtbf_minutes: mtbfMinutes != null ? Math.round(mtbfMinutes * 100) / 100 : null,
    autoheal_success_pct: autohealSuccessPct != null ? Math.round(autohealSuccessPct * 100) / 100 : null,
    top_failing_devices: topFailing,
    division_ranking: divisionRanking,
    operator_activity: operatorActivity,
    predictive_flags: { high_risk_devices: highRisk },
  };
}

async function loadHighRiskDevices(scope, baseBinds) {
  if (scope.scopeEmpty) return [];
  const binds = { ...baseBinds, sevenDaysAgo: new Date(Date.now() - 7 * 86400000) };
  const divD = bindScopeDeviceAlias(scope, binds, 'd');

  const rows = await selectAll(
    `
    SELECT d.id, d.device_name, d.division_id, d.lobby_id,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(cf.cnt, 0) >= 3 THEN 'FAILURES_7D_3PLUS' END,
        CASE WHEN COALESCE(rf.cnt, 0) >= 2 THEN 'REPEATED_RETRIES' END,
        CASE WHEN (
          LOWER(COALESCE(d.health_reason, '')) LIKE '%heat%'
          OR LOWER(COALESCE(d.last_error_message, '')) LIKE '%heat%'
          OR COALESCE(d.failure_score, 0) >= 90
        ) THEN 'HEAT_OR_STRESS' END
      ], NULL) AS flags
    FROM devices d
    LEFT JOIN (
      SELECT dl.device_id, COUNT(*)::int AS cnt
      FROM device_logs dl
      WHERE dl.created_at >= :sevenDaysAgo
        AND dl.log_type LIKE 'HEALTH_%'
        AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
      GROUP BY dl.device_id
    ) cf ON cf.device_id = d.id
    LEFT JOIN (
      SELECT device_id, COUNT(*)::int AS cnt
      FROM device_command_queue
      WHERE status = 'FAILED' AND requested_at >= :sevenDaysAgo
      GROUP BY device_id
    ) rf ON rf.device_id = d.id
    WHERE d.is_active = true ${divD}
      AND (
        COALESCE(cf.cnt, 0) >= 3
        OR COALESCE(rf.cnt, 0) >= 2
        OR LOWER(COALESCE(d.health_reason, '')) LIKE '%heat%'
        OR LOWER(COALESCE(d.last_error_message, '')) LIKE '%heat%'
        OR COALESCE(d.failure_score, 0) >= 90
      )
    `,
    binds
  );

  return rows
    .map((r) => ({
      device_id: r.id,
      device_name: r.device_name,
      division_id: r.division_id,
      lobby_id: r.lobby_id,
      risk_level: 'HIGH_RISK',
      flags: (r.flags || []).filter(Boolean),
    }))
    .filter((r) => r.flags.length);
}

export async function getDivisionsBreakdown(user, query) {
  const scope = await resolveAnalyticsScope(user, query);
  if (normalizeRole(user.role) === ROLES.MONITOR) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const binds = { from: scope.from, to: scope.to };
  const divisionWhere = scope.divisionIds?.length ? 'AND dvs.id IN (:divisionIds)' : '';
  if (scope.divisionIds?.length) binds.divisionIds = scope.divisionIds;
  const divisionLobbyJoin =
    scope.lobbyIds?.length > 0 ? 'AND dhs.lobby_id IN (:lobbyIds)' : '';
  if (scope.lobbyIds?.length) binds.lobbyIds = scope.lobbyIds;

  const rows = await selectAll(
    `
    SELECT dvs.id AS division_id, dvs.name AS division_name, dvs.code AS division_code,
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(dhs.id), 0),
        100
      )::float AS uptime_pct,
      COALESCE(SUM(CASE WHEN dhs.health_status IN ('OFFLINE','CRITICAL','UNKNOWN')
        THEN (${tierDowntimeMinutesSql('dhs.check_tier')}) ELSE 0 END), 0)::float AS downtime_minutes
    FROM divisions dvs
    LEFT JOIN device_health_snapshots dhs ON dhs.division_id = dvs.id
      AND dhs.created_at >= :from AND dhs.created_at <= :to
      ${divisionLobbyJoin}
    WHERE 1=1
    ${divisionWhere}
    GROUP BY dvs.id, dvs.name, dvs.code
    HAVING COUNT(dhs.id) > 0 OR EXISTS (
      SELECT 1 FROM devices dev WHERE dev.division_id = dvs.id AND dev.is_active = true LIMIT 1
    )
    ORDER BY uptime_pct ASC
    `,
    binds
  );

  return rows.map((r) => ({
    division_id: r.division_id,
    division_name: r.division_name,
    division_code: r.division_code,
    uptime_pct: Math.round((r.uptime_pct ?? 100) * 100) / 100,
    downtime_minutes: Math.round((r.downtime_minutes ?? 0) * 100) / 100,
  }));
}

async function assertLobbyAccess(user, lobbyId) {
  const lobby = await Lobby.findByPk(lobbyId, { attributes: ['id', 'division_id', 'name', 'station_name'] });
  if (!lobby) return null;
  const role = normalizeRole(user.role);
  if (isSuperAdminRole(role)) return lobby;
  if (!user.division_id || user.division_id !== lobby.division_id) return { forbidden: true };
  if (role === ROLES.DIVISION_ADMIN) return lobby;
  if (role === ROLES.MONITOR) {
    const access = await MonitorLobbyAccess.findOne({
      where: {
        user_id: user.id,
        division_id: user.division_id,
        lobby_id: lobbyId,
        is_active: true,
      },
    });
    if (!access) return { forbidden: true };
    return lobby;
  }
  return { forbidden: true };
}

export async function getLobbyAnalytics(user, lobbyId, query) {
  if (normalizeRole(user.role) === ROLES.MONITOR) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const lobby = await assertLobbyAccess(user, lobbyId);
  if (!lobby) return null;
  if (lobby.forbidden) return { forbidden: true };

  const { from, to } = parseDateRange(query);
  const binds = { from, to, lobbyId };

  const agg = await selectOne(
    `
    SELECT
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        100
      )::float AS uptime_pct,
      COALESCE(SUM(CASE WHEN health_status IN ('OFFLINE','CRITICAL','UNKNOWN')
        THEN (${tierDowntimeMinutesSql()}) ELSE 0 END), 0)::float AS downtime_minutes,
      COUNT(*) FILTER (WHERE health_status = 'CRITICAL')::int AS critical_snapshots
    FROM device_health_snapshots
    WHERE lobby_id = :lobbyId AND created_at >= :from AND created_at <= :to
    `,
    binds
  );

  const devices = await selectAll(
    `
    SELECT d.id, d.device_name, d.health_status, d.failure_score,
      COUNT(dl.id)::int AS incident_logs
    FROM devices d
    LEFT JOIN device_logs dl ON dl.device_id = d.id AND dl.created_at >= :from AND dl.created_at <= :to
      AND dl.log_type LIKE 'HEALTH_%' AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
    WHERE d.lobby_id = :lobbyId AND d.is_active = true
    GROUP BY d.id, d.device_name, d.health_status, d.failure_score
    ORDER BY incident_logs DESC
    `,
    binds
  );

  const scope = {
    from,
    to,
    role: ROLES.DIVISION_ADMIN,
    divisionIds: [lobby.division_id],
    lobbyIds: [lobbyId],
    scopeEmpty: false,
  };
  const highRiskBinds = { ...binds, divisionIds: [lobby.division_id], lobbyIds: [lobbyId] };
  const highRisk = await loadHighRiskDevices(scope, highRiskBinds);

  return {
    lobby_id: lobby.id,
    lobby_name: lobby.name,
    station_name: lobby.station_name,
    division_id: lobby.division_id,
    range: { from: from.toISOString(), to: to.toISOString() },
    uptime_pct: Math.round((agg?.uptime_pct ?? 100) * 100) / 100,
    downtime_minutes: Math.round((agg?.downtime_minutes ?? 0) * 100) / 100,
    critical_snapshots: agg?.critical_snapshots ?? 0,
    devices,
    predictive_flags: { high_risk_devices: highRisk },
  };
}

function canAccessDevice(user, device) {
  const role = normalizeRole(user.role);
  if (isSuperAdminRole(role)) return true;
  if (!user.division_id || user.division_id !== device.division_id) return false;
  if (role === ROLES.DIVISION_ADMIN) return true;
  return false;
}

export async function getDeviceAnalytics(user, deviceId, query) {
  if (normalizeRole(user.role) === ROLES.MONITOR) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const device = await Device.findByPk(deviceId);
  if (!device) return null;
  if (!canAccessDevice(user, device)) return { forbidden: true };

  const { from, to } = parseDateRange(query);
  const binds = { from, to, deviceId };

  const snap = await selectOne(
    `
    SELECT
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        100
      )::float AS uptime_pct,
      COALESCE(SUM(CASE WHEN health_status IN ('OFFLINE','CRITICAL','UNKNOWN')
        THEN (${tierDowntimeMinutesSql()}) ELSE 0 END), 0)::float AS downtime_minutes
    FROM device_health_snapshots
    WHERE device_id = :deviceId AND created_at >= :from AND created_at <= :to
    `,
    binds
  );

  const cmds = await selectOne(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
    FROM device_command_queue
    WHERE device_id = :deviceId AND requested_at >= :from AND requested_at <= :to
    `,
    binds
  );

  const logs = await selectOne(
    `
    SELECT COUNT(*)::int AS c FROM device_logs dl
    WHERE dl.device_id = :deviceId AND dl.created_at >= :from AND dl.created_at <= :to
    AND dl.log_type LIKE 'HEALTH_%' AND dl.details->>'status' = 'CRITICAL'
    `,
    binds
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const fail7 = await selectOne(
    `
    SELECT COUNT(*)::int AS c FROM device_logs dl
    WHERE dl.device_id = :deviceId AND dl.created_at >= :sevenDaysAgo
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
    `,
    { ...binds, sevenDaysAgo }
  );

  const failedCmds = await selectOne(
    `
    SELECT COUNT(*)::int AS c FROM device_command_queue
    WHERE device_id = :deviceId AND status = 'FAILED' AND requested_at >= :sevenDaysAgo
    `,
    { ...binds, sevenDaysAgo }
  );

  const flags = [];
  if ((fail7?.c || 0) >= 3) flags.push('FAILURES_7D_3PLUS');
  if ((failedCmds?.c || 0) >= 2) flags.push('REPEATED_RETRIES');
  const heat =
    String(device.health_reason || '')
      .toLowerCase()
      .includes('heat') ||
    String(device.last_error_message || '')
      .toLowerCase()
      .includes('heat') ||
    (device.failure_score || 0) >= 90;
  if (heat) flags.push('HEAT_OR_STRESS');

  return {
    device_id: device.id,
    device_name: device.device_name,
    division_id: device.division_id,
    lobby_id: device.lobby_id,
    range: { from: from.toISOString(), to: to.toISOString() },
    uptime_pct: Math.round((snap?.uptime_pct ?? 100) * 100) / 100,
    downtime_minutes: Math.round((snap?.downtime_minutes ?? 0) * 100) / 100,
    critical_incidents: logs?.c ?? 0,
    commands_completed: cmds?.completed ?? 0,
    commands_failed: cmds?.failed ?? 0,
    predictive_flags: {
      risk_level: flags.length ? 'HIGH_RISK' : 'NORMAL',
      flags,
    },
  };
}

export async function getIncidents(user, query) {
  if (normalizeRole(user.role) === ROLES.MONITOR) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const scope = await resolveAnalyticsScope(user, query);
  const { page, limit, offset } = parsePagination(query);
  const severity = query.severity || null;
  const binds = {
    from: scope.from,
    to: scope.to,
    limit,
    offset,
  };
  const divFilterDl = bindScopeDl(scope, binds);

  let sevClause = `AND dl.details->>'status' IN ('CRITICAL','DEGRADED','OFFLINE','UNKNOWN')`;
  if (severity && INCIDENT_SEVERITY_MAP[severity]) {
    binds.severityStatuses = INCIDENT_SEVERITY_MAP[severity];
    sevClause = `AND dl.details->>'status' IN (:severityStatuses)`;
  }

  const sort = parseSort(query, ['created_at', 'log_type'], 'created_at', 'DESC');

  const rows = await selectAll(
    `
    SELECT dl.id, dl.device_id, dl.division_id, dl.lobby_id, dl.log_type, dl.message, dl.details, dl.created_at,
      d.device_name,
      CASE dl.details->>'status'
        WHEN 'CRITICAL' THEN 'CRITICAL'
        WHEN 'OFFLINE' THEN 'HIGH'
        WHEN 'DEGRADED' THEN 'HIGH'
        ELSE 'MEDIUM'
      END AS severity
    FROM device_logs dl
    INNER JOIN devices d ON d.id = dl.device_id
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    ${sevClause}
    ORDER BY dl.${sort.field} ${sort.direction}
    LIMIT :limit OFFSET :offset
    `,
    binds
  );

  const countRow = await selectOne(
    `
    SELECT COUNT(*)::int AS total
    FROM device_logs dl
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    ${sevClause}
    `,
    { ...binds, limit: undefined, offset: undefined }
  );

  const total = countRow?.total ?? 0;

  return {
    incidents: rows,
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit) || 1,
  };
}

export async function getAutoheal(user, query) {
  if (normalizeRole(user.role) === ROLES.MONITOR) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const scope = await resolveAnalyticsScope(user, query);
  const { page, limit, offset } = parsePagination(query);
  const binds = { from: scope.from, to: scope.to, limit, offset };
  const divFilterD = bindScopeDeviceAlias(scope, binds, 'd');
  const sort = parseSort(query, ['requested_at', 'status'], 'requested_at', 'DESC');

  const summary = await selectOne(
    `
    SELECT
      COUNT(*) FILTER (WHERE dcq.status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE dcq.status = 'FAILED')::int AS failed,
      COUNT(*)::int AS total
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.requested_by IS NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    `,
    binds
  );

  const rows = await selectAll(
    `
    SELECT dcq.id, dcq.device_id, dcq.command, dcq.status, dcq.requested_at, dcq.processed_at, dcq.error_message,
      d.device_name
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.requested_by IS NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    ORDER BY dcq.${sort.field} ${sort.direction}
    LIMIT :limit OFFSET :offset
    `,
    binds
  );

  const countRow = await selectOne(
    `
    SELECT COUNT(*)::int AS total
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.requested_by IS NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    `,
    { ...binds, limit: undefined, offset: undefined }
  );

  const total = countRow?.total ?? 0;
  const ok = summary?.completed || 0;
  const fail = summary?.failed || 0;
  const success_pct = ok + fail > 0 ? Math.round((10000 * ok) / (ok + fail)) / 100 : null;

  return {
    summary: {
      total_commands: summary?.total ?? 0,
      completed: ok,
      failed: fail,
      success_pct,
    },
    items: rows,
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit) || 1,
  };
}

export async function getSla(user, query) {
  const scope = await resolveAnalyticsScope(user, query);
  const binds = { from: scope.from, to: scope.to };
  const divFilter = bindScope(scope, binds);
  const divFilterD = bindScopeDeviceAlias(scope, binds, 'd');
  const divFilterDl = bindScopeDl(scope, binds);

  const uptimeRow = await selectOne(
    `
    SELECT
      COALESCE(
        100.0 * SUM(CASE WHEN ${isHealthySnapshotStatus()} THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        100
      )::float AS uptime_pct
    FROM device_health_snapshots
    WHERE created_at >= :from AND created_at <= :to
    ${divFilter}
    `,
    binds
  );

  const incidentRow = await selectOne(
    `
    SELECT COUNT(*)::int AS critical_incidents
    FROM device_logs dl
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' = 'CRITICAL'
    `,
    binds
  );

  const mttrRow = await selectOne(
    `
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (processed_at - requested_at)) / 60.0), 0)::float AS mttr_minutes
    FROM device_command_queue dcq
    INNER JOIN devices d ON d.id = dcq.device_id
    WHERE dcq.status = 'COMPLETED'
      AND dcq.processed_at IS NOT NULL
      AND dcq.requested_at >= :from AND dcq.requested_at <= :to
      ${divFilterD}
    `,
    binds
  );

  const windowMinutes = Math.max(1, (scope.to - scope.from) / 60000);
  const failCount = await selectOne(
    `
    SELECT COUNT(DISTINCT (dl.device_id, date_trunc('minute', dl.created_at)))::int AS failure_events
    FROM device_logs dl
    WHERE dl.created_at >= :from AND dl.created_at <= :to
    ${divFilterDl}
    AND dl.log_type LIKE 'HEALTH_%'
    AND dl.details->>'status' IN ('OFFLINE','CRITICAL','DEGRADED')
    `,
    binds
  );

  const deviceCountRows = await selectAll(
    `SELECT COUNT(*)::int AS c FROM devices d WHERE d.is_active = true ${divFilterD}`,
    binds
  );
  const deviceCount = Math.max(1, deviceCountRows[0]?.c || 1);
  const mtbfMinutes =
    failCount.failure_events > 0 ? (windowMinutes * deviceCount) / failCount.failure_events : null;

  const target_uptime_pct = 99.5;
  const target_mttr_minutes = 30;
  const uptime_pct = Math.round((uptimeRow?.uptime_pct ?? 100) * 100) / 100;
  const mttr_minutes = Math.round((mttrRow?.mttr_minutes ?? 0) * 100) / 100;

  return {
    range: { from: scope.from.toISOString(), to: scope.to.toISOString() },
    targets: { uptime_pct: target_uptime_pct, mttr_minutes: target_mttr_minutes },
    actuals: {
      uptime_pct,
      critical_incidents: incidentRow?.critical_incidents ?? 0,
      mttr_minutes,
      mtbf_minutes: mtbfMinutes != null ? Math.round(mtbfMinutes * 100) / 100 : null,
    },
    compliance: {
      uptime_met: uptime_pct >= target_uptime_pct,
      mttr_met: mttr_minutes <= target_mttr_minutes || mttr_minutes === 0,
    },
  };
}
