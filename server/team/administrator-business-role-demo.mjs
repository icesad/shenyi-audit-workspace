// Explicit isolated review fixture. Never a production privilege bootstrap.
import {hashPassword} from './passwords.mjs';
const MARKER='administrator-business-role-demo',USER='business-role-reviewer-demo';
export async function seedAdministratorBusinessRoleDemo(db){
 const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
 const validate=()=>{for(const [name,value] of [['prototype-version','2'],['demo','true'],['team-provisioning-demo','true'],['recovery-review-demo','true'],['member-deactivation-demo','true'],['device-replacement-demo','true']])if(metadata(name)!==value)throw Error('Administrator business review requires explicit isolated review demo');};
 const collision=()=>{if(db.prepare('SELECT 1 FROM team_users WHERE user_id=?').get(USER)||db.prepare('SELECT 1 FROM team_credentials WHERE username=?').get(USER))throw Error('Refusing to grant existing accounts administrator business review privileges');};
 validate();if(metadata(MARKER)==='true')return;collision();const password=await hashPassword('ShenyiDemo!2026');db.exec('BEGIN IMMEDIATE');
 try{
  if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}validate();collision();
  db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(USER);
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(USER,USER,'合成管理员兼任审核员',password);
  db.prepare("INSERT INTO team_administrator_business_role_reviewers(user_id,permission,status) VALUES (?,'administrator.business-role','active')").run(USER);
  db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(MARKER,'true');db.exec('COMMIT');
 }catch(cause){db.exec('ROLLBACK');throw cause;}
}
