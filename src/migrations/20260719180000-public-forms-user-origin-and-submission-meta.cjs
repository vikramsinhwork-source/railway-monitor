'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const usersTable = await queryInterface.describeTable('users');

    if (!usersTable.account_origin) {
      await queryInterface.addColumn('users', 'account_origin', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'REGISTERED',
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE users
      SET account_origin = 'REGISTERED'
      WHERE account_origin IS NULL OR BTRIM(account_origin) = ''
    `);

    const userIndexes = await queryInterface.showIndex('users');
    const userIndexNames = new Set(userIndexes.map((idx) => idx.name));
    if (!userIndexNames.has('users_account_origin_idx')) {
      await queryInterface.addIndex('users', ['account_origin'], {
        name: 'users_account_origin_idx',
      });
    }

    const submissionsTable = await queryInterface.describeTable('submissions');

    if (!submissionsTable.submission_source) {
      await queryInterface.addColumn('submissions', 'submission_source', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'AUTHENTICATED',
      });
    }

    if (!submissionsTable.staff_type) {
      await queryInterface.addColumn('submissions', 'staff_type', {
        type: Sequelize.STRING(10),
        allowNull: true,
      });
    }

    if (!submissionsTable.duty_type) {
      await queryInterface.addColumn('submissions', 'duty_type', {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }

    if (!submissionsTable.idempotency_key) {
      await queryInterface.addColumn('submissions', 'idempotency_key', {
        type: Sequelize.UUID,
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE submissions s
      SET
        submission_source = COALESCE(NULLIF(BTRIM(s.submission_source), ''), 'AUTHENTICATED'),
        staff_type = COALESCE(s.staff_type, f.staff_type::text),
        duty_type = COALESCE(s.duty_type, f.duty_type::text)
      FROM forms f
      WHERE f.id = s.form_id
        AND (
          s.submission_source IS NULL
          OR BTRIM(s.submission_source) = ''
          OR s.staff_type IS NULL
          OR s.duty_type IS NULL
        )
    `);

    const submissionIndexes = await queryInterface.showIndex('submissions');
    const submissionIndexNames = new Set(submissionIndexes.map((idx) => idx.name));

    if (!submissionIndexNames.has('submissions_submission_source_idx')) {
      await queryInterface.addIndex('submissions', ['submission_source'], {
        name: 'submissions_submission_source_idx',
      });
    }

    if (!submissionIndexNames.has('submissions_context_date_idx')) {
      await queryInterface.addIndex(
        'submissions',
        ['staff_type', 'duty_type', 'submission_date'],
        { name: 'submissions_context_date_idx' }
      );
    }

    if (!submissionIndexNames.has('submissions_idempotency_key_unique_idx')) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX submissions_idempotency_key_unique_idx
        ON submissions (idempotency_key)
        WHERE idempotency_key IS NOT NULL
      `);
    }

    if (!submissionIndexNames.has('submissions_public_daily_unique_idx')) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX submissions_public_daily_unique_idx
        ON submissions (user_id, staff_type, duty_type, submission_date)
        WHERE submission_source = 'PUBLIC'
          AND staff_type IS NOT NULL
          AND duty_type IS NOT NULL
      `);
    }
  },

  async down(queryInterface) {
    const submissionIndexes = await queryInterface.showIndex('submissions');
    const submissionIndexNames = new Set(submissionIndexes.map((idx) => idx.name));

    for (const name of [
      'submissions_public_daily_unique_idx',
      'submissions_idempotency_key_unique_idx',
      'submissions_context_date_idx',
      'submissions_submission_source_idx',
    ]) {
      if (submissionIndexNames.has(name)) {
        await queryInterface.removeIndex('submissions', name);
      }
    }

    const submissionsTable = await queryInterface.describeTable('submissions');
    for (const column of ['idempotency_key', 'duty_type', 'staff_type', 'submission_source']) {
      if (submissionsTable[column]) {
        await queryInterface.removeColumn('submissions', column);
      }
    }

    const userIndexes = await queryInterface.showIndex('users');
    const userIndexNames = new Set(userIndexes.map((idx) => idx.name));
    if (userIndexNames.has('users_account_origin_idx')) {
      await queryInterface.removeIndex('users', 'users_account_origin_idx');
    }

    const usersTable = await queryInterface.describeTable('users');
    if (usersTable.account_origin) {
      await queryInterface.removeColumn('users', 'account_origin');
    }
  },
};
