-- Migration 020: Ballot reconciliation decisions for pass comparison
CREATE TABLE IF NOT EXISTS ballot_reconciliations (
  id                SERIAL PRIMARY KEY,
  round_id          INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  ballot_serial_id  INTEGER NOT NULL REFERENCES ballot_serials(id),
  decision          VARCHAR(30) NOT NULL
    CHECK (decision IN ('pass_agree_auto', 'accept_pass', 'needs_physical_review', 'manual_override')),
  accepted_pass_id  INTEGER REFERENCES passes(id),
  reviewed_by       VARCHAR(255),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ballot_reconciliations_round ON ballot_reconciliations(round_id);
CREATE INDEX IF NOT EXISTS idx_ballot_reconciliations_serial ON ballot_reconciliations(ballot_serial_id);
