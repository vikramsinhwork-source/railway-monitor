'use strict';

const TABLE = 'users';

async function tableExists(queryInterface, tableName) {
  const [rows] = await queryInterface.sequelize.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = :tableName
      ) AS "exists";
    `,
    { replacements: { tableName } }
  );
  return !!rows?.[0]?.exists;
}

async function columnExists(queryInterface, tableName, columnName) {
  const [rows] = await queryInterface.sequelize.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :tableName
          AND column_name = :columnName
      ) AS "exists";
    `,
    { replacements: { tableName, columnName } }
  );
  return !!rows?.[0]?.exists;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, TABLE))) return;

    await queryInterface.sequelize.query(`
      UPDATE users
      SET email = LOWER(REGEXP_REPLACE(user_id, '[^a-zA-Z0-9._+-]+', '', 'g')) || '@users.local'
      WHERE email IS NULL OR BTRIM(email) = ''
    `);

    await queryInterface.changeColumn(TABLE, 'email', {
      type: Sequelize.STRING(150),
      allowNull: false,
      unique: true,
    });

    if (!(await columnExists(queryInterface, TABLE, 'password_reset_token_hash'))) {
      await queryInterface.addColumn(TABLE, 'password_reset_token_hash', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, TABLE, 'password_reset_expires'))) {
      await queryInterface.addColumn(TABLE, 'password_reset_expires', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, TABLE))) return;

    if (await columnExists(queryInterface, TABLE, 'password_reset_expires')) {
      await queryInterface.removeColumn(TABLE, 'password_reset_expires');
    }
    if (await columnExists(queryInterface, TABLE, 'password_reset_token_hash')) {
      await queryInterface.removeColumn(TABLE, 'password_reset_token_hash');
    }

    await queryInterface.changeColumn(TABLE, 'email', {
      type: Sequelize.STRING(150),
      allowNull: true,
      unique: true,
    });
  },
};
