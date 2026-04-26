'use strict';

const bcrypt = require('bcrypt');

const PASSWORD = 'ChangeMe@123';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const [divisions] = await queryInterface.sequelize.query(`
      SELECT id, name
      FROM divisions
      WHERE name IN ('Bhavnagar', 'Ahmedabad');
    `);

    const bhavnagar = divisions.find((d) => d.name === 'Bhavnagar');
    const ahmedabad = divisions.find((d) => d.name === 'Ahmedabad');
    if (!bhavnagar || !ahmedabad) {
      throw new Error('Required divisions not found. Run initial divisions seeder first.');
    }

    await queryInterface.sequelize.query(
      `
        INSERT INTO lobbies (id, division_id, name, station_name, city, location, status, created_at, updated_at)
        VALUES (gen_random_uuid(), :division_id, 'Vatva Lobby', 'Vatva', 'Ahmedabad', NULL, true, NOW(), NOW())
        ON CONFLICT (division_id, name, station_name)
        DO UPDATE SET updated_at = NOW()
      `,
      { replacements: { division_id: ahmedabad.id } }
    );

    await queryInterface.sequelize.query(
      `
        INSERT INTO users (id, user_id, name, email, password_hash, role, division_id, status, created_by, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'superadmin_demo', 'Super Admin Demo', 'superadmin.demo@example.com', :password_hash, 'SUPER_ADMIN', NULL, 'ACTIVE', NULL, NOW(), NOW()),
          (gen_random_uuid(), 'bhavnagar_admin', 'Bhavnagar Admin', 'bhavnagar.admin@example.com', :password_hash, 'DIVISION_ADMIN', :bhavnagar_division_id, 'ACTIVE', NULL, NOW(), NOW()),
          (gen_random_uuid(), 'ahmedabad_monitor', 'Ahmedabad Monitor', 'ahmedabad.monitor@example.com', :password_hash, 'MONITOR', :ahmedabad_division_id, 'ACTIVE', NULL, NOW(), NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          division_id = EXCLUDED.division_id,
          status = 'ACTIVE',
          updated_at = NOW()
      `,
      {
        replacements: {
          password_hash: passwordHash,
          bhavnagar_division_id: bhavnagar.id,
          ahmedabad_division_id: ahmedabad.id,
        },
      }
    );

    const [rows] = await queryInterface.sequelize.query(
      `
        SELECT
          u.id AS user_id,
          l.id AS lobby_id,
          l.division_id AS division_id
        FROM users u
        JOIN lobbies l ON l.name = 'Vatva Lobby' AND l.station_name = 'Vatva'
        WHERE u.user_id = 'ahmedabad_monitor'
        LIMIT 1;
      `
    );

    if (rows.length === 1) {
      await queryInterface.sequelize.query(
        `
          INSERT INTO monitor_lobby_access (id, user_id, division_id, lobby_id, is_active, created_at, updated_at)
          VALUES (gen_random_uuid(), :user_id, :division_id, :lobby_id, true, NOW(), NOW())
          ON CONFLICT (user_id, lobby_id)
          DO UPDATE SET is_active = true, updated_at = NOW();
        `,
        {
          replacements: {
            user_id: rows[0].user_id,
            division_id: rows[0].division_id,
            lobby_id: rows[0].lobby_id,
          },
        }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM monitor_lobby_access
      WHERE user_id IN (
        SELECT id FROM users WHERE user_id = 'ahmedabad_monitor'
      );
    `);

    await queryInterface.sequelize.query(`
      DELETE FROM users
      WHERE user_id IN ('superadmin_demo', 'bhavnagar_admin', 'ahmedabad_monitor');
    `);

    await queryInterface.sequelize.query(`
      DELETE FROM lobbies
      WHERE name = 'Vatva Lobby' AND station_name = 'Vatva';
    `);
  },
};
