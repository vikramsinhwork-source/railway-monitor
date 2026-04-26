import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const MonitoringSession = sequelize.define(
  'MonitoringSession',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'divisions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    lobby_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'lobbies', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    device_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'devices', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    monitor_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'ENDED', 'TIMEOUT', 'FORCED'),
      allowNull: false,
      defaultValue: 'ACTIVE',
    },
    disconnect_reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    access_token: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    token_expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'monitoring_sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['device_id'], name: 'monitoring_sessions_device_id_idx' },
      { fields: ['monitor_user_id'], name: 'monitoring_sessions_monitor_user_id_idx' },
      { fields: ['division_id', 'lobby_id'], name: 'monitoring_sessions_division_lobby_idx' },
      { fields: ['status'], name: 'monitoring_sessions_status_idx' },
      { fields: ['access_token'], name: 'monitoring_sessions_access_token_idx' },
      {
        fields: ['device_id'],
        unique: true,
        where: { status: 'ACTIVE' },
        name: 'monitoring_sessions_active_device_unique_idx',
      },
    ],
  }
);

export default MonitoringSession;
