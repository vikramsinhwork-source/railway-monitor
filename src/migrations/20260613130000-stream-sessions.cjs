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

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'stream_sessions')) return;

    await queryInterface.createTable('stream_sessions', {
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
      stream_type: {
        type: Sequelize.ENUM('KIOSK', 'CCTV'),
        allowNull: false,
      },
      viewer_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('REQUESTED', 'ACTIVE', 'CLOSED'),
        allowNull: false,
        defaultValue: 'REQUESTED',
      },
      offer: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      answer: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      ice_candidates: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('stream_sessions', ['device_id', 'status'], {
      name: 'stream_sessions_device_status_idx',
    });
    await queryInterface.addIndex('stream_sessions', ['viewer_user_id', 'status'], {
      name: 'stream_sessions_viewer_status_idx',
    });
    await queryInterface.addIndex('stream_sessions', ['status', 'updated_at'], {
      name: 'stream_sessions_status_updated_idx',
    });

    if (await tableExists(queryInterface, 'socket_presence')) {
      await queryInterface.sequelize.query(
        'ALTER TABLE socket_presence ALTER COLUMN user_id DROP NOT NULL;'
      );
    }
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, 'stream_sessions'))) return;
    await queryInterface.dropTable('stream_sessions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_stream_sessions_stream_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_stream_sessions_status";');
  },
};
