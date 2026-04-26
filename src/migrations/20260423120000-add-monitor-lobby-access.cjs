'use strict';

const TABLE = 'monitor_lobby_access';

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
      throw new Error('Monitor lobby access migration supports Postgres only.');
    }

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
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        division_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'divisions',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        lobby_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'lobbies',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        is_active: {
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

    await addIndexIfMissing(queryInterface, TABLE, ['user_id'], {
      name: 'monitor_lobby_access_user_id_idx',
    });
    await addIndexIfMissing(queryInterface, TABLE, ['lobby_id'], {
      name: 'monitor_lobby_access_lobby_id_idx',
    });
    await addIndexIfMissing(queryInterface, TABLE, ['user_id', 'lobby_id'], {
      name: 'monitor_lobby_access_user_lobby_unique_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, TABLE)) {
      await queryInterface.dropTable(TABLE);
    }
  },
};
