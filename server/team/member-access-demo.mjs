// Explicit review-preview fixtures. This is never a production privilege bootstrap.
import {hashPassword} from './passwords.mjs';
const MARKER='member-deactivation-demo';
const FIXTURES=[['administrator-demo','合成团队管理员'],['access-reviewer-demo','合成停用审核员']];
export async function seedMemberDeactivationDemo(db){
 const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
 const validate=()=>{
  if(metadata('prototype-version')!=='2'||metadata('demo')!=='true'||metadata('team-provisioning-demo')!=='true'||metadata('recovery-review-demo')!=='true')throw Error('Member management requires explicit isolated review demo');
 };
 validate();if(metadata(MARKER)==='true')return;
 const collision=()=>{if(!db.prepare("SELECT 1 FROM teams WHERE team_id='team-a' AND status='active'").get())throw Error('Synthetic administration team is not active');for(const [id] of FIXTURES)if(db.prepare('SELECT 1 FROM team_users WHERE user_id=?').get(id)||db.prepare('SELECT 1 FROM team_credentials WHERE username=?').get(id))throw Error('Refusing to grant existing accounts member-management privileges');};
 collision();const hashes=[];for(const fixture of FIXTURES)hashes.push(await hashPassword('ShenyiDemo!2026'));
 db.exec('BEGIN IMMEDIATE');
 try{
  if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}
  validate();collision();
  for(let index=0;index<FIXTURES.length;index++){const [id,name]=FIXTURES[index];db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,name,hashes[index]);}
  db.prepare("INSERT INTO team_operators(team_id,user_id,role,status) VALUES ('team-a','administrator-demo','administrator','active')").run();
  db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('access-reviewer-demo','member.disable','active')").run();
  db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(MARKER,'true');db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
