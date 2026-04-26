import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const MonitorLobbyAccess = sequelize.define(
  'MonitorLobbyAccess',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
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
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'monitor_lobby_access',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['user_id'],
        name: 'monitor_lobby_access_user_id_idx',
      },
      {
        fields: ['lobby_id'],
        name: 'monitor_lobby_access_lobby_id_idx',
      },
      {
        unique: true,
        fields: ['user_id', 'lobby_id'],
        name: 'monitor_lobby_access_user_lobby_unique_idx',
      },
    ],
  }
);

export default MonitorLobbyAccess;
