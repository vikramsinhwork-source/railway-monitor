import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

export const QUESTION_FIELD_TYPES = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'DATE',
  'TIME',
  'DATETIME',
  'YES_NO',
  'DROPDOWN',
  'SIGNATURE',
];

const Question = sequelize.define(
  'Question',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    form_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'forms',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    prompt: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    field_type: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'TEXT',
      validate: {
        isIn: [QUESTION_FIELD_TYPES],
      },
    },
    options: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    key: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    is_required: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'questions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      {
        fields: ['form_id', 'sort_order'],
        name: 'questions_form_sort_order_idx',
      },
    ],
  }
);

export default Question;
