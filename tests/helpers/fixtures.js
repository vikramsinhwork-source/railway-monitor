/**
 * Passwords align with seeders / seedAdmin.
 * Run: npx sequelize-cli db:seed:all (includes e2e operators seeder).
 */

export const USERS = {
  superAdmin: { user_id: 'admin', password: 'admin123' },
  bhavnagarAdmin: { user_id: 'bhavnagar_admin', password: 'ChangeMe@123' },
  ahmedabadAdmin: { user_id: 'ahmedabad_admin', password: 'ChangeMe@123' },
  ahmedabadMonitor: { user_id: 'ahmedabad_monitor', password: 'ChangeMe@123' },
  bhavnagarMonitor: { user_id: 'bhavnagar_monitor', password: 'ChangeMe@123' },
  kioskUser: { user_id: 'LOBBY', password: '12345678' },
};

export const DIVISION_NAMES = {
  bhavnagar: 'Bhavnagar',
  ahmedabad: 'Ahmedabad',
};
