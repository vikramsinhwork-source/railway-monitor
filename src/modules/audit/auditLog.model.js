import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    action: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    entity_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    old_data: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    new_data: {
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
    tableName: 'audit_logs',
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    indexes: [
      {
        fields: ['user_id'],
        name: 'audit_logs_user_id_idx',
      },
      {
        fields: ['entity_type', 'entity_id'],
        name: 'audit_logs_entity_lookup_idx',
      },
      {
        fields: ['created_at'],
        name: 'audit_logs_created_at_idx',
      },
    ],
  }
);

export default AuditLog;
