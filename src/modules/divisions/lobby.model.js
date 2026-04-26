import { DataTypes } from 'sequelize';
import sequelize from '../../config/sequelize.js';

const Lobby = sequelize.define(
  'Lobby',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    division_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'divisions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    station_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    city: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    location: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'lobbies',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['division_id'],
        name: 'lobbies_division_id_idx',
      },
      {
        unique: true,
        fields: ['division_id', 'name', 'station_name'],
        name: 'lobbies_division_name_station_unique_idx',
      },
    ],
  }
);

export default Lobby;
