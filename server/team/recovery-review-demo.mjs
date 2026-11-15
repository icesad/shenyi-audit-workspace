// Explicit review-preview fixture; never a production privilege bootstrap.
import {hashPassword} from './passwords.mjs';
const MARKER='recovery-review-demo';
export async function seedRecoveryReviewDemo(db){
 const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
 if(metadata('prototype-version')!=='2'||metadata('demo')!=='true'||metadata('team-provisioning-demo')!=='true')throw Error('Recovery reviewer requires explicit isolated review demo');
 if(metadata(MARKER)==='true')return;
 if(db.prepare("SELECT 1 FROM team_users WHERE user_id='recovery-reviewer-demo'").get()||db.prepare("SELECT 1 FROM team_credentials WHERE username='recovery-reviewer-demo'").get())throw Error('Refusing to grant an existing account recovery review privileges');
 const hash=await hashPassword('ShenyiDemo!2026');db.exec('BEGIN IMMEDIATE');
 try{
  if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}
  if(metadata('prototype-version')!=='2'||metadata('demo')!=='true'||metadata('team-provisioning-demo')!=='true')throw Error('Demo metadata changed');
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run('recovery-reviewer-demo');
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run('recovery-reviewer-demo','recovery-reviewer-demo','合成恢复审核员',hash);
  db.prepare('INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES (?,?,?)').run('recovery-reviewer-demo','account.recover','active');
  db.prepare('INSERT INTO team_database_metadata VALUES (?,?)').run(MARKER,'true');db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
