import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const RegisterQuestion = sequelize.define(
  'RegisterQuestion',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    register_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'registers',
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
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    column_label: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    is_key_field: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: 'register_questions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['register_id', 'question_id'],
        name: 'register_questions_register_question_unique_idx',
      },
      {
        fields: ['register_id', 'sort_order'],
        name: 'register_questions_register_sort_order_idx',
      },
    ],
  }
);

export default RegisterQuestion;
