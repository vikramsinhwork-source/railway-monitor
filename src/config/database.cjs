require('dotenv').config();

const requiredDbVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbVars = requiredDbVars.filter((key) => !process.env[key]);

if (missingDbVars.length > 0) {
  throw new Error(`Missing required DB environment variables: ${missingDbVars.join(', ')}`);
}

const useSsl = process.env.DB_SSL === 'true';
const dialectOptions = useSsl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    }
  : undefined;

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  dialect: 'postgres',
  logging: false,
  ...(dialectOptions && { dialectOptions }),
};

module.exports = {
  development: base,
  production: base,
};
