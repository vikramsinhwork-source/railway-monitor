import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const DeviceHealthSnapshot = sequelize.define(
  'DeviceHealthSnapshot',
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
    check_tier: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    health_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    health_reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    check_result: {
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
    tableName: 'device_health_snapshots',
    timestamps: false,
    indexes: [
      { fields: ['device_id', 'created_at'], name: 'device_health_snapshots_device_created_idx' },
      { fields: ['check_tier', 'created_at'], name: 'device_health_snapshots_tier_created_idx' },
    ],
  }
);

export default DeviceHealthSnapshot;
