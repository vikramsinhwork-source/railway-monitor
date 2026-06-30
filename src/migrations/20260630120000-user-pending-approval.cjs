'use strict';

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

async function addColumnIfMissing(queryInterface, Sequelize, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function addEnumValueIfMissing(queryInterface, enumName, value) {
  await queryInterface.sequelize.query(
    `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}';`
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      throw new Error('User pending-approval migration supports Postgres only.');
    }

    if (!(await tableExists(queryInterface, 'users'))) {
      return;
    }

    await addEnumValueIfMissing(queryInterface, 'enum_users_status', 'PENDING_APPROVAL');

    await addColumnIfMissing(queryInterface, Sequelize, 'users', 'approved_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await addColumnIfMissing(queryInterface, Sequelize, 'users', 'approved_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, 'users'))) {
      return;
    }

    const table = await queryInterface.describeTable('users');
    if (table.approved_at) {
      await queryInterface.removeColumn('users', 'approved_at');
    }
    if (table.approved_by) {
      await queryInterface.removeColumn('users', 'approved_by');
    }
  },
};
