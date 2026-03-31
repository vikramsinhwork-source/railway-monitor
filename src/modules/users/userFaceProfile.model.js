/**
 * One face enrollment per user: Rekognition FaceId + optional S3 key during processing.
 */

import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';
import User from './user.model.js';

const UserFaceProfile = sequelize.define(
  'UserFaceProfile',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: 'users', key: 'id' },
    },
    rekognition_face_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    s3_key: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'active', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'user_face_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

UserFaceProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasOne(UserFaceProfile, { foreignKey: 'user_id', as: 'faceProfile' });

export default UserFaceProfile;
