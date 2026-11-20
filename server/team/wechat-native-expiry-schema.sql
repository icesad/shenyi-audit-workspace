CREATE TABLE IF NOT EXISTS team_billing_wechat_native_lifecycle (
  order_id TEXT NOT NULL REFERENCES team_billing_wechat_native_orders(order_id),
  event TEXT NOT NULL CHECK(event IN ('TRACKED', 'PREPAY_STARTED', 'EXPIRED_UNSENT')),
  recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN 0 AND 253402300799000),
  PRIMARY KEY(order_id, event)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS wechat_native_lifecycle_validate
BEFORE INSERT ON team_billing_wechat_native_lifecycle
WHEN EXISTS (SELECT 1 FROM team_billing_wechat_native_lifecycle WHERE order_id = NEW.order_id AND event = NEW.event)
  OR NEW.event = 'TRACKED' AND
    (EXISTS (SELECT 1 FROM team_billing_wechat_native_lifecycle WHERE order_id = NEW.order_id)
      OR NEW.recorded_at <> (SELECT created_at FROM team_billing_wechat_native_orders WHERE order_id = NEW.order_id))
  OR NEW.event = 'PREPAY_STARTED' AND
    (EXISTS (SELECT 1 FROM team_billing_wechat_native_lifecycle WHERE order_id = NEW.order_id AND event = 'EXPIRED_UNSENT')
      OR NEW.recorded_at < (SELECT created_at FROM team_billing_wechat_native_orders WHERE order_id = NEW.order_id)
      OR NEW.recorded_at >= (SELECT expires_at FROM team_billing_wechat_native_orders WHERE order_id = NEW.order_id))
  OR NEW.event = 'EXPIRED_UNSENT' AND
    (NOT EXISTS (SELECT 1 FROM team_billing_wechat_native_lifecycle WHERE order_id = NEW.order_id AND event = 'TRACKED')
      OR EXISTS (SELECT 1 FROM team_billing_wechat_native_lifecycle WHERE order_id = NEW.order_id AND event = 'PREPAY_STARTED')
      OR EXISTS (SELECT 1 FROM team_billing_wechat_native_payments WHERE order_id = NEW.order_id)
      OR NEW.recorded_at < (SELECT expires_at FROM team_billing_wechat_native_orders WHERE order_id = NEW.order_id))
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_LIFECYCLE_CONFLICT'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_lifecycle_no_update
BEFORE UPDATE ON team_billing_wechat_native_lifecycle
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_lifecycle_no_delete
BEFORE DELETE ON team_billing_wechat_native_lifecycle
BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
