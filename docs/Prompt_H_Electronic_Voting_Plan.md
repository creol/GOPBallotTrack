# Prompt H: Electronic Voting with Pre-Printed QR Token Stickers — Staged Implementation Plan

## Overview

Add electronic voting (remote and in-person) using pre-printed QR code stickers as the credential. Internet-accessible (AWS-hosted). Anonymous voting with voter-held screenshot confirmation codes for self-verification. Core paper ballot scanning workflow must not change.

## Architecture summary

- QR stickers generated per Election Event in bulk before the event (each encodes URL + unique 6-char token)
- Tokens inert until a credentialer scans them on the Voter Activation page
- Voter type (in-person vs remote) set at activation time
- One token per voter per event, valid across all races/rounds in that event
- Same voter URL serves all states (waiting, voting, submitted) based on current event state
- Electronic races have NO ballot generation, NO scanning, NO physical tally
- Anonymity preserved by three-table separation: voter_tokens, voter_race_participation, votes — never joined

## Implementation order

The work is broken into 7 stages (H1–H7). Apply them in order, testing between each. Each stage is designed to be a self-contained Claude Code session.

- **H1**: Database schema and migrations
- **H2**: QR sticker generator
- **H3**: Voter activation and credentialing controls
- **H4**: Voter-facing voting flow
- **H5**: Live dashboard for electronic voting
- **H6**: Confirm Results, finalize, and verification
- **H7**: Admin auth, audit logging, and security hardening

Each stage references the goal, prerequisites, deliverables, and testing requirements.

---

## H1: Database Schema and Migrations

### Goal
Establish the database foundation for electronic voting. No UI changes in this stage — purely schema work that enables everything that follows.

### Prerequisites
- Existing migrations 001–005 applied
- Existing races, candidates, rounds tables present
- All current data is test data; migrations may wipe and reseed freely

### Deliverables

**Migration 006** — Core electronic voting tables:
- `voter_tokens` table: id, event_id, token_hash, status ('unactivated' | 'activated' | 'revoked'), voter_type ('in_person' | 'remote' | null), activated_at, activated_by (admin username), created_at
- `voter_race_participation` table: id, token_id, race_id, created_at; unique constraint on (token_id, race_id)
- `sticker_batches` table: id, event_id, batch_name, count, size_preset, generated_at, generated_by, notes
- `remote_serial_pool` table: id, race_id, serial, position_in_shuffle, status ('available' | 'used'), used_at
- Add `voting_mode` column to races: 'paper' (default) | 'electronic'
- Add `voter_pool_locked_at`, `voter_pool_size` columns to races

**Migration 007** — Audit and lifecycle:
- `replacement_token_log` table: id, event_id, old_token_id (nullable), new_token_id, reason, authorized_by, created_at
- Add `reveal_authorized_at`, `reveal_authorized_by` columns to races
- Add `credentialing_open` column to events: boolean, default false

**Migration 008** — Admin and forward-compatibility:
- `admin_users` table: id, username, password_hash (argon2), email, role, session_timeout_minutes (default 30), created_at, last_login_at
- `admin_audit_log` table: id, admin_user_id, action, target_type, target_id, details_json, ip_address, created_at — append-only, no UPDATE/DELETE permission for app role
- `voter_race_eligibility` table: id, token_id, race_id, eligible (boolean) — schema only, not yet used by code (future per-race eligibility feature)

### Code requirements

- Eligibility check function `isVoterEligibleForRace(tokenId, raceId)`:
  - If `voter_race_eligibility` has any row for raceId, return based on that row
  - Otherwise return true (default permissive)
  - Function exists from day one so future feature drop-in does not require refactoring
- Database role for vote-recording path: SELECT on voter_tokens (id, status, event_id only), INSERT on votes, INSERT on voter_race_participation, INSERT/UPDATE on remote_serial_pool; NO SELECT on votes from this role
- Document the anonymity boundary in a comment block at the top of each table definition

### Testing
- All migrations run cleanly from empty DB
- All migrations idempotent (re-running on existing DB should not fail)
- Verify foreign key constraints enforce expected relationships
- Verify unique constraint on (token_id, race_id) prevents double participation
- Verify admin_audit_log append-only behavior under app role

### Out of scope for H1
- Any UI work
- Any API endpoints
- Token generation logic (deferred to H2)

---

## H2: QR Sticker Generator

### Goal
Allow admins to generate batches of QR code stickers for an election event. Output is a print-ready PDF at standard label sizes.

### Prerequisites
- H1 complete (voter_tokens and sticker_batches tables exist)

### Deliverables

**New admin page**: "QR Token Sticker Generator" within Election Event admin

**Inputs**:
- Number of stickers to generate (default: expected attendance, configurable)
- Sticker size preset dropdown:
  - 1" × 1"
  - 1.5" × 1.5"
  - 2" × 2"
  - Avery 8460 (1" × 2-5/8")
  - Avery 5160 (1" × 2-5/8")
  - Avery 5163 (2" × 4")
  - Custom (width and height in inches)
- Page size: Letter (default) or A4
- QR error correction level: M (default, recommended for handheld scanners) or H (recommended for damaged stickers)
- Batch name (optional, for organization)
- Notes field (optional)

**Token generation**:
- 6-character tokens, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars, no confusing characters)
- Use `crypto.randomBytes` for cryptographic randomness
- Store as token_hash (argon2 or bcrypt) in voter_tokens with status='unactivated'
- Verify uniqueness within event before insert; regenerate on collision

**PDF output**:
- Each sticker contains:
  - QR code encoding `https://vote.<domain>/<event_code>/?t=<token>`
  - 6-char token printed below QR in human-readable monospace font (for credentialer reference)
  - Small "<event_name>" label
- QR optimized for both phone cameras and handheld 2D scanners (adequate quiet zone, dense enough modules for fast scan)
- Stickers laid out in grid matching the chosen label size
- Use PDFKit (already in stack)

**Batch management**:
- "Add to existing batch" option — generate additional stickers for an event after initial generation
- List of existing batches shown on the generator page (batch name, count, generated date, generated by)
- Cannot delete a generated batch (stickers may already be in physical circulation)

### Code requirements
- All sticker generation logged to admin_audit_log
- PDF generation must handle large batches (5,000+ stickers) without memory issues — stream output if possible
- File served as download with descriptive filename: `<event_name>_stickers_<batch_name>_<count>.pdf`

### Testing
- Generate 100 stickers at each size preset, verify PDF renders correctly
- Generate 5,000 stickers in a single batch, verify performance and memory
- Print sample sheet on actual Avery labels, verify alignment
- Scan generated QR codes with iPhone camera, Android camera, and handheld 2D scanner — all must scan within 1 second
- Verify URL encoded in QR is correct and includes the right event_code
- Verify unique tokens across batches in same event
- Add additional batch to existing event, verify no token collisions

---

## H3: Voter Activation and Credentialing Controls

### Goal
Provide the credentialing flow that activates QR sticker tokens, and the controls for opening/closing credentialing throughout the event.

### Prerequisites
- H1 and H2 complete

### Deliverables

**Voter Activation page** at `/credentialing/activate`:
- Admin-authenticated
- Persistent toggle at top: "In-Person Attendee" / "Remote Attendee"
  - Defaults to last-used setting for this credentialer session
  - Visually prominent so credentialer does not forget to switch when flow changes
- Single input field with autofocus (accepts QR scan or manual entry)
- On submit:
  - Validate token exists, is unactivated, belongs to current event
  - Mark status='activated', record activated_at, activated_by, voter_type from toggle
- Confirmation view:
  - "<token> activated" — token displayed large and readable
  - Full voting URL displayed below
  - **Single "Copy" button** copies both lines to clipboard:
    ```
    https://vote.<domain>/<event_code>/?t=<token>
    <token>
    ```
  - "Next Voter" button clears the screen and returns to scan-ready state
- Between voters: input field clears, nothing persists in browser
- Block activation during open vote with message: "Cannot credential while a vote is open. Close the vote first."

**Credentialing window controls** (in Event admin):
- "Open Credentialing" / "Close Credentialing" toggle
- Cannot open credentialing during open vote (blocked with message)
- Cannot open a vote while credentialing is open (must close credentialing first)
- Already-activated tokens remain valid across close/reopen cycles
- State changes logged to admin_audit_log

**Replacement Token flow**:
- Chair-only page accessible from Event admin
- Form inputs:
  - Original token (optional — if voter knows it, mark it revoked)
  - Reason field (required, free text)
  - Confirmation checkbox: "The body has authorized this replacement"
- Submit:
  - Activate a new unactivated token (from the existing batch pool)
  - Mark original as revoked if provided
  - Insert row into replacement_token_log
  - Display the new token to the chair (same Copy button as normal activation)
- No hard limit on count; just log everything

**Activation status view** (in Event admin):
- Real-time count display:
  - Total tokens generated
  - Activated (in-person)
  - Activated (remote)
  - Revoked
  - Available (unactivated)
- Sortable list of recent activations (token redacted to last 2 chars, activated_at, voter_type, activated_by)

### Code requirements
- All activation events logged to admin_audit_log with activated_by, voter_type
- Constant-time token comparison during validation
- Rate limit on activation endpoint: 30 per minute per credentialer (prevent runaway scanner)

### Testing
- Scan QR via handheld scanner with In-Person toggle, verify activation and voter_type='in_person'
- Manually type token with Remote toggle, verify activation and voter_type='remote'
- Toggle state persists across activations until credentialer changes it
- Activate while vote is open → blocked
- Open credentialing during vote → blocked
- Reopen credentialing between rounds → existing tokens still valid
- Replacement token flow: original is revoked, new is activated, log entry created
- Two credentialers activating simultaneously → no conflicts, no double-activations
- Copy button copies both lines correctly on Chrome, Safari, Firefox

---

## H4: Voter-Facing Voting Flow

### Goal
Implement the entire voter experience: entering the URL, casting a vote, receiving a confirmation code, and the "shared device" variant.

### Prerequisites
- H1, H2, H3 complete

### Deliverables

**Voter entry URL** at `https://vote.<domain>/<event_code>/?t=<token>`:
- Validate token: exists, activated, not revoked, belongs to this event
- Strip token from URL with `history.replaceState()` immediately after validation
- Set response headers: `Cache-Control: no-store, no-cache, must-revalidate`
- No service worker registered on any voting pages
- Token stored only in sessionStorage (cleared on tab close), never localStorage
- WebSocket connection established for real-time state updates

**Manual entry page** at `https://vote.<domain>/<event_code>/` (no token):
- Single input field with anti-autofill measures:
  - `autocomplete="one-time-code"` AND `autocomplete="off"`
  - Randomized field `name` attribute per page load (e.g., `name="vt_x7k2p"`)
  - `inputmode="text"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`
- After submit and validation: same flow as URL-based entry (token in sessionStorage, never in URL)

**Shared device page** at `https://vote.<domain>/shared/<event_code>`:
- Banner at top: "This is a shared device. Your session will be cleared when you finish."
- Forces manual token entry (any URL token param is ignored and stripped)
- All anti-autofill measures active
- After vote completion: explicit clear of sessionStorage, localStorage, all form values
- Auto-redirects after a delay back to fresh entry page for next user

**Voter app state machine** (single URL, WebSocket-driven):
- No race open → "Waiting for the next race to open" screen
- Race open, voter has not voted in it → ballot for current race
- Race open, voter already voted → "Vote recorded — waiting for next race" with their confirmation code
- Event ended → "Event concluded — thank you for participating"
- All transitions driven by WebSocket events with re-fetch on reconnect

**Ballot UI**:
- Display race name, round number prominently
- All candidates listed with selection control (radio for single-choice, future-proofed for multi-choice)
- "Review your vote" button at bottom

**Review page**:
- Display selected candidate name large and clear
- Display race name and round
- Warning text: "Confirming is final. This cannot be undone."
- "Confirm" button (large, primary) and "Change" button (secondary)

**Vote submission endpoint**:
- Inputs: token, race_id, choice_id
- Validations:
  - Token activated and not revoked
  - Token belongs to event
  - Race is currently open
  - Voter eligibility check passes (use `isVoterEligibleForRace` from H1)
  - No existing voter_race_participation for (token_id, race_id)
- Atomic operation (single transaction with row-level locking):
  - Pop next available serial from remote_serial_pool for race
  - Generate 5-char confirmation code (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`)
  - Verify confirmation code unique within event; regenerate on collision
  - Insert vote: serial, race_id, choice_id, confirmation_code (NO submission timestamp on the public record)
  - Insert voter_race_participation: token_id, race_id
  - Server-side audit log records arrival time separately for reconciliation (not on the vote record)
- Idempotent: if voter_race_participation already exists for (token_id, race_id), return the existing confirmation code instead of creating a new vote
- Response: confirmation code + candidate name + race name
- Redirect to `/submitted` (token NOT in URL)

**Submitted page**:
- Large, clear display:
  - Confirmation code (very prominent, monospace, large font)
  - Candidate voted for
  - Race name and round number
- Instructions block:
  - "TAKE A SCREENSHOT NOW. The screenshot must include both your vote AND your confirmation code."
  - "Without this screenshot, you cannot verify your vote later."
  - "This page cannot be accessed again."
- Platform-specific screenshot instructions in collapsible sections:
  - Windows: Win + Shift + S, or Print Screen
  - Mac: Cmd + Shift + 4, or Cmd + Shift + 3
  - iOS: Side button + Volume Up (Face ID) or Home + Side button (Touch ID)
  - Android: Power + Volume Down (varies by manufacturer — note this)
- Large "I'm done — close this page" button:
  - Clears sessionStorage and localStorage
  - Attempts `window.close()`
  - Falls back to redirect to a "You may now close this tab" page
- Footer text: "Vote received — your vote will appear on the public dashboard shortly. Votes are displayed in randomized batches to protect anonymity."

### Code requirements
- All voting endpoints rate-limited:
  - Token validation: 5 attempts per IP per minute
  - Vote submission: enforced single submission per (token_id, race_id) by DB constraint
- Constant-time token comparison
- WebSocket auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 16s)
- On reconnect: re-fetch full state, do not assume cached UI is current
- Vote submission must work even if WebSocket is disconnected (fall back to HTTP submit)

### Testing
- Visit URL with token → ballot loads, token stripped from URL
- Visit URL without token → manual entry page, no autofill on subsequent visits
- Visit shared device URL with token in params → token stripped, manual entry forced
- Vote submission returns confirmation code, matches DB record
- Re-submit same token+race → returns existing confirmation code, no double-count
- 500 simultaneous submissions → all unique serials, all unique confirmation codes, no errors
- WebSocket disconnect mid-vote → UI shows reconnecting, vote submission still works via HTTP
- All four platform screenshot instructions render correctly
- Done button clears storage, attempts close, falls back gracefully
- No service worker registered, no caching of voting pages

---

## H5: Live Dashboard for Electronic Voting

### Goal
Real-time dashboard showing voting progress during an electronic race, with anonymization safeguards.

### Prerequisites
- H1–H4 complete

### Deliverables

**Race-opening flow**:
- Chair clicks "Open Voting" on a draft electronic round
- System verifies credentialing is closed
- System locks voter pool: snapshot count of activated tokens → races.voter_pool_size
- Generate shuffled serial pool: N serials, randomly shuffled, inserted into remote_serial_pool with position_in_shuffle
- Dashboard transitions to "voting in progress" state

**Live dashboard view**:
- Header:
  - "Credentialed: N" (locked voter pool size)
  - "Recorded: X (Y%)" — actual count of submitted votes (always accurate, updates immediately)
  - "Displayed: Z" — count visible on dashboard (lags Recorded due to anonymization delay)
- Persistent footer text (small but readable): "Votes are displayed in randomized batches to protect voter anonymity. Recorded count is always accurate; displayed count catches up within a few seconds."
- Main grid of small rounded squares (~80×40px each):
  - Empty state: gray background, translucent, no content
  - Filled state: confirmation code centered, colored background
  - **Green solid border** for in-person voters
  - **Yellow dashed border** for remote voters
- Target density: 200+ squares visible without scrolling on 1080p; layout reflows for larger pool sizes
- Voter search input prominently placed: voter types confirmation code, their square highlights with a flashing border for several seconds
- No timestamp shown for individual votes
- No vote choice revealed during active voting (codes only, candidates remain anonymous as A/B/C/etc.)

**Anonymization batch posting**:
- Votes received in real-time on server (recorded immediately, counted in Recorded)
- A posting worker runs every 5–10 seconds (interval randomized within that range)
- Each tick: take all unposted votes from buffer, shuffle order, assign random grid positions among the still-empty squares, push to dashboard via WebSocket
- Voter type metadata travels with the post (drives green/yellow display)

**WebSocket resilience**:
- On disconnect: display "DISCONNECTED — RECONNECTING" banner prominently (audience can see it)
- Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 16s)
- On reconnect: re-fetch full state, do not assume cached UI is current
- If reconnection fails for 30 seconds: show error banner and fire admin alert (email/Slack via configured channel)

**Closing the vote**:
- Chair clicks "Close Voting"
- New submissions rejected immediately (HTTP 410 Gone with message: "Voting is closed.")
- Posting buffer flushed: wait up to 10 seconds for all received votes to appear on dashboard
- Reconciliation check: votes_in_db == squares_filled == serials_used (popped from pool)
- If mismatch: block close, show reconciliation screen with details (counts, missing serials, etc.)
- If matched: dashboard shows "Voting closed" banner overlay
- Prompt to chair: "Reopen credentialing now?" with options Yes / No / Later
- Navigate to Confirm Results page (deferred to H6)

### Code requirements
- Dashboard assets bundled locally (no external CDN) — consistent with existing constraint
- WebSocket channel scoped to event_id + race_id
- Audit log records: race opened, race closed, reconciliation result

### Testing
- Open electronic race, verify voter pool locked correctly
- Submit votes, verify Recorded count increments immediately, Displayed lags by 5–10 sec
- Verify random grid positioning (votes don't fill sequentially)
- Verify green/yellow distinction with dashed/solid borders
- Test with 200 voters → grid renders cleanly on 1080p
- Test with 4,000 voters → grid reflows, scrolling may be required, layout still readable
- Voter search highlights correct square
- Disconnect WebSocket mid-vote → banner shown, reconnect re-syncs state
- Close vote with artificial reconciliation mismatch → close blocked, details shown
- Close vote cleanly → buffer flushes, banner appears, prompt for credentialing

---

## H6: Confirm Results, Finalize, and Voter Verification

### Goal
The post-vote flow: chair confirms results, manages candidate status, finalizes round or race, publishes to dashboard, and provides the voter verification page.

### Prerequisites
- H1–H5 complete

### Deliverables

**Confirm Results page (electronic variant)**:
- Triggered after vote closes successfully
- Shows per-candidate:
  - Candidate name
  - Vote count
  - Percentage
  - Status selector dropdown: Advance / Eliminated / Withdrew / Convention Winner / Winner / Advance to Primary
- All decisions are manual; system makes no automatic determinations
- Two action buttons at bottom:
  - "Finalize Round and Move to Next Round" — clones round with Advance-only candidates, creates next round in draft state, returns to round setup
  - "Finalize Race" — locks the race, no more rounds, marks complete
- Both actions are irreversible; require explicit confirmation step ("Are you sure?" with summary of what will happen)

**Round cloning logic**:
- New round inherits race_id, increments round_number
- Candidate list cloned from previous round, filtered to status=Advance only
- Vote counts and serial pool NOT cloned (fresh for new round)
- New round starts in 'draft' state, ready to be opened

**Publish to Dashboard (electronic variant)**:
- After finalize: navigate to "Publish to Dashboard" page
- Dashboard Preview shows what audience will see
- No Scanning card, no advanced scanning options (electronic-specific simplified view)
- Publish button → public dashboard updates:
  - Results shown with candidate names (codes-to-candidates revealed)
  - Vote counts and percentages displayed
  - Per-candidate status badges (Advance, Winner, etc.)
- Public dashboard includes a QR code linking to the Voter Verification page

**Voter Verification page** at `https://vote.<domain>/<event_code>/verify`:
- Public, no authentication required
- Single input: confirmation code
- On submit:
  - Look up vote by confirmation_code within event
  - Display: race name, round number, candidate voted for, the confirmation code
- Voter compares against their screenshot
- Page never asks for or accepts a token
- Rate-limited: 10 lookups per IP per minute
- No autofill on the input field

**Dashboard updates during round transitions**:
- Between rounds: dashboard shows "Round N concluded — Round N+1 setup in progress"
- When new round opens: dashboard transitions to live voting view
- Previous rounds' results remain visible (scrollable history section)

### Code requirements
- Finalize actions logged to admin_audit_log with admin user, race_id, round_id, action type, candidate statuses
- Reveal action (publish to dashboard) logged separately
- Verification page logs lookups (anonymously — just IP, timestamp, success/fail) for rate limiting and abuse detection

### Testing
- Confirm Results page shows correct counts and percentages
- All six status options selectable
- Finalize Round → next round created with only Advance candidates
- Finalize Race → race locked, no further rounds possible
- Confirmation step required for both buttons
- Publish to Dashboard shows results with candidate names
- Voter Verification: enter valid code → correct vote shown
- Voter Verification: enter invalid code → "Not found" message, no info leak
- Rate limit triggers after 10 lookups
- Multi-round race: round 1 finalize → round 2 setup → round 2 open → round 2 finalize → race finalize
- All admin actions appear in audit log

---

## H7: Admin Auth, Audit Logging, and Security Hardening

### Goal
Lock down the admin interface with real authentication, ensure audit completeness, and apply security baseline.

### Prerequisites
- H1–H6 complete

### Deliverables

**Admin authentication**:
- Login page with username + password
- Passwords hashed with argon2 (not bcrypt)
- Session-based auth (HTTP-only cookie, secure flag, SameSite=Lax)
- Session timeout: 30 min idle (configurable per admin user)
- Logout button always visible in admin nav
- Failed login attempts rate-limited: 5 per IP per 15 min, lockout escalates with failures

**Admin user management**:
- Bootstrap admin created at install time (env var or CLI command)
- Admin user CRUD (create, list, deactivate — no hard delete)
- Roles: 'chair', 'credentialer', 'admin' (chair has all permissions including reveal/finalize; credentialer can activate tokens; admin can configure events)
- Role-based route protection across the app

**Audit logging**:
- All admin actions logged to admin_audit_log:
  - Login, logout, failed login
  - Event create/edit
  - Sticker batch generation
  - Credentialing open/close
  - Token activation, replacement
  - Vote open/close, reconciliation result
  - Round finalize, race finalize, publish to dashboard
  - Admin user CRUD
- Log includes: admin_user_id, action, target_type, target_id, details_json, ip_address, timestamp
- admin_audit_log table is append-only via DB role permissions

**Anonymity boundary enforcement**:
- Static analysis or test that fails the build if any query joins voter_tokens with votes
- Code review checklist item for new endpoints touching either table
- Document the boundary in CLAUDE.md and in code comments at table definitions

**Backup automation**:
- Auto-backup every 15 min during active voting
- Manual backup button in admin
- Backup contents:
  - All voter_tokens (token_hash, status, activated_at, voter_type, activated_by)
  - All voter_race_participation
  - All votes (serial, race_id, choice_id, confirmation_code)
  - All admin_audit_log entries
  - Sticker batch metadata (NOT the QR PDFs)
- Backup encrypted with AWS KMS key
- Backup format: JSON, structured to maintain anonymity separation (voter_tokens and votes in separate sections)
- Retention: 30 days minimum post-event
- Backup destination: S3 with versioning enabled

**Security baseline**:
- HTTPS only enforced at infrastructure layer (CloudFront / ALB)
- Constant-time token comparison everywhere
- Cryptographically secure random for all tokens, confirmation codes, serials, session IDs (`crypto.randomBytes`)
- DB encrypted at rest (RDS default) and in transit (TLS)
- Post-event auto-snapshot, marked read-only
- Rate limiting at application layer:
  - Token validation: 5 per IP per minute
  - Vote submission: enforced by DB unique constraint
  - Verification page: 10 per IP per minute
  - Admin login: 5 per IP per 15 min
- Geo-restrict to US at infrastructure layer (AWS WAF or CloudFront geo-restriction)
- WAF rules: SQL injection, XSS, common attack patterns

### Code requirements
- Authentication middleware applied to all admin routes
- Role check middleware for role-specific routes
- Audit log writes are non-blocking (don't fail a vote submission if audit log write fails — log the failure separately)
- All sensitive operations wrap in try/catch with audit log entry on both success and failure

### Testing
- Login with valid credentials → session created
- Login with invalid credentials → rate limit triggers after 5 attempts
- Session timeout: idle for 30 min → forced re-login
- Logout clears session
- Each role can access only their permitted routes (verify with role-mismatch user)
- Build fails if a join between voter_tokens and votes is introduced
- Backup auto-runs every 15 min during voting, file appears in S3
- Manual backup produces same format as auto-backup
- Backup file is encrypted (cannot be read without KMS key)
- Geo-restriction blocks non-US IPs (test with VPN)
- Rate limits enforce on all relevant endpoints

---

## Roadmap items deferred (not in H1–H7)

- **Per-race voter eligibility UI** — schema in place from H1, application code references the check function from day one, but UI to assign per-race eligibility is future work
- **2FA for admin login** — TOTP-based, can be added on top of H7's password auth
- **Two-person approval for sensitive actions** (open/close vote, finalize, reveal)
- **Zoom API integration** for pulling participant lists (manual copy-paste is sufficient for v1)
- **Native mobile app**
- **Multi-language support**
- **Automatic candidate elimination thresholds**

---

## Cross-cutting principles to maintain throughout H1–H7

- **Anonymity is non-negotiable**: voter_tokens and votes are never joined; three-table separation enforced by code and DB role permissions
- **Honest dashboard wording**: never imply we're modifying votes; explain the anonymization delay openly
- **Audit everything**: every admin action and every state change logged with sufficient detail to reconstruct the event afterward
- **Forward compatibility**: per-race eligibility schema is in place from H1 even though unused; voter_race_eligibility check function exists from day one
- **Test between stages**: each H-stage is independently testable; don't move to the next stage until the current one passes its checklist
- **Paper ballot workflow untouched**: nothing in H1–H7 should change behavior for `voting_mode='paper'` races
