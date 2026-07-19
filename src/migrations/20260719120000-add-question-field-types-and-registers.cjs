'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const questionsTable = await queryInterface.describeTable('questions');

    if (!questionsTable.field_type) {
      await queryInterface.addColumn('questions', 'field_type', {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'TEXT',
      });
    }

    if (!questionsTable.options) {
      await queryInterface.addColumn('questions', 'options', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
    }

    if (!questionsTable.key) {
      await queryInterface.addColumn('questions', 'key', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
    }

    const questionIndexes = await queryInterface.showIndex('questions');
    const questionIndexNames = new Set(questionIndexes.map((idx) => idx.name));
    if (!questionIndexNames.has('questions_form_id_key_unique_idx')) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX questions_form_id_key_unique_idx
        ON questions (form_id, key)
        WHERE key IS NOT NULL
      `);
    }

    const tables = await queryInterface.showAllTables();
    const tableNames = new Set(
      tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name)).map((n) => String(n).toLowerCase())
    );

    if (!tableNames.has('registers')) {
      await queryInterface.createTable('registers', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        name: {
          type: Sequelize.STRING(200),
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        staff_type: {
          type: Sequelize.STRING(10),
          allowNull: true,
        },
        duty_type: {
          type: Sequelize.STRING(20),
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

    const registerIndexes = await queryInterface.showIndex('registers');
    const registerIndexNames = new Set(registerIndexes.map((idx) => idx.name));
    if (!registerIndexNames.has('registers_is_active_idx')) {
      await queryInterface.addIndex('registers', ['is_active'], {
        name: 'registers_is_active_idx',
      });
    }
    if (!registerIndexNames.has('registers_staff_duty_idx')) {
      await queryInterface.addIndex('registers', ['staff_type', 'duty_type'], {
        name: 'registers_staff_duty_idx',
      });
    }

    if (!tableNames.has('register_questions')) {
      await queryInterface.createTable('register_questions', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        register_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'registers',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        question_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'questions',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        sort_order: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        column_label: {
          type: Sequelize.STRING(200),
          allowNull: true,
        },
        is_key_field: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
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

    const rqIndexes = await queryInterface.showIndex('register_questions');
    const rqIndexNames = new Set(rqIndexes.map((idx) => idx.name));
    if (!rqIndexNames.has('register_questions_register_question_unique_idx')) {
      await queryInterface.addIndex('register_questions', ['register_id', 'question_id'], {
        unique: true,
        name: 'register_questions_register_question_unique_idx',
      });
    }
    if (!rqIndexNames.has('register_questions_register_sort_order_idx')) {
      await queryInterface.addIndex('register_questions', ['register_id', 'sort_order'], {
        name: 'register_questions_register_sort_order_idx',
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const tableNames = new Set(
      tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name)).map((n) => String(n).toLowerCase())
    );

    if (tableNames.has('register_questions')) {
      await queryInterface.dropTable('register_questions');
    }
    if (tableNames.has('registers')) {
      await queryInterface.dropTable('registers');
    }

    const questionIndexes = await queryInterface.showIndex('questions');
    const questionIndexNames = new Set(questionIndexes.map((idx) => idx.name));
    if (questionIndexNames.has('questions_form_id_key_unique_idx')) {
      await queryInterface.removeIndex('questions', 'questions_form_id_key_unique_idx');
    }

    const questionsTable = await queryInterface.describeTable('questions');
    if (questionsTable.key) await queryInterface.removeColumn('questions', 'key');
    if (questionsTable.options) await queryInterface.removeColumn('questions', 'options');
    if (questionsTable.field_type) await queryInterface.removeColumn('questions', 'field_type');
  },
};
