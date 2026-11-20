-- Installed explicitly on a provisioned team database. The simulation tables are independent.
CREATE TABLE IF NOT EXISTS team_billing_wechat_native_orders (
  order_id TEXT PRIMARY KEY NOT NULL CHECK(length(order_id) = 36),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  request_id TEXT NOT NULL CHECK(length(request_id) = 36),
  app_id TEXT NOT NULL CHECK(length(app_id) BETWEEN 1 AND 32),
  merchant_id TEXT NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 32 AND merchant_id NOT GLOB '*[^0-9]*'),
  merchant_order_id TEXT GENERATED ALWAYS AS (replace(order_id, '-', '')) STORED NOT NULL
    CHECK(length(merchant_order_id) = 32 AND merchant_order_id NOT GLOB '*[^a-f0-9]*'),
  product TEXT NOT NULL CHECK(product IN ('team-annual-renewal', 'team-seat-addition')),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 127),
  offer_id TEXT NOT NULL CHECK(length(offer_id) BETWEEN 1 AND 128),
  offer_revision INTEGER NOT NULL CHECK(offer_revision BETWEEN 1 AND 9007199254740991),
  seats INTEGER NOT NULL CHECK(seats BETWEEN 0 AND 1000),
  term_revision INTEGER,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 2147483647),
  currency TEXT NOT NULL CHECK(currency = 'CNY'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 253402300799000),
  expires_at INTEGER NOT NULL CHECK(expires_at BETWEEN created_at + 66000 AND min(created_at + 604800000, 253402300799000)
    AND expires_at % 1000 = 0),
  CHECK((product = 'team-annual-renewal' AND term_revision IS NULL) OR
    (product = 'team-seat-addition' AND term_revision IS NOT NULL AND term_revision > 0 AND seats > 0)),
  UNIQUE(team_id, request_id),
  UNIQUE(merchant_id, merchant_order_id),
  UNIQUE(order_id, merchant_id),
  FOREIGN KEY(team_id, term_revision) REFERENCES team_subscription_events(team_id, revision)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS team_billing_wechat_native_payments (
  order_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL CHECK(length(transaction_id) BETWEEN 1 AND 32 AND transaction_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  paid_at INTEGER NOT NULL CHECK(paid_at BETWEEN 0 AND 253402300799000),
  first_verified_at INTEGER NOT NULL CHECK(first_verified_at BETWEEN 0 AND 253402300799000 AND paid_at <= first_verified_at + 300000),
  UNIQUE(merchant_id, transaction_id),
  UNIQUE(order_id, merchant_id),
  FOREIGN KEY(order_id, merchant_id) REFERENCES team_billing_wechat_native_orders(order_id, merchant_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS team_billing_wechat_native_events (
  merchant_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 1 AND 36 AND event_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  order_id TEXT NOT NULL,
  verified_at INTEGER NOT NULL CHECK(verified_at BETWEEN 0 AND 253402300799000),
  PRIMARY KEY(merchant_id, event_id),
  FOREIGN KEY(order_id, merchant_id) REFERENCES team_billing_wechat_native_payments(order_id, merchant_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS wechat_native_events_by_order ON team_billing_wechat_native_events(order_id);

CREATE TABLE IF NOT EXISTS team_billing_wechat_native_query_confirmations (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES team_billing_wechat_native_payments(order_id),
  verified_at INTEGER NOT NULL CHECK(verified_at BETWEEN 0 AND 253402300799000)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS wechat_native_orders_no_replace BEFORE INSERT ON team_billing_wechat_native_orders WHEN EXISTS (
  SELECT 1 FROM team_billing_wechat_native_orders WHERE order_id = NEW.order_id
    OR (team_id = NEW.team_id AND request_id = NEW.request_id)
    OR (merchant_id = NEW.merchant_id AND merchant_order_id = replace(NEW.order_id, '-', ''))
) BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_orders_no_update BEFORE UPDATE ON team_billing_wechat_native_orders BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_orders_no_delete BEFORE DELETE ON team_billing_wechat_native_orders BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_payments_no_replace BEFORE INSERT ON team_billing_wechat_native_payments WHEN EXISTS (
  SELECT 1 FROM team_billing_wechat_native_payments WHERE order_id = NEW.order_id
    OR (merchant_id = NEW.merchant_id AND transaction_id = NEW.transaction_id)
) BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_payments_no_update BEFORE UPDATE ON team_billing_wechat_native_payments BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_payments_no_delete BEFORE DELETE ON team_billing_wechat_native_payments BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_events_no_replace BEFORE INSERT ON team_billing_wechat_native_events WHEN EXISTS (
  SELECT 1 FROM team_billing_wechat_native_events WHERE merchant_id = NEW.merchant_id AND event_id = NEW.event_id
) BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_events_no_update BEFORE UPDATE ON team_billing_wechat_native_events BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_events_no_delete BEFORE DELETE ON team_billing_wechat_native_events BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS wechat_native_queries_no_replace BEFORE INSERT ON team_billing_wechat_native_query_confirmations WHEN EXISTS (
  SELECT 1 FROM team_billing_wechat_native_query_confirmations WHERE order_id = NEW.order_id
) BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_queries_no_update BEFORE UPDATE ON team_billing_wechat_native_query_confirmations BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wechat_native_queries_no_delete BEFORE DELETE ON team_billing_wechat_native_query_confirmations BEGIN SELECT RAISE(ABORT, 'WECHAT_NATIVE_IMMUTABLE'); END;
