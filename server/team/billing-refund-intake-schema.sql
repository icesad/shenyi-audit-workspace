-- Platform intake evidence is separate from payment and entitlement execution.
CREATE TABLE IF NOT EXISTS team_billing_refund_intake_reviewers (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='billing.refund-intake'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
  CHECK(rowid>0)
) STRICT;

CREATE TABLE IF NOT EXISTS team_billing_refund_intake_events (
  request_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(request_id)=36 AND instr(request_id,char(0))=0 AND length(replace(request_id,'-',''))=32
    AND replace(request_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND substr(request_id,15,1)='4' AND substr(request_id,20,1) IN ('8','9','a','b')
  ),
  order_kind TEXT NOT NULL CHECK(order_kind IN ('annual','seat')),
  order_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  payment_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  actor_id TEXT NOT NULL REFERENCES team_billing_refund_intake_reviewers(user_id),
  authority_revision INTEGER NOT NULL CHECK(authority_revision BETWEEN 1 AND 9007199254740991),
  reason TEXT NOT NULL CHECK(
    (revision=1 AND reason IN ('duplicate-payment','purchase-change','service-issue','other'))
    OR (revision>1 AND reason IN ('payment-checked','details-requested','customer-contacted','other'))
  ),
  reference TEXT CHECK(reference IS NULL OR (
    length(reference) BETWEEN 1 AND 80 AND instr(reference,char(0))=0
    AND substr(reference,1,1) GLOB '[A-Za-z0-9]' AND reference NOT GLOB '*[^A-Za-z0-9._-]*'
  )),
  recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN 0 AND 8640000000000000),
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND instr(record_sha256,char(0))=0
      AND record_sha256 NOT GLOB '*[^0-9a-f]*'),
  UNIQUE(order_kind,order_id,revision),
  CHECK(rowid>0)
) STRICT;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_reviewer_admit
BEFORE INSERT ON team_billing_refund_intake_reviewers
WHEN NEW.revision<>1
  OR EXISTS(SELECT 1 FROM team_billing_refund_intake_reviewers WHERE user_id=NEW.user_id OR rowid=NEW.rowid)
  OR EXISTS(SELECT 1 FROM team_memberships WHERE user_id=NEW.user_id)
  OR EXISTS(SELECT 1 FROM team_operators WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_reviewer_change
BEFORE UPDATE ON team_billing_refund_intake_reviewers
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.permission IS NOT OLD.permission OR NEW.rowid<>OLD.rowid
  OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_reviewer_no_delete
BEFORE DELETE ON team_billing_refund_intake_reviewers
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_member_insert
BEFORE INSERT ON team_memberships
WHEN EXISTS(SELECT 1 FROM team_billing_refund_intake_reviewers WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_member_reassign
BEFORE UPDATE OF user_id ON team_memberships
WHEN EXISTS(SELECT 1 FROM team_billing_refund_intake_reviewers WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_operator_insert
BEFORE INSERT ON team_operators
WHEN EXISTS(SELECT 1 FROM team_billing_refund_intake_reviewers WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_operator_reassign
BEFORE UPDATE OF user_id ON team_operators
WHEN EXISTS(SELECT 1 FROM team_billing_refund_intake_reviewers WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_event_authority
BEFORE INSERT ON team_billing_refund_intake_events
WHEN NOT EXISTS (
  SELECT 1 FROM team_billing_refund_intake_reviewers reviewer
  JOIN team_users user ON user.user_id=reviewer.user_id
  JOIN team_credentials credential ON credential.user_id=reviewer.user_id
  WHERE reviewer.user_id=NEW.actor_id AND reviewer.revision=NEW.authority_revision
    AND reviewer.status='active' AND user.status='active'
)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_AUTHORITY'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_event_payment
BEFORE INSERT ON team_billing_refund_intake_events
WHEN NOT (
  NEW.order_kind='annual' AND EXISTS(
    SELECT 1 FROM team_annual_orders orders JOIN team_annual_verified_payments payment ON payment.order_id=orders.order_id
    WHERE orders.order_id=NEW.order_id AND orders.team_id=NEW.team_id AND orders.environment='simulation-v1'
      AND payment.team_id=NEW.team_id AND payment.payment_id=NEW.payment_id AND payment.confirmed_at<=NEW.recorded_at
  ) OR NEW.order_kind='seat' AND EXISTS(
    SELECT 1 FROM team_seat_orders orders JOIN team_seat_verified_payments payment ON payment.order_id=orders.order_id
    WHERE orders.order_id=NEW.order_id AND orders.team_id=NEW.team_id AND orders.environment='simulation-v1'
      AND payment.team_id=NEW.team_id AND payment.payment_id=NEW.payment_id AND payment.confirmed_at<=NEW.recorded_at
  )
)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_PAYMENT_REQUIRED'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_event_append
BEFORE INSERT ON team_billing_refund_intake_events
WHEN EXISTS(SELECT 1 FROM team_billing_refund_intake_events WHERE request_id=NEW.request_id OR rowid=NEW.rowid)
  OR NEW.revision <> COALESCE((
    SELECT revision FROM team_billing_refund_intake_events
    WHERE order_kind=NEW.order_kind AND order_id=NEW.order_id ORDER BY revision DESC LIMIT 1
  ),0)+1
  OR NEW.recorded_at < COALESCE((
    SELECT recorded_at FROM team_billing_refund_intake_events
    WHERE order_kind=NEW.order_kind AND order_id=NEW.order_id ORDER BY revision DESC LIMIT 1
  ),0)
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_event_no_update
BEFORE UPDATE ON team_billing_refund_intake_events
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_refund_intake_event_no_delete
BEFORE DELETE ON team_billing_refund_intake_events
BEGIN SELECT RAISE(ABORT,'BILLING_REFUND_INTAKE_IMMUTABLE'); END;
