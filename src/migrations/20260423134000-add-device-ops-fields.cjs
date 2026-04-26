'use strict';

async function addColumnIfMissing(queryInterface, Sequelize, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'last_seen_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'health_status', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'firmware_version', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });

    await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('devices');
    if (table.notes) await queryInterface.removeColumn('devices', 'notes');
    if (table.firmware_version) await queryInterface.removeColumn('devices', 'firmware_version');
    if (table.health_status) await queryInterface.removeColumn('devices', 'health_status');
    if (table.last_seen_at) await queryInterface.removeColumn('devices', 'last_seen_at');
  },
};
