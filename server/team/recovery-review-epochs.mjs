/** Fixed internal trigger names/tables only. Sidecar epochs preserve old schemas
 * while recording revocation followed by identical regrant, which a current-row
 * fingerprint alone cannot observe. No epoch is inferred from client input. */
export function installRecoveryEpochTriggers(db){
  const bump=expression=>`INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (${expression},1)
    ON CONFLICT(user_id) DO UPDATE SET version=version+1;`;
  for(const table of ['team_credentials','team_phone_credentials','team_memberships','team_operators','team_platform_reviewers','team_recovery_reviewers']){
    for(const [event,body] of [['INSERT',bump('NEW.user_id')],['UPDATE',bump('OLD.user_id')+bump('NEW.user_id')],['DELETE',bump('OLD.user_id')]]){
      db.exec(`CREATE TRIGGER IF NOT EXISTS recovery_epoch_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${body} END;`);
    }
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS recovery_epoch_account_update AFTER UPDATE ON team_users BEGIN ${bump('NEW.user_id')} END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS recovery_epoch_team_update AFTER UPDATE ON teams BEGIN
    INSERT INTO team_recovery_identity_epochs(user_id,version)
      SELECT user_id,1 FROM (SELECT user_id FROM team_memberships WHERE team_id=OLD.team_id
        UNION SELECT user_id FROM team_operators WHERE team_id=OLD.team_id) WHERE true
      ON CONFLICT(user_id) DO UPDATE SET version=version+1;
    END;`);
}
