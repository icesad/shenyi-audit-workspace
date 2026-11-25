import {ID} from './http-utils.mjs';
import {UUID,deviceConflict} from './device-policy.mjs';

// Call only after successful device authentication, inside its original
// transaction. Ownership and monotonicity also remain enforced by SQLite.
export function recordDeviceUsage(db,userId,deviceId,at){
  if(typeof userId!=='string'||!ID.test(userId)||typeof deviceId!=='string'||!UUID.test(deviceId)||!Number.isSafeInteger(at)||at<0)deviceConflict();
  const changed=db.prepare(`INSERT INTO team_device_usage(device_id,user_id,last_used_at)
    SELECT device_id,user_id,? FROM team_device_bindings WHERE device_id=? AND user_id=? AND status='active'
    ON CONFLICT(device_id) DO UPDATE SET last_used_at=MAX(team_device_usage.last_used_at,excluded.last_used_at)
      WHERE team_device_usage.user_id=excluded.user_id`).run(at,deviceId,userId);
  if(changed.changes!==1)deviceConflict();
}
