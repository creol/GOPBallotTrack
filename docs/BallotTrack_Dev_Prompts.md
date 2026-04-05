# BallotTrack — Development Prompts Reference

**Use order:** A → B → C → D → E → F → G  
**Rule:** Commit and test after each prompt before starting the next.  
**Data note:** All current DB data is test data — migrations may wipe and reseed freely.  
**ID convention:** All tables use `SERIAL` (INTEGER) primary keys. All foreign keys are `INTEGER`.  
**UI terminology:** User-facing text says "Election Event". Code/DB uses "election".

---

## Risk Summary

| Prompt | What it does | Risk |
|--------|-------------|------|
| A | Reviewed ballot system — replaces spoiled_ballots table entirely | Medium |
| B | Race & round status overhaul — new status values throughout codebase | High |
| C | Per-round ballot generation with election design inheritance | Low |
| D | Race Admin + Super Admin roles — removes judge/chair/tally_operator | High |
| E | Control Center — voting open/close, publish results, recount, void | Medium |
| F | Scanner station setup, agent, cross-race conflict, pass workflow | Medium |
| G | TV dashboard + mobile dashboard | Low |

---

## PROMPT A — Reviewed Ballot System

> Replaces both the `spoiled_ballots` and `flagged_ballots` tables with a
> unified reviewed ballot system. This is a complete replacement — remove all
> traces of both old systems.

### Database Changes

1. **Drop** the `spoiled_ballots` table entirely.
2. **Drop** the `flagged_ballots` table entirely.
3. **Update** `ballot_serials.status` CHECK constraint to:
   `unused | counted | damaged | remade | spoiled`
4. **Create** a new `reviewed_ballots` table:

```sql
CREATE TABLE reviewed_ballots (
  id                    SERIAL PRIMARY KEY,
  round_id              INTEGER NOT NULL REFERENCES rounds(id),
  pass_id               INTEGER REFERENCES passes(id),
  original_serial_id    INTEGER NOT NULL REFERENCES ballot_serials(id),
  replacement_serial_id INTEGER REFERENCES ballot_serials(id),
  scanner_id            INTEGER REFERENCES scanners(id),
  outcome               VARCHAR CHECK (outcome IN ('remade', 'spoiled', 'counted', 'rejected')),
  flag_reason           VARCHAR,
  omr_scores            JSONB,
  notes                 TEXT,
  photo_path            VARCHAR,
  image_path            VARCHAR,
  reviewed_by           VARCHAR,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### How Ballots Enter the Review Queue

**From OMR scanning (auto-flagged):** When the scan watcher detects a
problematic ballot (QR not found, no mark, overvote, uncertain), it creates
a `reviewed_ballots` row with `outcome = NULL`, `flag_reason` set
(e.g. `'qr_not_found'`, `'no_mark'`, `'overvote'`, `'uncertain'`), and
`omr_scores` containing the OMR analysis data. These replace the old
`flagged_ballots` inserts.

**From manual reporting:** An admin creates a review record manually for a
physically damaged or questionable ballot.

### Outcome Rules

- **`counted`** — OMR flag was reviewed, ballot is valid. Admin selects the
  correct candidate. The ballot is counted in the tally.
  - Original serial status → `counted`
- **`remade`** — intent was clear but ballot is damaged. A pre-generated unused
  serial from the same round is assigned as the replacement.
  - Replacement serial status → `counted` (replacement is the one counted)
  - Original serial status → `damaged`
  - The remade ballot **IS** counted in the tally
- **`spoiled`** — intent could not be determined. No replacement serial.
  - Original serial status → `spoiled`
  - **NOT** counted in the tally
- **`rejected`** — ballot is invalid (wrong round, unrecognized SN, etc.)
  - Original serial status → `spoiled`
  - **NOT** counted in the tally

### Photo Upload — Two Methods

**Method 1 (browser upload):** File input on the ballot review page in the
admin UI. Works on desktop and mobile.

**Method 2 (mobile QR):** Generate a one-time QR code per review session
linking to `/upload-ballot-photo/:reviewToken`. This page shows a camera
button, captures the photo, and submits it to the review record. Display
warning: _"This link only works if your device is connected to the same WiFi
network as the BallotTrack server."_ Token expires after 30 minutes or once
a photo is submitted.

### API Changes

Remove all routes referencing `spoiled_ballots` and `flagged_ballots`, then
add:

- `POST /api/rounds/:id/reviewed-ballots` — create a review record (outcome
  TBD, photo optional)
- `PUT /api/reviewed-ballots/:id` — update outcome, notes,
  replacement_serial_id, review_candidate_id, photo
- `GET /api/rounds/:id/reviewed-ballots` — list all reviewed ballots for a
  round (filterable by `?status=unresolved` for pending review)
- `POST /api/upload-ballot-photo/:token` — mobile photo upload endpoint
- `GET /api/upload-ballot-photo/:token` — serve the mobile upload page

### Results PDF

- **Section: "Remade Ballots"** — list each with original SN, replacement SN,
  reviewer name, notes, photo thumbnail
- **Section: "Spoiled Ballots"** — list each with original SN, reason,
  reviewer name, notes, photo thumbnail if available
- Remade ballot vote counts are included in candidate totals with footnote:
  _"Includes X remade ballot(s)"_

### Public Dashboard

Do not expose any reviewed ballot data publicly.

### Admin UI (round detail page)

Add a **"Ballot Review Queue"** section showing all unresolved reviewed ballots.
Each entry: original SN, scanned image (if available), OMR scores (if
auto-flagged), flag reason, photo (if uploaded), outcome selector (Counted /
Remade / Spoiled / Rejected), candidate selector (for counted/remade),
replacement SN picker (unused serials only, for remade), notes field, submit
button.

Admin **cannot** declare a round result until all reviewed ballots have an
outcome.

### Cleanup Checklist

Verify these files no longer reference `spoiled_ballots` or `flagged_ballots`:
- `server/src/routes/scans.js` — remove spoiled ballot endpoint
- `server/src/routes/flagged.js` — replace entirely with reviewed-ballots routes
- `server/src/middleware/scanWatcher.js` — update to insert into `reviewed_ballots` instead of `flagged_ballots`
- `server/src/routes/passes.js`
- `server/src/routes/rounds.js`
- `server/src/routes/confirmation.js`
- `server/src/services/confirmationService.js`
- `server/src/pdf/resultsPdf.js` — update to query `reviewed_ballots`
- `client/src/pages/FlaggedReview.jsx` — replace with new Ballot Review Queue UI
- `client/src/pages/SpoiledBallot.jsx` — remove entirely
- `client/src/pages/Scanner.jsx` — remove "Report Spoiled" link
- `client/src/App.jsx` — remove `/scan/:roundId/spoiled` route
- `client/src/pages/RoundDetail.jsx` — update flagged count to use reviewed_ballots
- Any WebSocket event emitters (`scan:flagged` → `scan:review_needed`)
- The public API
- Any seed data or test fixtures
- `CLAUDE.md` project context file

---

## PROMPT B — Race & Round Status Overhaul

> Replace the current race and round status systems. Test data can be wiped —
> run a clean migration.

### Race Status (stored on `races.status`)

| Status | Description |
|--------|-------------|
| `pending_needs_action` | Default on creation |
| `ready` | All requirements met (see checklist below) |
| `in_progress` | Auto-set when ANY round moves to `voting_open` |
| `results_finalized` | Admin sets when all rounds are finalized or canceled |

**Race "Ready" requirements** (show unmet items as hover tooltip):
- At least 2 active (non-withdrawn) candidates
- Ballot count set (> 0)
- Max rounds set (> 0)
- Ballot PDF generated for Round 1

**Once `ready`, these actions are BLOCKED:**
- Adding candidates
- Changing ballot count

**These actions remain ALWAYS ALLOWED:**
- Withdrawing a candidate
- Editing candidate names
- Adding rounds
- Regenerating ballot PDF
- Downloading ballot PDF

### Round Status (stored on `rounds.status`)

Replaces current values (`pending / scanning / confirmed / pending_release /
released`) with:

| Status | Description |
|--------|-------------|
| `pending_needs_action` | Default on round creation |
| `ready` | Ballot PDF generated for this round |
| `voting_open` | Convention Chair opens voting (Control Center only) |
| `voting_closed` | Convention Chair closes voting (Control Center only) |
| `tallying` | Admin opens for scanning — scanner page activates |
| `round_finalized` | Admin declares result, published via Control Center |
| `canceled` | Terminal — set when admin confirms no more rounds needed |

**Round "Ready" requirements** (tooltip checklist):
- Ballot PDF generated for this round

### Status Transitions

```
pending_needs_action → ready            automatic when ballot PDF generated
ready                → voting_open      Chair action in Control Center ONLY
voting_open          → voting_closed    Chair action in Control Center ONLY
voting_closed        → tallying         Admin action
tallying             → round_finalized  Admin declares result (all reviewed
                                        ballots resolved, min 2 passes done)
pending/ready round  → canceled         When Chair confirms no more rounds
```

**Auto-trigger:** When any round moves to `voting_open` → automatically set
parent race status to `in_progress`. No additional admin action required.

**Finalization gate:** Before a round can move to `round_finalized`, the admin
must review pass comparison (vote counts per candidate across all passes).
If passes have mismatches, admin must resolve with override notes before
finalizing. This preserves the existing pass comparison logic from
`confirmationService.js`.

### Status Transition Timing (Admin-Only Analytics)

Track wall-clock time between every status change for races and rounds. Never
shown publicly — internal process optimization only.

```sql
CREATE TABLE status_transitions (
  id               SERIAL PRIMARY KEY,
  entity_type      VARCHAR NOT NULL CHECK (entity_type IN ('race', 'round')),
  entity_id        INTEGER NOT NULL,
  from_status      VARCHAR,
  to_status        VARCHAR NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  changed_by       VARCHAR,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Every status change inserts a new row and closes the previous row for that
entity (sets `ended_at = NOW()`, computes `duration_seconds`). First row for
an entity has `from_status = NULL`.

### Database Migration

- Alter `races.status` CHECK constraint to new values
- Alter `rounds.status` CHECK constraint to new values
- Add `rounds.published_at TIMESTAMPTZ` — set ONLY by Control Center publish action; public API gates on this column
- Wipe existing round/race status data and reseed with
  `pending_needs_action`

**Note:** `rounds.ballot_pdf_generated_at`, `rounds.ballot_pdf_path`, and
`rounds.ballot_design_overrides` are added in Prompt C. Do NOT add them here.

**Update ALL code** that checks `round.status` or `race.status` — provide a
complete search-and-replace across all route files, services, and frontend
components.

**Update `server/src/routes/public.js`:** Replace all `status = 'released'`
filters with `published_at IS NOT NULL`. Rewrite `status_label` computation
to use the new status values. This is critical — the public API will break
without this update.

---

## PROMPT C — Per-Round Ballot Design Overrides

> Add per-round design override support and tracking columns to the existing
> per-round ballot generation system. The generation endpoints already exist
> (`POST /api/admin/rounds/:id/generate-ballots`, `GET .../ballot-pdf`,
> `GET .../ballot-preview`) — this prompt adds design flexibility and
> generation tracking.

### Round-Level Fields (add to `rounds` table)

```sql
ALTER TABLE rounds ADD COLUMN ballot_pdf_generated_at TIMESTAMPTZ;
ALTER TABLE rounds ADD COLUMN ballot_pdf_path VARCHAR;
ALTER TABLE rounds ADD COLUMN ballot_design_overrides JSONB;
```

### Behavior

- Round 1 inherits the election's `ballot_design` config by default
- Subsequent rounds also inherit election ballot design but allow per-round
  overrides (candidate order, ballot size) stored in
  `ballot_design_overrides` (merged with election design at generation time)
- A round **cannot** reach status `ready` until its ballot PDF is generated
- "Generate Ballot PDF" appears in the round's pending checklist if not yet
  generated
- When ballot PDF is generated, set `ballot_pdf_generated_at = NOW()` and
  `ballot_pdf_path` to the file location

### API Updates (existing endpoints — modify behavior)

- `POST /api/admin/rounds/:id/generate-ballots` — now reads and merges
  `ballot_design_overrides` with election design before generating
- `PUT /api/admin/rounds/:id/ballot-overrides` — **NEW** — save per-round
  design overrides (ballot size, candidate order)
- `GET /api/admin/rounds/:id/ballot-overrides` — **NEW** — get current
  overrides for this round

### Admin UI (round detail page)

Update the existing **"Ballots"** section:
- Show last generated timestamp (`ballot_pdf_generated_at`)
- Override options (expandable): ballot size, candidate order
- Save overrides button
- Regenerate button (always available — uses overrides if set)

---

## PROMPT D — Race Admin Role & Auth Overhaul

> Replace the current PIN-from-.env auth system with a database-driven admin
> user system. Remove the `judge`, `chair`, and `tally_operator` roles
> entirely — replaced by `race_admin` and `super_admin`.

### New Roles

| Role | Access |
|------|--------|
| `super_admin` | Full access to everything including Control Center |
| `race_admin` | Full access within assigned races only, including scanning |

### Database Changes

```sql
CREATE TABLE admin_users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR NOT NULL,
  role            VARCHAR CHECK (role IN ('super_admin', 'race_admin')),
  pin_hash        VARCHAR NOT NULL,
  must_change_pin BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE race_admin_assignments (
  id             SERIAL PRIMARY KEY,
  race_id        INTEGER NOT NULL REFERENCES races(id),
  admin_user_id  INTEGER NOT NULL REFERENCES admin_users(id),
  assigned_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Auth Flow

- Login page: enter name (or select from list) + PIN
- On first login (`must_change_pin = true`): force PIN change before any
  other action
- Super Admin can reset any user's PIN to default (`"0000"`) —
  `must_change_pin` flag resets to `true` automatically
- Super Admin can also directly set a new PIN for any user
- Session stored as JWT or signed cookie with `role` and `user_id`

### Seeding

- On first run, create one `super_admin`: name `"Admin"`, PIN `"1234"`,
  `must_change_pin = true`
- Remove `ADMIN_PIN`, `JUDGE_PIN`, `CHAIR_PIN` from `.env`

### Race Admin Behavior

- After login, lands on a page showing only their assigned races
- Can do everything within those races: manage candidates, open/close rounds
  for tallying, run passes, review ballots, use the scanner
- Cannot see or touch other races or global settings

### Super Admin Behavior

- Full access to all races and elections
- Access to Control Center (Prompt E)
- Can assign race_admins to races
- Can add, edit, reset PINs for any admin user

### Middleware Updates

Replace `requireAdmin`, `requireJudge`, `requireChair` with:
- `requireSuperAdmin` — super_admin only
- `requireRaceAdmin(raceId)` — super_admin OR race_admin assigned to that raceId

Apply to all existing routes appropriately.

### Cleanup

Remove all references to `judge`, `chair`, `tally_operator` roles in:
- Routes
- Middleware
- UI components
- `CLAUDE.md`

---

## PROMPT E — Control Center (Super Admin Only)

> Build a Control Center page accessible only to Super Admins. This is the
> single place where voting is opened/closed and results are published.

### Route: `/admin/control-center`

### Section 1 — Active Races Panel

For each race currently `in_progress`:
- Race name, current round number, status badge
- **"Open Voting"** button → moves round to `voting_open`, auto-sets race to
  `in_progress`, broadcasts to public dashboard
- **"Close Voting"** button → moves round to `voting_closed`, broadcasts
- **"Open for Tallying"** button → moves round to `tallying`, scanner page
  activates, broadcasts
- **"Publish Round Result"** button → appears only after round is
  `round_finalized` — publishes to public dashboard

### Section 2 — Publish Finalized Rounds

When a round is `round_finalized` (admin has already resolved pass
comparisons, reviewed ballots, and set candidate outcomes):
- Show results preview (candidate name, votes, percentage to 5 decimals)
- Show candidate outcomes set by Race Admin (eliminated, advance, winner, etc.)
- **"Publish to Dashboard"** button → sets `rounds.published_at = NOW()`,
  broadcasts to public dashboard via WebSocket
- Results are NOT visible publicly until this button is clicked

### Candidate Round Outcomes (set by Race Admin before publish)

Before a round reaches the Control Center for publishing, the Race Admin sets
per-candidate outcomes for that round. These are stored in `round_results`:

```sql
ALTER TABLE round_results ADD COLUMN outcome VARCHAR
  CHECK (outcome IN ('eliminated', 'advance', 'convention_winner', 'winner', 'advance_to_primary'));
```

| Outcome | Meaning |
|---|---|
| `eliminated` | Candidate is out after this round |
| `advance` | Candidate advances to the next round |
| `convention_winner` | Wins the race at this convention |
| `winner` | Declared winner (general use) |
| `advance_to_primary` | Advances to a primary election |
| *(NULL)* | No decision yet — still active |

The Control Center displays these outcomes in the publish preview. Once
published, they appear on both dashboards with colored badges.

### Section 3 — Recount / Challenge

On any `round_finalized` round:
- **"Issue Recount"** button — resets round to `tallying`, deletes existing
  passes, creates a fresh pass set. Old results are archived (not deleted)
  with a required notes field.
- **"Void Round & Advance"** button — marks round as `canceled` with reason
  `"voided"`, no result recorded, moves to next round. Requires mandatory
  notes field before confirming.

### Section 4 — Next Round Control

After a round is finalized and published:
- **"Open Next Round"** button → advances to the next round
- **"No More Rounds — Finalize Race"** button → cancels all subsequent
  rounds, sets race to `results_finalized`

### Section 5 — Real-Time Status

All status changes on this page broadcast via WebSocket so that:
- Public dashboard updates immediately
- Scanner pages activate/deactivate automatically
- Any admin viewing a round page sees the update

### Important Constraints

- `voting_open` / `voting_closed` transitions happen **ONLY** from this page
- Publishing results to the public dashboard happens **ONLY** from this page
- Scanner page automatically becomes active when a round moves to `tallying`
  — no separate "open scanner" action needed

---

## PROMPT F — Scanner Architecture & Station Setup

> Support multiple physical scanning stations across different rooms with a
> clean browser-based station setup flow. Scanner assignment uses Option A:
> browser setup page.

### Part 1 — Scanning Station Concept

A "scanning station" is a laptop physically connected to one or more ScanSnap
iX2500 scanners via USB. The ScanSnap deposits image files into a local output
folder. A lightweight watcher agent (Part 2) watches that folder and POSTs
each image to the BallotTrack server.

Each station must be assigned to exactly one race/round before scanning can
begin. Assignment is done via a setup page in the browser on the station
laptop.

### Part 2 — Station Agent

Create a standalone Node.js script at `/agent/station-agent.js`.

This agent runs on each scanning station laptop (NOT in Docker):

1. Watches a configurable local folder for new image files (JPG/PNG) using
   chokidar
2. When a new image appears, POSTs it to:
   `POST http://[SERVER_IP]:3000/api/stations/:stationId/upload`
   with multipart form data: `{ image: <file>, stationId }`
3. Retries on failure (up to 5 times, exponential backoff)
4. Logs success/failure to console with timestamp
5. Moves processed files to `./processed` subfolder, failed files to
   `./failed` subfolder

**Configuration** — read from `config.json` next to the script:

```json
{
  "serverUrl": "http://192.168.1.100:3000",
  "stationId": "station-1",
  "watchFolder": "C:/ScanSnap/Output",
  "retryAttempts": 5
}
```

**Run with:** `node station-agent.js`

**`/agent/package.json` dependencies:** `chokidar`, `form-data`, `axios`

**`/agent/README.md`** setup steps:
1. Install Node.js on the station laptop
2. Copy the `/agent` folder to the station laptop
3. Edit `config.json` with the server IP and watch folder path
4. Run: `node station-agent.js`
5. Open the station setup page in the browser to assign the round

### Part 3 — Station Setup Page

**Route:** `/station-setup`

Runs in the browser on the station laptop. No login required (stations are
trusted on the LAN).

**Step 1 — Enter the server URL**
- Field: "Server address" (e.g. `http://192.168.1.100:3000`)
- "Test Connection" button pings `GET /api/health` — shows green/red feedback
- "Next" when connection confirmed

**Step 2 — Select the active race and round**
- Fetch `GET /api/public/active-rounds` (all rounds in `tallying` status)
- Display as list: `[Race Name] — Round [N]`
- Operator taps/clicks the correct one
- Stores in `sessionStorage`: `{ serverUrl, roundId, raceName, roundNumber }`
- Calls `POST /api/stations/:stationId/assign` with `{ roundId }`

**Step 3 — Confirmation screen**
- Shows: _"This station is set up for: [Race Name] — Round [N]"_
- Large green checkmark
- "Start Scanning" button → navigates to `/scan/:roundId`

**Scanner page header** — always show prominently at top of `/scan/:roundId`:
> "Scanning for: [Race Name] — Round [N]"  
> Small "Change" link → returns to `/station-setup`

### Part 4 — Server-Side Station Endpoints

**Pre-requisite:** Extract `processSingleBallot()` from
`server/src/middleware/scanWatcher.js` into a new
`server/src/services/scanProcessingService.js`. This service accepts an image
buffer, stationId, and roundId as inputs (not a filesystem path). It performs:
QR decode, serial lookup, OMR analysis, DB writes, and WebSocket events. The
upload endpoint below calls this service.

```
GET  /api/public/active-rounds
     Returns all rounds with status = 'tallying' joined with race name
     and election name. No auth required.

POST /api/stations/:stationId/upload
     Accepts multipart image upload from station agent.
     - Reads stationId from URL param
     - Looks up assigned roundId from in-memory station_assignments Map
     - Saves image to uploads/elections/{eid}/rounds/{rid}/scans/
     - Calls scanProcessingService.processBallot(imageBuffer, stationId, roundId)
     - Returns { success, message }
     No auth required (trusted LAN).

POST /api/stations/:stationId/assign
     Body: { roundId }
     Stores assignment in server-side in-memory Map.
     Returns { success }

GET  /api/stations/:stationId/assignment
     Returns current round assignment for this station.
```

Station assignments stored in a simple in-memory `Map` on the server (no DB
table needed — assignments reset on server restart intentionally).

### Deprecation — Old Scanner System

The existing `scanners` table and `server/src/routes/scanners.js` are
deprecated and replaced by the station architecture. The
`server/src/middleware/scanWatcher.js` file-watching system is replaced by
the station-agent + upload endpoint pattern.

**Remove or deprecate:**
- `server/src/routes/scanners.js`
- `server/src/middleware/scanWatcher.js` (logic extracted to scanProcessingService)
- Scanner CRUD UI in `client/src/pages/ElectionDetail.jsx` (Scanners section)

### Ballot Boxes — Optional

Ballot box assignment is optional. When an election does not use ballot boxes,
the box concept must be completely invisible:
- No box columns in reports or exports
- No box mentions in scanner UI or station setup
- No box fields in results PDF
- Only show box-related UI/data when boxes are actually assigned to the
  election

### Part 5 — Cross-Race Conflict Detection

Update scan validation logic to handle multiple races tallying simultaneously.

When a ballot serial is received for a given `roundId`, validate in order:

**Step 1 — Check assigned round** (use `SELECT ... FOR UPDATE` in transaction):
```
SELECT from ballot_serials WHERE serial_number = ? AND round_id = ?
```
- Found + status `unused` → accept, count it
- Found + status != `unused` → reject as duplicate

**Step 2 — If not found, check other active rounds:**
```sql
SELECT bs.*, r.race_id, ra.name AS race_name, r.round_number
FROM ballot_serials bs
JOIN rounds r ON bs.round_id = r.id
JOIN races ra ON r.race_id = ra.id
WHERE bs.serial_number = ?
  AND r.status = 'tallying'
  AND r.id != [assignedRoundId]
```
- Found in another tallying round → return warning:
  ```json
  {
    "type": "wrong_station",
    "message": "This ballot belongs to [Race Name] Round [N]. Please scan it at that race's station.",
    "targetRace": "raceName",
    "targetRound": 2
  }
  ```
  Do NOT add to any queue. Emit WebSocket event `scan:wrong_station` to the
  OTHER round's active scanners: `{ serial, fromStation: stationId }`

- Not found in any tallying round → mark as `spoiled`, reason: _"Serial not
  found in any active round"_, add to reviewed_ballots queue for this round

**Step 3 — Not found anywhere in the election:**
- Mark as `spoiled`, reason: _"Unrecognized serial number"_
- Add to reviewed_ballots queue

### Part 6 — Pass Workflow Updates

**Pass auto-create:**
- Remove the "Start Pass" button from scanner UI
- When the first ballot is scanned and no active pass exists for the round,
  automatically create Pass 1
- Display on scanner page: _"Pass [N] in progress — [X] ballots scanned"_

**Minimum 2 passes:**
- A round cannot be declared finalized until at least 2 passes are complete

**Pass minimum override:**
- A `super_admin` or `race_admin` assigned to this race can override the
  2-pass minimum by entering their PIN
- Show "Override minimum passes (PIN required)" button when only 1 pass is
  complete
- Override logged with: admin name, timestamp, optional notes

**Batch display on scanner page:**
- Group scans into batches (one batch = continuous scanning without a 5-min
  gap)
- Display each batch as a card: _"Batch [N] — [X] ballots — [time range]"_
- If ballot boxes assigned: show box number on batch card
- If no boxes assigned: omit box column entirely

**Complete Pass:**
- "Complete Pass" button appears when operator is done scanning
- Clicking marks pass complete, shows summary
- If Pass 1: prompt _"Begin Pass 2 when ready"_
- If Pass 2+: show pass comparison view

---

## PROMPT G — Public & TV Dashboards

> Build the public-facing dashboards. Two modes: TV/monitor and mobile.
> Both are read-only with no auth required.

### TV/Monitor Dashboard (`/public/:electionId?mode=tv`)

**Pre-voting state** (any race not yet `in_progress`):
- Each race displayed as a card: race name, round number, candidate list
- No results shown
- Status badge: _"Awaiting Vote"_ (same for `pending_needs_action` and `ready`)

**Voting Open** (round status: `voting_open`):
- Card shows: **"VOTING OPEN — Round [N]"** in large prominent text with
  clear visual indicator (color change or badge)
- Candidate list still shown, no vote counts

**Voting Closed** (round status: `voting_closed`):
- Card shows: _"VOTING CLOSED — Ballots Being Collected"_

**Tallying** (round status: `tallying`):
- Card shows: _"TALLYING IN PROGRESS — Round [N]"_

**Round Finalized but NOT published:**
- Card shows: _"TALLYING IN PROGRESS — Round [N]"_ (same as tallying — chair
  hasn't approved yet, audience doesn't know results exist)

**Round Finalized + Published** (`published_at IS NOT NULL`):
- Card shows results: candidate name, vote count, percentage bar
- Candidate outcome badges (eliminated, advance, winner, etc.)
- Status: _"Round [N] Results"_
- If another round follows: _"Round [N+1] Pending"_
- If race is complete: _"Race Complete"_

**Layout rules:**
- Full-screen dark background, high contrast, large fonts
- Auto-resize card grid as more races become active (CSS grid, 1–4 columns
  depending on race count)
- All updates via WebSocket — no page refresh
- No QR code or interactive elements on TV display

### Mobile Dashboard (`/public/:electionId`)

**Structure:**
- Election Event name header
- SN search bar at top (always visible) — instant as-you-type filtering
- "Browse All Ballots" link → organized by Race → Round, paginated 50 per page
- List of races as collapsible cards (collapsed by default)
- Expand a race → shows rounds as a dropdown list
- Select a round → shows results if published, status if not
- Published results include candidate outcome badges

**SN Search:**
- Instant feedback as user types — start filtering after 4+ characters
- Matching SNs shown as tappable links directly to ballot image
- Found in a published round → show scanned ballot front image, SN, race,
  round, and how it was counted (candidate name)
- Not found or not published → _"Ballot not found or results not yet
  released"_

**Browse All Ballots:**
- Organized as: Race → Round (expandable sections)
- Only shows SNs from published rounds
- Paginated: 50 SNs per page with next/previous navigation
- Each SN is a tappable link to the ballot image

**Mobile card states** — match TV states but compact:
- Use colored status pills instead of large banners
- _"Awaiting Vote"_ for `pending_needs_action` and `ready` (never show setup status)
- Results as a simple list with percentages and candidate outcome badges

### Both Modes

- Bundle all assets — no external CDNs (LAN-only)
- WebSocket connection with auto-reconnect
- Graceful handling of connection loss: _"Reconnecting..."_

---

## Terminology Reference

> **Note:** The user-facing term is "Election Event". Internal code, database
> tables, and API paths use "election" for brevity. All UI labels should use
> "Election Event".

| Term | Definition |
|------|-----------|
| Election Event | Top-level event (e.g. "2026 State Convention"). Code uses `election`. |
| Race | A contest within an election event (e.g. "Chair") |
| Round | One counting cycle within a race. Paper color designates the round. |
| Pass | One complete scan of all ballots. Min 2 required. |
| SN | Serial Number — 8+ char unique ID on each ballot |
| Reviewed Ballot | A ballot needing human review (auto-flagged by OMR or manually reported) |
| Remade Ballot | A reviewed ballot where intent was clear — replaced and counted |
| Spoiled Ballot | A reviewed ballot where intent could not be determined — not counted |
| Confirmation | A human judgment by an admin — never automated software logic |
| Published | Results approved by chair in Control Center — the single gate for public visibility |

## Role Reference

| Role | Access |
|------|--------|
| `super_admin` | Full access — all races, all elections, Control Center |
| `race_admin` | Full access within assigned races only (including scanning) |
| Public Viewer | Read-only dashboard, SN search, no login |

## Status Reference

### Race Status Flow
```
pending_needs_action → ready → in_progress → results_finalized
```

### Round Status Flow
```
pending_needs_action → ready → voting_open → voting_closed → tallying → round_finalized
                                                                      ↘ canceled
```
