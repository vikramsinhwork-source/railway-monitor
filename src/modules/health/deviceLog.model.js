import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const DeviceLog = sequelize.define(
  'DeviceLog',
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
    log_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'device_logs',
    timestamps: false,
    indexes: [
      { fields: ['device_id', 'created_at'], name: 'device_logs_device_created_idx' },
      { fields: ['division_id', 'lobby_id'], name: 'device_logs_division_lobby_idx' },
    ],
  }
);

export default DeviceLog;
