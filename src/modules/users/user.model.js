/**
 * User model (Sequelize)
 * id (UUID), user_id (string unique), name, email (optional), password_hash,
 * role (SUPER_ADMIN | DIVISION_ADMIN | MONITOR | USER),
 * status (ACTIVE | INACTIVE | PENDING_APPROVAL),
 * optional division assignment, created_by, timestamps.
 */

import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
      unique: true,
    },
    password_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    password_reset_token_hash: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    password_reset_expires: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM('SUPER_ADMIN', 'DIVISION_ADMIN', 'MONITOR', 'USER'),
      allowNull: false,
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'divisions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    status: {
      type: DataTypes.ENUM('ACTIVE', 'INACTIVE', 'PENDING_APPROVAL'),
      defaultValue: 'ACTIVE',
      allowNull: false,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    approved_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    crew_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    head_quarter: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    mobile: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    profile_image_key: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    account_origin: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'REGISTERED',
      validate: {
        isIn: [['REGISTERED', 'PUBLIC_FORM']],
      },
    },
  },
  {
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['division_id'],
        name: 'users_division_id_idx',
      },
      {
        fields: ['account_origin'],
        name: 'users_account_origin_idx',
      },
    ],
    defaultScope: {
      attributes: {
        exclude: ['password_hash', 'password_reset_token_hash'],
      },
    },
  }
);

export default User;
