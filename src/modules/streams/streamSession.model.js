import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const StreamSession = sequelize.define(
  'StreamSession',
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
    stream_type: {
      type: DataTypes.ENUM('KIOSK', 'CCTV'),
      allowNull: false,
    },
    stream_name: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    viewer_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM('REQUESTED', 'ACTIVE', 'CLOSED'),
      allowNull: false,
      defaultValue: 'REQUESTED',
    },
    offer: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    answer: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    ice_candidates: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'stream_sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['device_id', 'status'], name: 'stream_sessions_device_status_idx' },
      { fields: ['viewer_user_id', 'status'], name: 'stream_sessions_viewer_status_idx' },
      { fields: ['status', 'updated_at'], name: 'stream_sessions_status_updated_idx' },
    ],
  }
);

export default StreamSession;
