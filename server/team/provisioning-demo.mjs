// Explicit opt-in synthetic reviewer for the separate review preview only.
// Never called by the ordinary seed or by the server/production entry point.
import {hashPassword} from './passwords.mjs';
const MARKER='team-provisioning-demo';
export async function seedProvisioningDemo(db){
  const metadata=name=>db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(name)?.value;
  if(metadata('prototype-version')!=='2'||metadata('demo')!=='true')throw new Error('Review preview requires an isolated synthetic demo database');
  if(metadata(MARKER)==='true')return;
  if(db.prepare("SELECT 1 FROM team_users WHERE user_id='reviewer-demo'").get()||db.prepare("SELECT 1 FROM team_credentials WHERE username='reviewer-demo'").get())throw new Error('Refusing to grant an existing account review privileges');
  const hash=await hashPassword('ShenyiDemo!2026');
  db.exec('BEGIN IMMEDIATE');
  try{
    // Recheck after asynchronous KDF. Never restore a revoked seeded reviewer.
    if(metadata(MARKER)==='true'){db.exec('COMMIT');return;}
    if(metadata('prototype-version')!=='2'||metadata('demo')!=='true')throw new Error('Demo metadata changed');
    db.prepare('INSERT INTO team_users(user_id,status) VALUES (?,?)').run('reviewer-demo','active');
    db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run('reviewer-demo','reviewer-demo','合成开通审核员',hash);
    db.prepare('INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES (?,?,?)').run('reviewer-demo','team.provision','active');
    db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?)').run(MARKER,'true');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
