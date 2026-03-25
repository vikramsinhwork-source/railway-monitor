import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Form = sequelize.define(
  'Form',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'forms',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['is_active'],
        where: { is_active: true },
        name: 'forms_one_active_form_idx',
      },
    ],
  }
);

export default Form;
