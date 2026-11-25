// Explicit synthetic review fixture; never grants a pre-existing account.
import {hashPassword} from './passwords.mjs';
const MARKER='project-migration-demo',USER='project-migration-reviewer-demo';
export async function seedProjectMigrationDemo(db){
 const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
 const validate=()=>{for(const [name,value]of [['prototype-version','2'],['demo','true'],['team-provisioning-demo','true'],['recovery-review-demo','true'],['member-deactivation-demo','true'],['device-replacement-demo','true'],['administrator-business-role-demo','true']])if(metadata(name)!==value)throw Error('Project migration requires explicit isolated review demo');};
 const collision=()=>{if(db.prepare('SELECT 1 FROM team_users WHERE user_id=?').get(USER)||db.prepare('SELECT 1 FROM team_credentials WHERE username=?').get(USER))throw Error('Refusing to grant an existing account project migration review privileges');};
 validate();if(metadata(MARKER)==='true')return;collision();const password=await hashPassword('ShenyiDemo!2026');db.exec('BEGIN IMMEDIATE');
 try{if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}validate();collision();db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(USER);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(USER,USER,'合成旧项目迁入审核员',password);db.prepare("INSERT INTO team_project_migration_reviewers(user_id,permission,status) VALUES (?,'project.migrate','active')").run(USER);db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(MARKER,'true');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
