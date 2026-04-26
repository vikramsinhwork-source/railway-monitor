'use strict';

const TABLE = 'audit_logs';

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
    if (!(await tableExists(queryInterface, TABLE))) {
      await queryInterface.createTable(TABLE, {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        action: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        entity_type: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        entity_id: {
          type: Sequelize.UUID,
          allowNull: false,
        },
        old_data: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        new_data: {
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

    await addIndexIfMissing(queryInterface, TABLE, ['user_id'], {
      name: 'audit_logs_user_id_idx',
    });
    await addIndexIfMissing(queryInterface, TABLE, ['entity_type', 'entity_id'], {
      name: 'audit_logs_entity_lookup_idx',
    });
    await addIndexIfMissing(queryInterface, TABLE, ['created_at'], {
      name: 'audit_logs_created_at_idx',
    });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, TABLE)) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
