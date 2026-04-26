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

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  const names = new Set(indexes.map((idx) => idx.name));
  if (!names.has(options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'devices')) {
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'last_health_check_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'last_recovery_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'failure_score', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'offline_count', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'consecutive_failures', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'consecutive_success', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'health_reason', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'last_error_message', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, Sequelize, 'devices', 'auto_heal_enabled', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }

    if (!(await tableExists(queryInterface, 'device_logs'))) {
      await queryInterface.createTable('device_logs', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        division_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'divisions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        lobby_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'lobbies', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        device_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'devices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        log_type: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        message: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        details: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
    }

    if (!(await tableExists(queryInterface, 'device_health_snapshots'))) {
      await queryInterface.createTable('device_health_snapshots', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        division_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'divisions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        lobby_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'lobbies', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        device_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'devices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        check_tier: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        health_status: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        health_reason: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        latency_ms: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        check_result: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
    }

    await addIndexIfMissing(queryInterface, 'device_logs', ['device_id', 'created_at'], {
      name: 'device_logs_device_created_idx',
    });
    await addIndexIfMissing(queryInterface, 'device_logs', ['division_id', 'lobby_id'], {
      name: 'device_logs_division_lobby_idx',
    });
    await addIndexIfMissing(queryInterface, 'device_health_snapshots', ['device_id', 'created_at'], {
      name: 'device_health_snapshots_device_created_idx',
    });
    await addIndexIfMissing(queryInterface, 'device_health_snapshots', ['check_tier', 'created_at'], {
      name: 'device_health_snapshots_tier_created_idx',
    });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'device_health_snapshots')) {
      await queryInterface.dropTable('device_health_snapshots');
    }
    if (await tableExists(queryInterface, 'device_logs')) {
      await queryInterface.dropTable('device_logs');
    }
    if (await tableExists(queryInterface, 'devices')) {
      const table = await queryInterface.describeTable('devices');
      const cols = [
        'auto_heal_enabled',
        'last_error_message',
        'health_reason',
        'consecutive_success',
        'consecutive_failures',
        'offline_count',
        'failure_score',
        'last_recovery_at',
        'last_health_check_at',
      ];
      for (const col of cols) {
        if (table[col]) {
          await queryInterface.removeColumn('devices', col);
        }
      }
    }
  },
};
