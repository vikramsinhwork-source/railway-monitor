'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stream_cameras', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      pi_device_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'devices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      division_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'divisions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      lobby_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'lobbies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      mediamtx_path: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      location: {
        type: Sequelize.STRING(255),
        allowNull: true,
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

    await queryInterface.addIndex('stream_cameras', ['pi_device_id', 'mediamtx_path'], {
      unique: true,
      name: 'stream_cameras_pi_path_unique',
    });
    await queryInterface.addIndex('stream_cameras', ['lobby_id'], {
      name: 'stream_cameras_lobby_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('stream_cameras');
  },
};
