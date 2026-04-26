'use strict';

const TABLE = 'divisions';

const INITIAL_DIVISIONS = [
  {
    name: 'Bhavnagar',
    code: 'BVP',
    description: 'Initial seed division - Bhavnagar',
  },
  {
    name: 'Ahmedabad',
    code: 'ADI',
    description: 'Initial seed division - Ahmedabad',
  },
  {
    name: 'Rajkot',
    code: 'RJT',
    description: 'Initial seed division - Rajkot',
  },
];

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO ${TABLE} (id, name, code, description, status, created_at, updated_at)
      VALUES
        (gen_random_uuid(), 'Bhavnagar', 'BVP', 'Initial seed division - Bhavnagar', true, NOW(), NOW()),
        (gen_random_uuid(), 'Ahmedabad', 'ADI', 'Initial seed division - Ahmedabad', true, NOW(), NOW()),
        (gen_random_uuid(), 'Rajkot', 'RJT', 'Initial seed division - Rajkot', true, NOW(), NOW())
      ON CONFLICT (code) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = true,
        updated_at = NOW();
    `);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete(TABLE, {
      code: INITIAL_DIVISIONS.map((division) => division.code),
    });
  },
};
