import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMonitorSeeKiosk,
  filterKiosksForMonitor,
} from '../../src/socket/kiosk-visibility.js';
import { ROLES } from '../../src/middleware/rbac.middleware.js';

const AHMEDABAD = 'c0355827-4a1a-4951-970e-4b1b4f32ac5d';
const BHAVNAGAR = '1d906fa4-2bac-4a65-beb0-a35499785fc7';

describe('kiosk-visibility', () => {
  it('Ahmedabad monitor does not see Bhavnagar kiosks', () => {
    const monitor = { role: ROLES.MONITOR, division_id: AHMEDABAD };
    assert.equal(canMonitorSeeKiosk(monitor, BHAVNAGAR), false);
    assert.equal(canMonitorSeeKiosk(monitor, AHMEDABAD), true);
  });

  it('Bhavnagar admin does not see Ahmedabad kiosks', () => {
    const admin = { role: ROLES.DIVISION_ADMIN, division_id: BHAVNAGAR };
    assert.equal(canMonitorSeeKiosk(admin, AHMEDABAD), false);
    assert.equal(canMonitorSeeKiosk(admin, BHAVNAGAR), true);
  });

  it('SUPER_ADMIN sees all kiosks unless a division is selected', () => {
    const superAdmin = { role: ROLES.SUPER_ADMIN, division_id: null };
    assert.equal(canMonitorSeeKiosk(superAdmin, BHAVNAGAR), true);
    assert.equal(canMonitorSeeKiosk(superAdmin, AHMEDABAD, AHMEDABAD), true);
    assert.equal(canMonitorSeeKiosk(superAdmin, BHAVNAGAR, AHMEDABAD), false);
  });

  it('filters online kiosk list to the monitor division', () => {
    const visible = filterKiosksForMonitor(
      [
        { kioskId: 'vatva', divisionId: AHMEDABAD },
        { kioskId: 'botad', divisionId: BHAVNAGAR },
        { kioskId: 'jnd', divisionId: BHAVNAGAR },
      ],
      { role: ROLES.MONITOR, division_id: AHMEDABAD }
    );
    assert.deepEqual(
      visible.map((k) => k.kioskId),
      ['vatva']
    );
  });
});
