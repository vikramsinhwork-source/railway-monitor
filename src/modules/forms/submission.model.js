import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Submission = sequelize.define(
  'Submission',
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
    form_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'forms',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    submission_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
  },
  {
    tableName: 'submissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'submission_date'],
        name: 'submissions_one_per_user_per_day_idx',
      },
      {
        fields: ['submission_date'],
        name: 'submissions_submission_date_idx',
      },
      {
        fields: ['created_at'],
        name: 'submissions_created_at_idx',
      },
    ],
  }
);

export default Submission;
