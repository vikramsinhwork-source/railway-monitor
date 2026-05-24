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
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      throw new Error('Observer monitoring migration supports Postgres only.');
    }

    if (!(await tableExists(queryInterface, 'session_observers'))) {
      await queryInterface.createTable('session_observers', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        session_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'monitoring_sessions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        observer_user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        observer_role: {
          type: Sequelize.STRING(32),
          allowNull: false,
        },
        observer_socket_id: {
          type: Sequelize.STRING(128),
          allowNull: true,
        },
        joined_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        left_at: {
          type: Sequelize.DATE,
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
      await queryInterface.addIndex('session_observers', ['session_id'], {
        name: 'session_observers_session_id_idx',
      });
      await queryInterface.addIndex('session_observers', ['observer_user_id'], {
        name: 'session_observers_observer_user_id_idx',
      });
      await queryInterface.addIndex(
        'session_observers',
        ['session_id', 'observer_user_id'],
        {
          name: 'session_observers_active_unique_idx',
          unique: true,
          where: { left_at: null },
        }
      );
    }

    if (!(await tableExists(queryInterface, 'monitoring_audit_logs'))) {
      await queryInterface.createTable('monitoring_audit_logs', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        observer_user_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        observer_role: {
          type: Sequelize.STRING(32),
          allowNull: true,
        },
        session_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'monitoring_sessions', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
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
        action: {
          type: Sequelize.STRING(64),
          allowNull: false,
        },
        result: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: 'SUCCESS',
        },
        ip_address: {
          type: Sequelize.STRING(64),
          allowNull: true,
        },
        device_info: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        details: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        joined_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        left_at: {
          type: Sequelize.DATE,
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
      await queryInterface.addIndex('monitoring_audit_logs', ['session_id'], {
        name: 'monitoring_audit_logs_session_id_idx',
      });
      await queryInterface.addIndex('monitoring_audit_logs', ['observer_user_id'], {
        name: 'monitoring_audit_logs_observer_user_id_idx',
      });
      await queryInterface.addIndex('monitoring_audit_logs', ['division_id'], {
        name: 'monitoring_audit_logs_division_id_idx',
      });
      await queryInterface.addIndex('monitoring_audit_logs', ['action'], {
        name: 'monitoring_audit_logs_action_idx',
      });
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'monitoring_audit_logs')) {
      await queryInterface.dropTable('monitoring_audit_logs');
    }
    if (await tableExists(queryInterface, 'session_observers')) {
      await queryInterface.dropTable('session_observers');
    }
  },
};
