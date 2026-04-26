'use strict';

const bcrypt = require('bcrypt');

const PASSWORD = 'ChangeMe@123';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const [divisions] = await queryInterface.sequelize.query(`
      SELECT id, name FROM divisions WHERE name IN ('Bhavnagar', 'Ahmedabad');
    `);
    const bhavnagar = divisions.find((d) => d.name === 'Bhavnagar');
    const ahmedabad = divisions.find((d) => d.name === 'Ahmedabad');
    if (!bhavnagar || !ahmedabad) {
      throw new Error('Bhavnagar and Ahmedabad divisions required.');
    }

    await queryInterface.sequelize.query(
      `
        INSERT INTO lobbies (id, division_id, name, station_name, city, location, status, created_at, updated_at)
        VALUES (gen_random_uuid(), :bh_id, 'Botad', 'Botad', 'Bhavnagar', NULL, true, NOW(), NOW())
        ON CONFLICT (division_id, name, station_name)
        DO UPDATE SET updated_at = NOW(), status = true;
      `,
      { replacements: { bh_id: bhavnagar.id } }
    );

    await queryInterface.sequelize.query(
      `
        INSERT INTO users (id, user_id, name, email, password_hash, role, division_id, status, created_by, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'ahmedabad_admin', 'Ahmedabad Admin', 'ahmedabad.admin@example.com', :password_hash, 'DIVISION_ADMIN', :ah_id, 'ACTIVE', NULL, NOW(), NOW()),
          (gen_random_uuid(), 'bhavnagar_monitor', 'Bhavnagar Monitor', 'bhavnagar.monitor@example.com', :password_hash, 'MONITOR', :bh_id, 'ACTIVE', NULL, NOW(), NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          division_id = EXCLUDED.division_id,
          status = 'ACTIVE',
          updated_at = NOW();
      `,
      {
        replacements: {
          password_hash: passwordHash,
          ah_id: ahmedabad.id,
          bh_id: bhavnagar.id,
        },
      }
    );

    const [botadRows] = await queryInterface.sequelize.query(
      `
        SELECT l.id AS lobby_id, l.division_id
        FROM lobbies l
        WHERE l.division_id = :bh_id AND l.name = 'Botad' AND l.station_name = 'Botad'
        LIMIT 1;
      `,
      { replacements: { bh_id: bhavnagar.id } }
    );

    if (botadRows.length === 1) {
      const [monRows] = await queryInterface.sequelize.query(
        `SELECT id FROM users WHERE user_id = 'bhavnagar_monitor' LIMIT 1;`
      );
      if (monRows.length === 1) {
        await queryInterface.sequelize.query(
          `
            INSERT INTO monitor_lobby_access (id, user_id, division_id, lobby_id, is_active, created_at, updated_at)
            VALUES (gen_random_uuid(), :user_id, :division_id, :lobby_id, true, NOW(), NOW())
            ON CONFLICT (user_id, lobby_id)
            DO UPDATE SET is_active = true, updated_at = NOW();
          `,
          {
            replacements: {
              user_id: monRows[0].id,
              division_id: botadRows[0].division_id,
              lobby_id: botadRows[0].lobby_id,
            },
          }
        );
      }
    }

    const [vatvaRows] = await queryInterface.sequelize.query(
      `SELECT id FROM lobbies WHERE division_id = :ah_id AND station_name = 'Vatva' LIMIT 1;`,
      { replacements: { ah_id: ahmedabad.id } }
    );
    const vatvaId = vatvaRows[0]?.id;
    if (vatvaId) {
      const devices = [
        { name: 'E2E Camera1', type: 'CAMERA' },
        { name: 'E2E Camera2', type: 'CAMERA' },
        { name: 'E2E Kiosk1', type: 'KIOSK' },
        { name: 'E2E Raspberry1', type: 'RASPBERRY' },
      ];
      for (const d of devices) {
        await queryInterface.sequelize.query(
          `
            INSERT INTO devices (
              id, division_id, lobby_id, device_type, device_name, stream_url, status, is_active,
              health_status, failure_score, offline_count, consecutive_failures, consecutive_success,
              auto_heal_enabled, created_at, updated_at
            )
            VALUES (
              gen_random_uuid(), :div_id, :lobby_id, '${d.type}', :dname,
              'https://example.invalid/stream', 'ONLINE', true, 'ONLINE', 0, 0, 0, 0, true, NOW(), NOW()
            )
            ON CONFLICT (division_id, lobby_id, device_name)
            DO UPDATE SET updated_at = NOW(), is_active = true;
          `,
          {
            replacements: {
              div_id: ahmedabad.id,
              lobby_id: vatvaId,
              dname: d.name,
            },
          }
        );
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM devices WHERE device_name LIKE 'E2E %';
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM monitor_lobby_access WHERE user_id IN (SELECT id FROM users WHERE user_id = 'bhavnagar_monitor');
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM users WHERE user_id IN ('ahmedabad_admin', 'bhavnagar_monitor');
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM lobbies WHERE name = 'Botad' AND station_name = 'Botad';
    `);
  },
};
