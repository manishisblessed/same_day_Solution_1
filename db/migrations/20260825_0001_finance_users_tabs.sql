-- Finance executives: per-user portal tab access (mirrors sub-admin departments).
-- Empty array = Home only. 'all' is a UI sentinel and is expanded to explicit keys before storage.

ALTER TABLE finance_users
  ADD COLUMN IF NOT EXISTS tabs TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN finance_users.tabs IS
  'Finance portal tab keys this user can access: reconciliation, reports, settlement, wallet-ledger, settings. Empty = Home only.';

-- Backward compatibility: existing finance executives had full portal access,
-- so grant them every tab. New rows default to '{}' (Home only) until assigned.
UPDATE finance_users
SET tabs = ARRAY['reconciliation', 'reports', 'settlement', 'wallet-ledger', 'settings']
WHERE tabs = '{}';
