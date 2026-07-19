import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Register = sequelize.define(
  'Register',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
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
    staff_type: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    duty_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
  },
  {
    tableName: 'registers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['is_active'], name: 'registers_is_active_idx' },
      { fields: ['staff_type', 'duty_type'], name: 'registers_staff_duty_idx' },
    ],
  }
);

export default Register;
