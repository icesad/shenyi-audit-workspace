-- M5D trusted simulation only. Orders, verified facts and fulfilments are immutable.
CREATE TABLE IF NOT EXISTS team_annual_orders (
 order_id TEXT PRIMARY KEY NOT NULL CHECK(length(order_id)=36 AND length(replace(order_id,'-',''))=32 AND replace(order_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(order_id,9,1)='-' AND substr(order_id,14,1)='-' AND substr(order_id,19,1)='-' AND substr(order_id,24,1)='-' AND substr(order_id,15,1)='4' AND substr(order_id,20,1) IN ('8','9','a','b')),
 team_id TEXT NOT NULL REFERENCES teams(team_id),
 actor_id TEXT NOT NULL REFERENCES team_users(user_id),
 request_id TEXT NOT NULL CHECK(length(request_id)=36 AND length(replace(request_id,'-',''))=32 AND replace(request_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-' AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-' AND substr(request_id,15,1)='4' AND substr(request_id,20,1) IN ('8','9','a','b')),
 term_operation_id TEXT UNIQUE NOT NULL CHECK(length(term_operation_id)=36 AND length(replace(term_operation_id,'-',''))=32 AND replace(term_operation_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(term_operation_id,9,1)='-' AND substr(term_operation_id,14,1)='-' AND substr(term_operation_id,19,1)='-' AND substr(term_operation_id,24,1)='-' AND substr(term_operation_id,15,1)='4' AND substr(term_operation_id,20,1) IN ('8','9','a','b')),
 merchant_id TEXT NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128 AND merchant_id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(merchant_id,1,1) GLOB '[A-Za-z0-9]'),
 offer_id TEXT NOT NULL CHECK(length(offer_id) BETWEEN 1 AND 128 AND offer_id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(offer_id,1,1) GLOB '[A-Za-z0-9]'),
 offer_revision INTEGER NOT NULL CHECK(offer_revision BETWEEN 1 AND 9007199254740991),
 product TEXT NOT NULL CHECK(product='team-annual-renewal'),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
 currency TEXT NOT NULL CHECK(currency='CNY'),
 environment TEXT NOT NULL CHECK(environment='simulation-v1'),
 created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
 UNIQUE(team_id,request_id),UNIQUE(order_id,team_id)
) STRICT;
CREATE TABLE IF NOT EXISTS team_annual_verified_payments (
 payment_id TEXT PRIMARY KEY NOT NULL CHECK(length(payment_id)=36 AND length(replace(payment_id,'-',''))=32 AND replace(payment_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(payment_id,9,1)='-' AND substr(payment_id,14,1)='-' AND substr(payment_id,19,1)='-' AND substr(payment_id,24,1)='-' AND substr(payment_id,15,1)='4' AND substr(payment_id,20,1) IN ('8','9','a','b')),
 order_id TEXT UNIQUE NOT NULL,
 team_id TEXT NOT NULL,
 event_id TEXT UNIQUE NOT NULL CHECK(length(event_id)=36 AND length(replace(event_id,'-',''))=32 AND replace(event_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(event_id,9,1)='-' AND substr(event_id,14,1)='-' AND substr(event_id,19,1)='-' AND substr(event_id,24,1)='-' AND substr(event_id,15,1)='4' AND substr(event_id,20,1) IN ('8','9','a','b')),
 transaction_id TEXT UNIQUE NOT NULL CHECK(length(transaction_id)=36 AND length(replace(transaction_id,'-',''))=32 AND replace(transaction_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(transaction_id,9,1)='-' AND substr(transaction_id,14,1)='-' AND substr(transaction_id,19,1)='-' AND substr(transaction_id,24,1)='-' AND substr(transaction_id,15,1)='4' AND substr(transaction_id,20,1) IN ('8','9','a','b')),
 receipt_json TEXT NOT NULL CHECK(length(receipt_json) BETWEEN 1 AND 16384),
 receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
 confirmed_at INTEGER NOT NULL CHECK(confirmed_at BETWEEN 0 AND 8640000000000000),
 UNIQUE(payment_id,order_id,team_id),
 FOREIGN KEY(order_id,team_id) REFERENCES team_annual_orders(order_id,team_id)
) STRICT;
CREATE TABLE IF NOT EXISTS team_annual_fulfilments (
 fulfilment_id TEXT PRIMARY KEY NOT NULL CHECK(length(fulfilment_id)=36 AND length(replace(fulfilment_id,'-',''))=32 AND replace(fulfilment_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(fulfilment_id,9,1)='-' AND substr(fulfilment_id,14,1)='-' AND substr(fulfilment_id,19,1)='-' AND substr(fulfilment_id,24,1)='-' AND substr(fulfilment_id,15,1)='4' AND substr(fulfilment_id,20,1) IN ('8','9','a','b')),
 order_id TEXT UNIQUE NOT NULL,
 payment_id TEXT UNIQUE NOT NULL,
 team_id TEXT NOT NULL,
 term_operation_id TEXT UNIQUE NOT NULL REFERENCES team_subscription_events(operation_id),
 before_revision INTEGER NOT NULL CHECK(before_revision BETWEEN 0 AND 9007199254740990),
 subscription_revision INTEGER NOT NULL CHECK(subscription_revision BETWEEN 1 AND 9007199254740991 AND subscription_revision=before_revision+1),
 starts_at INTEGER NOT NULL CHECK(starts_at BETWEEN 0 AND 8640000000000000),
 ends_at INTEGER NOT NULL CHECK(ends_at BETWEEN 0 AND 8640000000000000 AND ends_at>starts_at),
 renewal_starts_at INTEGER NOT NULL CHECK(renewal_starts_at>=starts_at AND renewal_starts_at<ends_at),
 confirmed_at INTEGER NOT NULL CHECK(confirmed_at BETWEEN 0 AND 8640000000000000),
 fulfilled_at INTEGER NOT NULL CHECK(fulfilled_at BETWEEN confirmed_at AND 8640000000000000),
 calendar_version TEXT NOT NULL CHECK(calendar_version='beijing-calendar-year-v1'),
 FOREIGN KEY(order_id,team_id) REFERENCES team_annual_orders(order_id,team_id),
 FOREIGN KEY(payment_id,order_id,team_id) REFERENCES team_annual_verified_payments(payment_id,order_id,team_id),
 FOREIGN KEY(team_id,subscription_revision) REFERENCES team_subscription_events(team_id,revision)
) STRICT;
CREATE TRIGGER IF NOT EXISTS annual_orders_no_update BEFORE UPDATE ON team_annual_orders BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS annual_orders_no_delete BEFORE DELETE ON team_annual_orders BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS annual_payments_no_update BEFORE UPDATE ON team_annual_verified_payments BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS annual_payments_no_delete BEFORE DELETE ON team_annual_verified_payments BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS annual_fulfilments_no_update BEFORE UPDATE ON team_annual_fulfilments BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS annual_fulfilments_no_delete BEFORE DELETE ON team_annual_fulfilments BEGIN SELECT RAISE(ABORT,'ANNUAL_BILLING_IMMUTABLE');END;
