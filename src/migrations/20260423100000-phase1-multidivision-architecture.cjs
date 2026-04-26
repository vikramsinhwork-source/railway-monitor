'use strict';

const DIVISION_NAME_UNIQUE = 'divisions_name_unique';
const DIVISION_CODE_UNIQUE = 'divisions_code_unique';
const LOBBY_DIVISION_NAME_STATION_UNIQUE = 'lobbies_division_name_station_unique_idx';
const DEVICE_DIVISION_LOBBY_NAME_UNIQUE = 'devices_division_lobby_name_unique_idx';
const USERS_DIVISION_INDEX = 'users_division_id_idx';
const LOBBIES_DIVISION_INDEX = 'lobbies_division_id_idx';
const DEVICES_DIVISION_INDEX = 'devices_division_id_idx';
const DEVICES_LOBBY_INDEX = 'devices_lobby_id_idx';

async function listTableIndexes(queryInterface, tableName) {
  const indexes = await queryInterface.showIndex(tableName);
  return new Set(indexes.map((idx) => idx.name));
}

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexNames = await listTableIndexes(queryInterface, tableName);
  if (!indexNames.has(options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

async function addColumnIfMissing(queryInterface, Sequelize, tableName, columnName, columnDef) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, columnDef);
  }
}

async function ensureUuidExtension(queryInterface) {
  await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
}

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

async function migrateUsersRoleToNewEnum(queryInterface) {
  await queryInterface.sequelize.query(`
    DO $$
    DECLARE
      has_users_table boolean;
      has_role_column boolean;
      role_data_type text;
      has_admin boolean;
      has_super_admin boolean;
      has_division_admin boolean;
      has_monitor boolean;
      has_user boolean;
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) INTO has_users_table;

      IF NOT has_users_table THEN
        RETURN;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
      ) INTO has_role_column;

      IF NOT has_role_column THEN
        RETURN;
      END IF;

      SELECT data_type
      INTO role_data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role';

      IF role_data_type = 'USER-DEFINED' THEN
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_users_role' AND e.enumlabel = 'ADMIN'
        ) INTO has_admin;
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_users_role' AND e.enumlabel = 'SUPER_ADMIN'
        ) INTO has_super_admin;
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_users_role' AND e.enumlabel = 'DIVISION_ADMIN'
        ) INTO has_division_admin;
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_users_role' AND e.enumlabel = 'MONITOR'
        ) INTO has_monitor;
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_users_role' AND e.enumlabel = 'USER'
        ) INTO has_user;

        IF has_super_admin AND has_division_admin AND has_monitor AND has_user AND NOT has_admin THEN
          RETURN;
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'enum_users_role_new'
      ) THEN
        DROP TYPE "enum_users_role_new";
      END IF;

      CREATE TYPE "enum_users_role_new" AS ENUM ('SUPER_ADMIN', 'DIVISION_ADMIN', 'MONITOR', 'USER');

      IF role_data_type = 'USER-DEFINED' THEN
        ALTER TABLE "users"
        ALTER COLUMN "role" TYPE "enum_users_role_new"
        USING (
          CASE role::text
            WHEN 'ADMIN' THEN 'SUPER_ADMIN'
            WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
            WHEN 'DIVISION_ADMIN' THEN 'DIVISION_ADMIN'
            WHEN 'MONITOR' THEN 'MONITOR'
            WHEN 'USER' THEN 'USER'
            ELSE 'USER'
          END
        )::"enum_users_role_new";
      ELSE
        ALTER TABLE "users"
        ALTER COLUMN "role" TYPE "enum_users_role_new"
        USING (
          CASE role
            WHEN 'ADMIN' THEN 'SUPER_ADMIN'
            WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
            WHEN 'DIVISION_ADMIN' THEN 'DIVISION_ADMIN'
            WHEN 'MONITOR' THEN 'MONITOR'
            WHEN 'USER' THEN 'USER'
            ELSE 'USER'
          END
        )::"enum_users_role_new";
      END IF;

      ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;

      IF EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'enum_users_role'
      ) THEN
        DROP TYPE "enum_users_role";
      END IF;

      ALTER TYPE "enum_users_role_new" RENAME TO "enum_users_role";
    END $$;
  `);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      throw new Error('Phase 1 multi-division migration supports Postgres only.');
    }

    await ensureUuidExtension(queryInterface);

    if (!(await tableExists(queryInterface, 'divisions'))) {
      await queryInterface.createTable('divisions', {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
          unique: true,
        },
        code: {
          type: Sequelize.STRING(50),
          allowNull: false,
          unique: true,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        status: {
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

    await addIndexIfMissing(queryInterface, 'divisions', ['name'], {
      name: DIVISION_NAME_UNIQUE,
      unique: true,
    });
    await addIndexIfMissing(queryInterface, 'divisions', ['code'], {
      name: DIVISION_CODE_UNIQUE,
      unique: true,
    });

    if (!(await tableExists(queryInterface, 'lobbies'))) {
      await queryInterface.createTable('lobbies', {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
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
        name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        station_name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        city: {
          type: Sequelize.STRING(120),
          allowNull: true,
        },
        location: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        status: {
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

    await addIndexIfMissing(queryInterface, 'lobbies', ['division_id'], {
      name: LOBBIES_DIVISION_INDEX,
    });
    await addIndexIfMissing(queryInterface, 'lobbies', ['division_id', 'name', 'station_name'], {
      name: LOBBY_DIVISION_NAME_STATION_UNIQUE,
      unique: true,
    });

    if (!(await tableExists(queryInterface, 'devices'))) {
      await queryInterface.createTable('devices', {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
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
        device_type: {
          type: Sequelize.ENUM('KIOSK', 'CAMERA', 'DVR', 'RASPBERRY', 'NVR'),
          allowNull: false,
        },
        device_name: {
          type: Sequelize.STRING(150),
          allowNull: false,
        },
        stream_url: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        ip_address: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        mac_address: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        serial_number: {
          type: Sequelize.STRING(150),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('ONLINE', 'OFFLINE', 'MAINTENANCE'),
          allowNull: false,
          defaultValue: 'OFFLINE',
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
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

    await addIndexIfMissing(queryInterface, 'devices', ['division_id'], {
      name: DEVICES_DIVISION_INDEX,
    });
    await addIndexIfMissing(queryInterface, 'devices', ['lobby_id'], {
      name: DEVICES_LOBBY_INDEX,
    });
    await addIndexIfMissing(queryInterface, 'devices', ['division_id', 'lobby_id', 'device_name'], {
      name: DEVICE_DIVISION_LOBBY_NAME_UNIQUE,
      unique: true,
    });

    await migrateUsersRoleToNewEnum(queryInterface);

    await addColumnIfMissing(queryInterface, Sequelize, 'users', 'division_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'divisions',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await addIndexIfMissing(queryInterface, 'users', ['division_id'], {
      name: USERS_DIVISION_INDEX,
    });
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      return;
    }

    if (await tableExists(queryInterface, 'users')) {
      const usersTable = await queryInterface.describeTable('users');
      if (usersTable.division_id) {
        const userIndexes = await listTableIndexes(queryInterface, 'users');
        if (userIndexes.has(USERS_DIVISION_INDEX)) {
          await queryInterface.removeIndex('users', USERS_DIVISION_INDEX);
        }
        await queryInterface.removeColumn('users', 'division_id');
      }
    }

    // Keep enum_users_role as-is on rollback to avoid destructive role data loss.

    if (await tableExists(queryInterface, 'devices')) {
      await queryInterface.dropTable('devices');
    }
    if (await tableExists(queryInterface, 'lobbies')) {
      await queryInterface.dropTable('lobbies');
    }
    if (await tableExists(queryInterface, 'divisions')) {
      await queryInterface.dropTable('divisions');
    }

    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_devices_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_devices_device_type";');
  },
};
