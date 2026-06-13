import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const DeviceScreenshot = sequelize.define(
  'DeviceScreenshot',
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
    screen_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    storage_path: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    mime_type: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    size_bytes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    captured_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    tableName: 'device_screenshots',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      {
        fields: ['device_id', 'captured_at'],
        name: 'device_screenshots_device_captured_idx',
      },
    ],
  }
);

export default DeviceScreenshot;
