import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const MonitoringAuditLog = sequelize.define(
  'MonitoringAuditLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    observer_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    observer_role: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    session_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'monitoring_sessions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'divisions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    lobby_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'lobbies', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    action: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    result: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'SUCCESS',
    },
    ip_address: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    device_info: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    joined_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    left_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'monitoring_audit_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['session_id'], name: 'monitoring_audit_logs_session_id_idx' },
      { fields: ['observer_user_id'], name: 'monitoring_audit_logs_observer_user_id_idx' },
      { fields: ['division_id'], name: 'monitoring_audit_logs_division_id_idx' },
      { fields: ['action'], name: 'monitoring_audit_logs_action_idx' },
    ],
  }
);

export default MonitoringAuditLog;
