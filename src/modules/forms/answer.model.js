import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Answer = sequelize.define(
  'Answer',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    submission_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'submissions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    question_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'questions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    answer_text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: 'answers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['submission_id', 'question_id'],
        name: 'answers_unique_question_per_submission_idx',
      },
    ],
  }
);

export default Answer;
