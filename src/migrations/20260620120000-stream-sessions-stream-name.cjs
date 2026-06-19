'use strict';

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
    if (!(await columnExists(queryInterface, 'stream_sessions', 'stream_name'))) {
      await queryInterface.addColumn('stream_sessions', 'stream_name', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS stream_sessions_device_type_name_status_idx
      ON stream_sessions (device_id, stream_type, stream_name, status);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS stream_sessions_device_type_name_status_idx;'
    );
    if (await columnExists(queryInterface, 'stream_sessions', 'stream_name')) {
      await queryInterface.removeColumn('stream_sessions', 'stream_name');
    }
  },
};
