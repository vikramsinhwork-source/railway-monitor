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
    staff_type: {
      type: DataTypes.ENUM('ALP', 'LP', 'TM'),
      allowNull: false,
      defaultValue: 'ALP',
    },
    duty_type: {
      type: DataTypes.ENUM('SIGN_ON', 'SIGN_OFF'),
      allowNull: false,
      defaultValue: 'SIGN_ON',
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
        fields: ['staff_type', 'duty_type'],
        where: { is_active: true },
        name: 'forms_one_active_per_staff_duty_idx',
      },
      {
        fields: ['staff_type', 'duty_type', 'is_active'],
        name: 'forms_staff_duty_active_lookup_idx',
      },
    ],
  }
);

export default Form;
