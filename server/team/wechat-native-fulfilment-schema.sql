CREATE TABLE IF NOT EXISTS team_billing_wechat_native_fulfilments (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES team_billing_wechat_native_payments(order_id),
  team_id TEXT NOT NULL,
  subscription_revision INTEGER NOT NULL,
  seats INTEGER NOT NULL CHECK(seats BETWEEN 0 AND 1000),
  starts_at INTEGER NOT NULL CHECK(starts_at >= 0),
  ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
  fulfilled_at INTEGER NOT NULL CHECK(fulfilled_at BETWEEN 0 AND 253402300799000 AND fulfilled_at < ends_at),
  grant_id TEXT REFERENCES team_seat_capacity_grants(grant_id),
  CHECK((seats = 0 AND grant_id IS NULL) OR (seats > 0 AND grant_id IS NOT NULL AND grant_id = order_id)),
  FOREIGN KEY(team_id, subscription_revision) REFERENCES team_subscription_events(team_id, revision)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS wechat_native_fulfilments_no_replace
BEFORE INSERT ON team_billing_wechat_native_fulfilments
WHEN EXISTS (SELECT 1 FROM team_billing_wechat_native_fulfilments WHERE order_id = NEW.order_id)
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_fulfilments_no_update
BEFORE UPDATE ON team_billing_wechat_native_fulfilments
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_fulfilments_no_delete
BEFORE DELETE ON team_billing_wechat_native_fulfilments
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS team_billing_wechat_native_review_states (
  order_id TEXT NOT NULL REFERENCES team_billing_wechat_native_orders(order_id),
  state TEXT NOT NULL CHECK(state IN ('REFUND', 'CLOSED')),
  observed_at INTEGER NOT NULL CHECK(observed_at BETWEEN 0 AND 253402300799000),
  PRIMARY KEY(order_id, state)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS wechat_native_review_states_no_replace
BEFORE INSERT ON team_billing_wechat_native_review_states
WHEN EXISTS (SELECT 1 FROM team_billing_wechat_native_review_states WHERE order_id = NEW.order_id AND state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_review_states_no_update
BEFORE UPDATE ON team_billing_wechat_native_review_states
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_review_states_no_delete
BEFORE DELETE ON team_billing_wechat_native_review_states
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
