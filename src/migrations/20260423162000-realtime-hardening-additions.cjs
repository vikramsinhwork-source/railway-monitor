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

async function listIndexes(queryInterface, tableName) {
  const indexes = await queryInterface.showIndex(tableName);
  return new Set(indexes.map((idx) => idx.name));
}

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const names = await listIndexes(queryInterface, tableName);
  if (!names.has(options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'monitoring_sessions')) {
      await addColumnIfMissing(queryInterface, Sequelize, 'monitoring_sessions', 'access_token', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'monitoring_sessions', 'token_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['access_token'], {
        name: 'monitoring_sessions_access_token_idx',
      });
    }

    if (await tableExists(queryInterface, 'socket_presence')) {
      await addColumnIfMissing(queryInterface, Sequelize, 'socket_presence', 'offline_reason', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }

    if (!(await tableExists(queryInterface, 'device_command_queue'))) {
      await queryInterface.createTable('device_command_queue', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        device_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'devices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        command: {
          type: Sequelize.ENUM('REBOOT', 'REFRESH_STREAM', 'OPEN_VNC', 'RESTART_APP'),
          allowNull: false,
        },
        payload: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        requested_by: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        requested_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        processed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        error_message: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
    }

    await addIndexIfMissing(queryInterface, 'device_command_queue', ['device_id', 'status', 'requested_at'], {
      name: 'device_command_queue_device_status_requested_idx',
    });
    await addIndexIfMissing(queryInterface, 'device_command_queue', ['status'], {
      name: 'device_command_queue_status_idx',
    });
    await addIndexIfMissing(queryInterface, 'device_command_queue', ['requested_by'], {
      name: 'device_command_queue_requested_by_idx',
    });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'device_command_queue')) {
      await queryInterface.dropTable('device_command_queue');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_device_command_queue_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_device_command_queue_command";');

    if (await tableExists(queryInterface, 'socket_presence')) {
      const table = await queryInterface.describeTable('socket_presence');
      if (table.offline_reason) {
        await queryInterface.removeColumn('socket_presence', 'offline_reason');
      }
    }

    if (await tableExists(queryInterface, 'monitoring_sessions')) {
      const table = await queryInterface.describeTable('monitoring_sessions');
      if (table.token_expires_at) {
        await queryInterface.removeColumn('monitoring_sessions', 'token_expires_at');
      }
      if (table.access_token) {
        await queryInterface.removeColumn('monitoring_sessions', 'access_token');
      }
    }
  },
};
