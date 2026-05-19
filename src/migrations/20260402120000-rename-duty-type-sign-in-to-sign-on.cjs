'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      return;
    }

    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        has_sign_in boolean;
        has_sign_on boolean;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_forms_duty_type' AND e.enumlabel = 'SIGN_IN'
        ) INTO has_sign_in;

        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_forms_duty_type' AND e.enumlabel = 'SIGN_ON'
        ) INTO has_sign_on;

        IF has_sign_in AND NOT has_sign_on THEN
          ALTER TYPE "enum_forms_duty_type" RENAME VALUE 'SIGN_IN' TO 'SIGN_ON';
        ELSIF has_sign_in AND has_sign_on THEN
          UPDATE forms SET duty_type = 'SIGN_ON'::"enum_forms_duty_type"
          WHERE duty_type::text = 'SIGN_IN';
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') {
      return;
    }

    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        has_sign_in boolean;
        has_sign_on boolean;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_forms_duty_type' AND e.enumlabel = 'SIGN_IN'
        ) INTO has_sign_in;

        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'enum_forms_duty_type' AND e.enumlabel = 'SIGN_ON'
        ) INTO has_sign_on;

        IF has_sign_on AND NOT has_sign_in THEN
          ALTER TYPE "enum_forms_duty_type" RENAME VALUE 'SIGN_ON' TO 'SIGN_IN';
        ELSIF has_sign_on AND has_sign_in THEN
          UPDATE forms SET duty_type = 'SIGN_IN'::"enum_forms_duty_type"
          WHERE duty_type::text = 'SIGN_ON';
        END IF;
      END $$;
    `);
  },
};
