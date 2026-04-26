import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const SocketPresence = sequelize.define(
  'SocketPresence',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    socket_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
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
    last_heartbeat_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    is_online: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    offline_reason: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: 'socket_presence',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'], name: 'socket_presence_user_id_idx' },
      { fields: ['division_id'], name: 'socket_presence_division_id_idx' },
      { fields: ['lobby_id'], name: 'socket_presence_lobby_id_idx' },
      { fields: ['is_online', 'last_heartbeat_at'], name: 'socket_presence_online_heartbeat_idx' },
    ],
  }
);

export default SocketPresence;
