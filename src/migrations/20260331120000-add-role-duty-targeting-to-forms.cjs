'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'forms';
    const table = await queryInterface.describeTable(tableName);

    if (!table.staff_type) {
      await queryInterface.addColumn(tableName, 'staff_type', {
        type: Sequelize.ENUM('ALP', 'LP', 'TM'),
        allowNull: false,
        defaultValue: 'ALP',
      });
    }

    if (!table.duty_type) {
      await queryInterface.addColumn(tableName, 'duty_type', {
        type: Sequelize.ENUM('SIGN_IN', 'SIGN_OFF'),
        allowNull: false,
        defaultValue: 'SIGN_IN',
      });
    }

    const indexes = await queryInterface.showIndex(tableName);
    const existingIndexNames = new Set(indexes.map((idx) => idx.name));

    // Remove legacy global single-active index if present.
    for (const legacyName of ['forms_one_active_idx', 'forms_is_active_unique_idx']) {
      if (existingIndexNames.has(legacyName)) {
        await queryInterface.removeIndex(tableName, legacyName);
      }
    }

    if (!existingIndexNames.has('forms_one_active_per_staff_duty_idx')) {
      await queryInterface.addIndex(tableName, ['staff_type', 'duty_type'], {
        unique: true,
        where: { is_active: true },
        name: 'forms_one_active_per_staff_duty_idx',
      });
    }

    if (!existingIndexNames.has('forms_staff_duty_active_lookup_idx')) {
      await queryInterface.addIndex(tableName, ['staff_type', 'duty_type', 'is_active'], {
        name: 'forms_staff_duty_active_lookup_idx',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableName = 'forms';
    const table = await queryInterface.describeTable(tableName);
    const indexes = await queryInterface.showIndex(tableName);
    const existingIndexNames = new Set(indexes.map((idx) => idx.name));

    if (existingIndexNames.has('forms_staff_duty_active_lookup_idx')) {
      await queryInterface.removeIndex(tableName, 'forms_staff_duty_active_lookup_idx');
    }

    if (existingIndexNames.has('forms_one_active_per_staff_duty_idx')) {
      await queryInterface.removeIndex(tableName, 'forms_one_active_per_staff_duty_idx');
    }

    if (table.duty_type) {
      await queryInterface.removeColumn(tableName, 'duty_type');
    }

    if (table.staff_type) {
      await queryInterface.removeColumn(tableName, 'staff_type');
    }

    // Clean up Postgres enum types if they are no longer referenced.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_forms_duty_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_forms_staff_type";');

    // Restore legacy global single-active behavior on rollback.
    const rollbackIndexes = await queryInterface.showIndex(tableName);
    const rollbackNames = new Set(rollbackIndexes.map((idx) => idx.name));
    if (!rollbackNames.has('forms_one_active_idx')) {
      await queryInterface.addIndex(tableName, ['is_active'], {
        unique: true,
        where: { is_active: true },
        name: 'forms_one_active_idx',
      });
    }
  },
};
