import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const DeviceCommand = sequelize.define(
  'DeviceCommand',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    device_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'devices', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    command: {
      type: DataTypes.ENUM('REBOOT', 'REFRESH_STREAM', 'OPEN_VNC', 'RESTART_APP'),
      allowNull: false,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    requested_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    requested_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'device_command_queue',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['device_id', 'status', 'requested_at'],
        name: 'device_command_queue_device_status_requested_idx',
      },
      {
        fields: ['status'],
        name: 'device_command_queue_status_idx',
      },
      {
        fields: ['requested_by'],
        name: 'device_command_queue_requested_by_idx',
      },
    ],
  }
);

export default DeviceCommand;
