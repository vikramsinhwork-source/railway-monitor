import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Device = sequelize.define(
  'Device',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'divisions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    lobby_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'lobbies',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    device_type: {
      type: DataTypes.ENUM('KIOSK', 'CAMERA', 'DVR', 'RASPBERRY', 'NVR'),
      allowNull: false,
    },
    device_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    stream_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ip_address: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    mac_address: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    serial_number: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('ONLINE', 'OFFLINE', 'MAINTENANCE'),
      allowNull: false,
      defaultValue: 'OFFLINE',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    health_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    last_health_check_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_recovery_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    failure_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    offline_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    consecutive_failures: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    consecutive_success: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    health_reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    last_error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    auto_heal_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    firmware_version: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'devices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['division_id'],
        name: 'devices_division_id_idx',
      },
      {
        fields: ['lobby_id'],
        name: 'devices_lobby_id_idx',
      },
      {
        unique: true,
        fields: ['division_id', 'lobby_id', 'device_name'],
        name: 'devices_division_lobby_name_unique_idx',
      },
    ],
  }
);

export default Device;
