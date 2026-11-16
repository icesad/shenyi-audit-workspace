-- Additive M3E authentication activity metadata; never a business permission.
CREATE TABLE IF NOT EXISTS team_device_usage (
  device_id TEXT PRIMARY KEY REFERENCES team_device_bindings(device_id),
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  last_used_at INTEGER NOT NULL CHECK(typeof(last_used_at)='integer' AND last_used_at>=0 AND last_used_at<=9007199254740991)
);
CREATE TRIGGER IF NOT EXISTS device_usage_insert_owned_active
BEFORE INSERT ON team_device_usage
WHEN NOT EXISTS (SELECT 1 FROM team_device_bindings WHERE device_id=NEW.device_id AND user_id=NEW.user_id AND status='active')
BEGIN SELECT RAISE(ABORT,'Device usage owner unavailable'); END;
CREATE TRIGGER IF NOT EXISTS device_usage_update_owned_monotonic
BEFORE UPDATE ON team_device_usage
WHEN OLD.device_id<>NEW.device_id OR OLD.user_id<>NEW.user_id OR NEW.last_used_at<OLD.last_used_at
  OR NOT EXISTS (SELECT 1 FROM team_device_bindings WHERE device_id=NEW.device_id AND user_id=NEW.user_id AND status='active')
BEGIN SELECT RAISE(ABORT,'Immutable device usage owner or non-monotonic activity'); END;
CREATE INDEX IF NOT EXISTS my_device_event_owner_time ON team_device_events(user_id,created_at DESC,event_id DESC);
CREATE INDEX IF NOT EXISTS my_device_replacement_owner_request ON team_device_replacement_requests(user_id,request_id);
CREATE INDEX IF NOT EXISTS my_device_replacement_event_request_time ON team_device_replacement_events(request_id,created_at DESC,event_id DESC);
