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
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      throw new Error('Realtime monitoring migration supports Postgres only.');
    }

    if (!(await tableExists(queryInterface, 'monitoring_sessions'))) {
      await queryInterface.createTable('monitoring_sessions', {
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
        monitor_user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        started_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        ended_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('ACTIVE', 'ENDED', 'TIMEOUT', 'FORCED'),
          allowNull: false,
          defaultValue: 'ACTIVE',
        },
        disconnect_reason: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        meta: {
          type: Sequelize.JSONB,
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

    await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['device_id'], {
      name: 'monitoring_sessions_device_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['monitor_user_id'], {
      name: 'monitoring_sessions_monitor_user_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['division_id', 'lobby_id'], {
      name: 'monitoring_sessions_division_lobby_idx',
    });
    await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['status'], {
      name: 'monitoring_sessions_status_idx',
    });
    await addIndexIfMissing(queryInterface, 'monitoring_sessions', ['device_id'], {
      name: 'monitoring_sessions_active_device_unique_idx',
      unique: true,
      where: { status: 'ACTIVE' },
    });

    if (!(await tableExists(queryInterface, 'socket_presence'))) {
      await queryInterface.createTable('socket_presence', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        socket_id: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true,
        },
        role: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        division_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'divisions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        lobby_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'lobbies', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        last_heartbeat_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        is_online: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
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

    await addIndexIfMissing(queryInterface, 'socket_presence', ['user_id'], {
      name: 'socket_presence_user_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'socket_presence', ['division_id'], {
      name: 'socket_presence_division_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'socket_presence', ['lobby_id'], {
      name: 'socket_presence_lobby_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'socket_presence', ['is_online', 'last_heartbeat_at'], {
      name: 'socket_presence_online_heartbeat_idx',
    });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'socket_presence')) {
      await queryInterface.dropTable('socket_presence');
    }
    if (await tableExists(queryInterface, 'monitoring_sessions')) {
      await queryInterface.dropTable('monitoring_sessions');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_monitoring_sessions_status";');
  },
};
