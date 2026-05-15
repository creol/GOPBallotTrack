-- Per-race group label, used to collapse races into sections in the admin sidebar.
-- Free-form text so that "preconfigured" groups (County, State, State School Board, House,
-- Senate, Federal, Other) and custom group names share the same column. The client treats
-- any value the same way; the preconfigured list lives in client/src/utils/raceGroups.js.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS race_group VARCHAR(64) NOT NULL DEFAULT 'Other';
