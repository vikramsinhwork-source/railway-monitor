import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const SessionObserver = sequelize.define(
  'SessionObserver',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    session_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'monitoring_sessions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    observer_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    observer_role: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    observer_socket_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    joined_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    left_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'session_observers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['session_id'], name: 'session_observers_session_id_idx' },
      { fields: ['observer_user_id'], name: 'session_observers_observer_user_id_idx' },
    ],
  }
);

export default SessionObserver;
