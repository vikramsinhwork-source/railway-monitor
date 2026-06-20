import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const StreamCamera = sequelize.define(
  'StreamCamera',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    pi_device_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    lobby_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    mediamtx_path: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    location: {
      type: DataTypes.STRING(255),
      allowNull: true,
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
  },
  {
    tableName: 'stream_cameras',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['pi_device_id', 'mediamtx_path'],
        name: 'stream_cameras_pi_path_unique',
      },
    ],
  }
);

export default StreamCamera;
