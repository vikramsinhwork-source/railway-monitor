import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const DeviceHeartbeat = sequelize.define(
  'DeviceHeartbeat',
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
    received_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    tableName: 'device_heartbeats',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      {
        fields: ['device_id', 'received_at'],
        name: 'device_heartbeats_device_received_idx',
      },
    ],
  }
);

export default DeviceHeartbeat;
