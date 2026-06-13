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

async function addEnumValue(queryInterface, enumName, value) {
  await queryInterface.sequelize.query(
    `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}';`
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'device_command_queue')) {
      const enumName = 'enum_device_command_queue_command';
      const newCommands = [
        'START_KIOSK_STREAM',
        'STOP_KIOSK_STREAM',
        'START_CCTV_STREAM',
        'STOP_CCTV_STREAM',
        'REBOOT_PI',
        'REFRESH_RTSP',
        'TAKE_SCREENSHOT',
      ];
      for (const cmd of newCommands) {
        await addEnumValue(queryInterface, enumName, cmd);
      }
    }

    if (await tableExists(queryInterface, 'socket_presence')) {
      await addColumnIfMissing(queryInterface, Sequelize, 'socket_presence', 'device_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'devices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      });

      await queryInterface.sequelize.query(
        'ALTER TABLE socket_presence ALTER COLUMN user_id DROP NOT NULL;'
      );
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'socket_presence')) {
      const indexes = await queryInterface.showIndex('socket_presence');
      const deviceIdx = indexes.find((idx) => idx.name === 'socket_presence_device_id_idx');
      if (deviceIdx) {
        await queryInterface.removeIndex('socket_presence', 'socket_presence_device_id_idx');
      }
      const table = await queryInterface.describeTable('socket_presence');
      if (table.device_id) {
        await queryInterface.removeColumn('socket_presence', 'device_id');
      }
    }
  },
};
