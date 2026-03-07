/**
 * Sequelize configuration
 * Uses environment variables. Dialect: postgres. SSL when DB_SSL=true (Supabase, cloud).
 */

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const useSsl = process.env.DB_SSL === 'true';

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    dialect: 'postgres',
    logging: false,
    ...(useSsl && {
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
    }),
  }
);

export default sequelize;
