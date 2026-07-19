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
    submission_source: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'AUTHENTICATED',
      validate: {
        isIn: [['AUTHENTICATED', 'PUBLIC']],
      },
    },
    staff_type: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    duty_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    idempotency_key: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    tableName: 'submissions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['user_id', 'submission_date'],
        name: 'submissions_user_submission_date_idx',
      },
      {
        fields: ['submission_date'],
        name: 'submissions_submission_date_idx',
      },
      {
        fields: ['created_at'],
        name: 'submissions_created_at_idx',
      },
      {
        fields: ['submission_source'],
        name: 'submissions_submission_source_idx',
      },
      {
        fields: ['staff_type', 'duty_type', 'submission_date'],
        name: 'submissions_context_date_idx',
      },
    ],
  }
);

export default Submission;
