import User from '../modules/users/user.model.js';
import UserFaceProfile from '../modules/users/userFaceProfile.model.js';
import Division from '../modules/divisions/division.model.js';
import Lobby from '../modules/divisions/lobby.model.js';
import Device from '../modules/divisions/device.model.js';
import MonitorLobbyAccess from '../modules/access/monitorLobby.model.js';
import AuditLog from '../modules/audit/auditLog.model.js';
import MonitoringSession from '../modules/realtime/monitoringSession.model.js';
import SocketPresence from '../modules/realtime/socketPresence.model.js';
import DeviceCommand from '../modules/realtime/deviceCommand.model.js';
import DeviceLog from '../modules/health/deviceLog.model.js';
import DeviceHealthSnapshot from '../modules/health/deviceHealthSnapshot.model.js';
import { initFormModels } from '../modules/forms/index.js';

let initialized = false;

export function initModels() {
  if (initialized) {
    return;
  }

  initFormModels();

  Division.hasMany(Lobby, {
    foreignKey: 'division_id',
    as: 'lobbies',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Lobby.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Division.hasMany(Device, {
    foreignKey: 'division_id',
    as: 'devices',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Lobby.hasMany(Device, {
    foreignKey: 'lobby_id',
    as: 'devices',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Device.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Device.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Division.hasMany(User, {
    foreignKey: 'division_id',
    as: 'users',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  User.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  User.hasMany(MonitorLobbyAccess, {
    foreignKey: 'user_id',
    as: 'lobbyAccess',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitorLobbyAccess.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Division.hasMany(MonitorLobbyAccess, {
    foreignKey: 'division_id',
    as: 'monitorAccess',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitorLobbyAccess.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Lobby.hasMany(MonitorLobbyAccess, {
    foreignKey: 'lobby_id',
    as: 'monitorAccess',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitorLobbyAccess.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  User.hasMany(AuditLog, {
    foreignKey: 'user_id',
    as: 'auditLogs',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  AuditLog.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  User.hasMany(MonitoringSession, {
    foreignKey: 'monitor_user_id',
    as: 'monitoringSessions',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitoringSession.belongsTo(User, {
    foreignKey: 'monitor_user_id',
    as: 'monitorUser',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Division.hasMany(MonitoringSession, {
    foreignKey: 'division_id',
    as: 'monitoringSessions',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitoringSession.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Lobby.hasMany(MonitoringSession, {
    foreignKey: 'lobby_id',
    as: 'monitoringSessions',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitoringSession.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Device.hasMany(MonitoringSession, {
    foreignKey: 'device_id',
    as: 'monitoringSessions',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  MonitoringSession.belongsTo(Device, {
    foreignKey: 'device_id',
    as: 'device',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Device.hasMany(DeviceCommand, {
    foreignKey: 'device_id',
    as: 'commandQueue',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceCommand.belongsTo(Device, {
    foreignKey: 'device_id',
    as: 'device',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  User.hasMany(DeviceCommand, {
    foreignKey: 'requested_by',
    as: 'requestedDeviceCommands',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  DeviceCommand.belongsTo(User, {
    foreignKey: 'requested_by',
    as: 'requestedByUser',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  Device.hasMany(DeviceLog, {
    foreignKey: 'device_id',
    as: 'deviceLogs',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceLog.belongsTo(Device, {
    foreignKey: 'device_id',
    as: 'device',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Division.hasMany(DeviceLog, {
    foreignKey: 'division_id',
    as: 'deviceLogs',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceLog.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Lobby.hasMany(DeviceLog, {
    foreignKey: 'lobby_id',
    as: 'deviceLogs',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceLog.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  Device.hasMany(DeviceHealthSnapshot, {
    foreignKey: 'device_id',
    as: 'healthSnapshots',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceHealthSnapshot.belongsTo(Device, {
    foreignKey: 'device_id',
    as: 'device',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Division.hasMany(DeviceHealthSnapshot, {
    foreignKey: 'division_id',
    as: 'healthSnapshots',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceHealthSnapshot.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Lobby.hasMany(DeviceHealthSnapshot, {
    foreignKey: 'lobby_id',
    as: 'healthSnapshots',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  DeviceHealthSnapshot.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  User.hasMany(SocketPresence, {
    foreignKey: 'user_id',
    as: 'socketPresence',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  SocketPresence.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  Division.hasMany(SocketPresence, {
    foreignKey: 'division_id',
    as: 'socketPresence',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  SocketPresence.belongsTo(Division, {
    foreignKey: 'division_id',
    as: 'division',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  Lobby.hasMany(SocketPresence, {
    foreignKey: 'lobby_id',
    as: 'socketPresence',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  SocketPresence.belongsTo(Lobby, {
    foreignKey: 'lobby_id',
    as: 'lobby',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  initialized = true;
}

export {
  User,
  UserFaceProfile,
  Division,
  Lobby,
  Device,
  MonitorLobbyAccess,
  AuditLog,
  MonitoringSession,
  SocketPresence,
  DeviceCommand,
  DeviceLog,
  DeviceHealthSnapshot,
};
