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
    if (await tableExists(queryInterface, 'devices')) {
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'stream_status', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'go2rtc_status', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'agent_version', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'last_screenshot_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!(await tableExists(queryInterface, 'device_heartbeats'))) {
      await queryInterface.createTable('device_heartbeats', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
        },
        device_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'devices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        received_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('NOW()'),
        },
        payload: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('NOW()'),
        },
      });
      await queryInterface.addIndex('device_heartbeats', ['device_id', 'received_at'], {
        name: 'device_heartbeats_device_received_idx',
      });
    }

    if (!(await tableExists(queryInterface, 'device_screenshots'))) {
      await queryInterface.createTable('device_screenshots', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
        },
        device_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'devices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        screen_type: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        storage_path: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        mime_type: {
          type: Sequelize.STRING(80),
          allowNull: true,
        },
        size_bytes: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        captured_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('NOW()'),
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        meta: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('NOW()'),
        },
      });
      await queryInterface.addIndex('device_screenshots', ['device_id', 'captured_at'], {
        name: 'device_screenshots_device_captured_idx',
      });
    }

    if (await tableExists(queryInterface, 'device_command_queue')) {
      const enumName = 'enum_device_command_queue_command';
      for (const cmd of ['RESTART_GO2RTC', 'RESTART_AGENT', 'UPDATE_AGENT']) {
        await addEnumValue(queryInterface, enumName, cmd);
      }
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'device_screenshots')) {
      await queryInterface.dropTable('device_screenshots');
    }
    if (await tableExists(queryInterface, 'device_heartbeats')) {
      await queryInterface.dropTable('device_heartbeats');
    }
    if (await tableExists(queryInterface, 'devices')) {
      const table = await queryInterface.describeTable('devices');
      for (const col of ['stream_status', 'go2rtc_status', 'agent_version', 'last_screenshot_at']) {
        if (table[col]) await queryInterface.removeColumn('devices', col);
      }
    }
  },
};
