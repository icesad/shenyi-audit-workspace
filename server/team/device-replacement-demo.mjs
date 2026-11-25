// Explicit isolated review fixture, never a production privilege bootstrap.
import {hashPassword} from './passwords.mjs';
const MARKER='device-replacement-demo',USER='device-reviewer-demo';
export async function seedDeviceReplacementDemo(db){
 const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
 const validate=()=>{if(metadata('prototype-version')!=='2'||metadata('demo')!=='true'||metadata('team-provisioning-demo')!=='true'||metadata('recovery-review-demo')!=='true'||metadata('member-deactivation-demo')!=='true')throw Error('Device reviewer requires explicit isolated review demo');};
 const collision=()=>{if(db.prepare('SELECT 1 FROM team_users WHERE user_id=?').get(USER)||db.prepare('SELECT 1 FROM team_credentials WHERE username=?').get(USER))throw Error('Refusing to grant existing accounts device replacement privileges');};
 validate();if(metadata(MARKER)==='true')return;collision();const password=await hashPassword('ShenyiDemo!2026');db.exec('BEGIN IMMEDIATE');
 try{
  if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}validate();collision();
  db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(USER);
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(USER,USER,'合成换机审核员',password);
  db.prepare("INSERT INTO team_device_replacement_reviewers(user_id,permission,status) VALUES (?,'device.replace','active')").run(USER);
  db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(MARKER,'true');db.exec('COMMIT');
 }catch(cause){db.exec('ROLLBACK');throw cause;}
}
