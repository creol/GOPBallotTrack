# BallotTrack — Project Context

## What This Is
BallotTrack is a self-hosted election management and ballot scanning system for political conventions. It runs entirely on a local LAN via closed WiFi with no internet dependency, hosted on a laptop using Docker.

## Tech Stack
- Backend: Node.js + Express + WebSockets (Socket.IO)
- Frontend: React (Vite)
- Database: PostgreSQL
- PDF Generation: PDFKit
- QR Codes: qrcode (generation) + jsQR or html5-qrcode (scanning)
- Deployment: Docker Compose — 2 containers (app + postgres) + persistent volume for uploads/images

## Project Structure
```
ballottrack/
├── docker-compose.yml
├── client/              # React frontend (Vite)
│   ├── src/
│   │   ├── pages/       # Route-level pages
│   │   ├── components/  # Shared UI components
│   │   └── api/         # API client helpers
│   └── package.json
├── server/              # Express backend
│   ├── src/
│   │   ├── routes/      # Express route handlers
│   │   ├── models/      # Database queries (raw SQL or Knex)
│   │   ├── services/    # Business logic
│   │   ├── ws/          # WebSocket event handlers
│   │   └── pdf/         # PDF generation (ballots + results)
│   ├── migrations/      # Database migrations
│   └── package.json
├── uploads/             # Persistent volume: ballot images, exports
└── CLAUDE.md            # This file
```

## Key Terminology
- **Election**: Top-level event (e.g., "2026 State Convention")
- **Race**: A contest within an election (e.g., "Chair")
- **Round**: One counting cycle within a race. Paper color designates the round.
- **Pass**: One complete scan of all ballots. Pass 1 & 2 required. Additional optional.
- **SN**: Serial Number — 8+ character unique ID on each ballot, printed below the QR code
- **Reviewed Ballot**: A ballot flagged for review — auto-flagged by OMR (no mark, overvote, uncertain, QR not found) or manually reported. Outcomes: counted, remade, spoiled, rejected.
- **Remade Ballot**: A reviewed ballot where intent was clear — original marked damaged, replacement SN assigned and counted.
- **Spoiled Ballot**: A reviewed ballot where intent could not be determined — not counted.
- **Confirmation**: A human question asked of the admin — NOT an automated software decision.

## Roles
- **Admin**: Manages elections, ballot generation, QR toggle on TV display, backups/exports
- **Election Judge**: Confirms rounds, overrides mismatches (notes required), final say on disputes. Cannot release results.
- **Chair**: All Judge permissions + sole authority to preview and release each round's results to the public
- **Tally Operator**: Scans ballots, manual SN entry for spoiled ballots
- **Public Viewer**: View-only dashboard (TV or mobile), SN search, click SN to see ballot image. No login.

## Key Rules
- Confirmation is always a human question for the Election Judge, not software logic
- Chair must preview the public dashboard before approving release of each round
- Results are released round-by-round, not all at once
- "Withdrawn" is software-only — never printed on ballots
- Ballot color = round color (paper color), nothing printed about color
- Both sides of ballots are scanned even though nothing is printed on the back
- The printable ballot PDF is separate from the ZIP (printer only gets the PDF)
- Unlimited ballot boxes, unlimited optional passes
- 5 decimal places on percentages
- No cut lines printed on ballots
```

---

## Phase 1: Project Setup + Database Schema

```
Phase 1: Set up the project structure and database.

1. Initialize the project:
   - Create a docker-compose.yml with two services: "app" (Node.js) and "db" (PostgreSQL 16)
   - Add a persistent volume mapped to ./uploads for ballot images and exports
   - The app service should expose port 3000 (backend) and 5173 (vite dev)
   - Set up the server/ folder with Express, and client/ folder with React via Vite
   - Add package.json files for both with these dependencies:
     Server: express, pg, socket.io, pdfkit, qrcode, multer, cors, dotenv, uuid
     Client: react, react-router-dom, socket.io-client, html5-qrcode, axios

2. Create the PostgreSQL schema with these tables:

   elections (id, name, date, description, status [active/archived/deleted], is_sample boolean, created_at, updated_at)

   races (id, election_id FK, name, threshold_type [majority/two_thirds/custom], threshold_value, display_order, status [pending_needs_action/ready/in_progress/results_finalized], created_at)

   candidates (id, race_id FK, name, display_order, status [active/withdrawn], withdrawn_at, created_at)

   rounds (id, race_id FK, round_number, paper_color, status [pending_needs_action/ready/voting_open/voting_closed/tallying/round_finalized/canceled], published_at, confirmed_by, confirmed_at, released_by, released_at, created_at)

   ballot_serials (id, round_id FK, serial_number VARCHAR(64) UNIQUE, status [unused/counted/spoiled], created_at)
   — serial_number has 8 char minimum enforced by CHECK constraint

   ballot_boxes (id, election_id FK, name, created_at)

   passes (id, round_id FK, pass_number, status [active/complete/deleted], deleted_reason, created_at, completed_at)

   scans (id, pass_id FK, ballot_serial_id FK, candidate_id FK, ballot_box_id FK, scanned_by, scanned_at, front_image_path, back_image_path)

   reviewed_ballots (id, round_id FK, pass_id FK, original_serial_id FK, replacement_serial_id FK, scanner_id FK, outcome [remade/spoiled/counted/rejected], flag_reason, omr_scores JSONB, notes TEXT, photo_path, image_path, reviewed_by, reviewed_at, created_at)

   round_confirmations (id, round_id FK, confirmed_by_role [judge/chair], confirmed_by_name, is_override BOOLEAN, override_notes TEXT, created_at)

   round_results (id, round_id FK, candidate_id FK, vote_count INTEGER, percentage DECIMAL(10,5), created_at)

3. Create a seed script that inserts one sample election with:
   - 2 races ("Chair", "Vice Chair")
   - 3 candidates per race
   - Mark it as is_sample = true

4. Create a migration runner that applies the schema on startup.

5. Add a .env.example with DATABASE_URL, PORT, and NODE_ENV.

After completing, verify: docker-compose up should start both containers, the database should have all tables, and the sample election should be seeded.
```

---

## Phase 2: Election & Race Management (Admin API + UI)

```
Phase 2: Build the admin API and UI for managing elections, races, candidates, and rounds.

API Routes (all under /api/admin):

POST   /elections              — Create election (name, date, description)
GET    /elections              — List all elections (filter out deleted, show archived separately)
GET    /elections/:id          — Get election with races
PUT    /elections/:id          — Update election
PUT    /elections/:id/archive  — Archive election
DELETE /elections/:id          — Delete election (sample only, or require confirmation for real)

POST   /elections/:id/races          — Create race (name, threshold_type, threshold_value)
GET    /elections/:id/races          — List races for election
PUT    /races/:id                    — Update race (name, reorder candidates, threshold)
PUT    /races/:id/candidates/reorder — Reorder candidates (array of candidate IDs)

POST   /races/:id/candidates    — Add candidate
PUT    /candidates/:id           — Update candidate
PUT    /candidates/:id/withdraw  — Mark as withdrawn (software-only, sets status + timestamp)

POST   /races/:id/rounds        — Create round (paper_color required)
GET    /rounds/:id               — Get round detail with passes and results

POST   /elections/:id/ballot-boxes — Create ballot box (name)
GET    /elections/:id/ballot-boxes — List ballot boxes
DELETE /ballot-boxes/:id           — Delete ballot box

Admin UI Pages (React):

1. /admin — Election list dashboard
   - Shows active elections as cards
   - "Archived" section collapsed by default
   - "Create Election" button
   - Sample election shows archive/delete options

2. /admin/elections/:id — Election detail
   - Election name, date, description (editable)
   - List of races with status badges
   - "Add Race" button
   - Ballot box management section (add/remove, unlimited)

3. /admin/elections/:id/races/:raceId — Race detail
   - Candidate list with drag-to-reorder
   - "Withdrawn" badge shown on withdrawn candidates (software only)
   - Button to withdraw a candidate
   - List of rounds with status
   - "Create Round" button (requires selecting a paper color)
   - Threshold configuration

Keep the UI clean and functional — no fancy styling yet, just working forms and lists. Use React Router for navigation.
```

---

## Phase 3: Ballot Generator (PDF + QR)

```
Phase 3: Build the ballot PDF generator with QR codes.

Create a service at server/src/pdf/ballotGenerator.js that:

1. Accepts: round_id, ballot_size, optional logo_path
2. Fetches: election name, race name, round number, candidate list (active only, not withdrawn), and generates serial numbers

3. Serial Number Generation:
   - Generate unique 8+ character alphanumeric SNs (uppercase, no ambiguous chars like 0/O, 1/I/L)
   - Store each SN in ballot_serials table with status "unused"
   - Quantity based on admin input

4. QR Code:
   - Try encoding BOTH the SN and positional data (round_id, race_id) in a single QR code as a JSON string
   - If the resulting QR is too dense for reliable scanning at the ballot size, split into two QR codes
   - Print the SN in human-readable text directly below the QR code

5. Ballot Layout (PDFKit):
   Header zone: Election Name, Race, Round (all required). Logo if provided. Black ink default.
   Body: Candidate names with fill-in ovals, listed in display_order. No "Withdrawn" label.
   Footer:
     - "Do NOT bend. Completely fill the oval of your vote."
     - "You are encouraged to take a photo of your completed ballot before submitting for your validation."
     - Visual examples: one filled oval (good), and 2-3 bad examples (partial fill, check mark, X)
   QR + SN: Positioned so it doesn't interfere with the candidate area. SN printed below QR.

6. Ballot Sizes:
   - Letter: 8.5" x 11"
   - Half Letter: 5.5" x 8.5"
   - Quarter Letter: 4.25" x 5.5"
   - 1/8 Letter: 2.75" x 4.25"
   All sizes one ballot per page. No cut lines.

7. Back side: Blank. Nothing printed.

8. Preview: Always render right-side up, correct orientation.

9. Output:
   - Printable PDF saved as a standalone file (NOT inside a ZIP). This goes to the printer.
   - ZIP file saved separately containing: JSON with all SNs + metadata. No PDF in the ZIP.
   - Both saved to uploads/elections/{election_id}/rounds/{round_id}/

API Routes:
POST /api/admin/rounds/:id/generate-ballots — Generate ballots (quantity, size, logo optional)
GET  /api/admin/rounds/:id/ballot-pdf        — Download the printable PDF
GET  /api/admin/rounds/:id/ballot-data        — Download the ZIP (metadata only)
GET  /api/admin/rounds/:id/ballot-preview      — Preview a single ballot (returns image, always correctly oriented)

Admin UI:
Add a "Generate Ballots" section to the round detail page:
- Input for quantity
- Dropdown for ballot size
- Optional logo upload
- "Generate" button
- After generation: "Download PDF" and "Download Data ZIP" as separate buttons
- Preview pane showing one example ballot, correctly oriented
```

---

## Phase 4: Scanning & Pass Management

```
Phase 4: Build the ballot scanning system and pass management.

Scanner Service (server/src/services/scannerService.js):
- Validates scanned SN against ballot_serials for the current round
- Prevents double-counting within a pass (same SN scanned twice = error)
- Records each scan with candidate vote, ballot box, timestamp, and image paths
- Does NOT show running vote counts to the scanner operator

Pass Management API (under /api):
POST   /rounds/:id/passes              — Create a pass (auto-numbers: 1, 2, 3...)
PUT    /passes/:id/complete             — Mark pass as complete
DELETE /passes/:id                      — Delete pass (only if not yet confirmed, requires judge auth)
GET    /rounds/:id/passes               — List all passes for a round with scan counts

Scan API:
POST   /passes/:id/scans               — Record a scan (serial_number, candidate_id, ballot_box_id, front_image, back_image)
  - Validate SN exists for this round
  - Validate SN not already scanned in this pass
  - Accept front and back image uploads (multer)
  - Store images to uploads/elections/{eid}/rounds/{rid}/scans/
  - Return success with scan count for this pass

POST   /passes/:id/scans/manual         — Manual SN entry (for spoiled/jammed ballots where QR won't scan)
  - Same as above but SN typed manually instead of scanned

Spoiled Ballot API:
POST   /rounds/:id/spoiled              — Log spoiled ballot (serial_number, spoil_type, notes, image)
  - spoil_type: "unreadable" or "intent_undermined"
  - For jammed/unreadable: accept mobile phone camera image upload
  - Mark the SN status as "spoiled" in ballot_serials

Scanner UI Pages:

1. /scan/:roundId — Scanner page (for tally operators)
   - Camera viewfinder using html5-qrcode library for QR scanning
   - On successful scan: show SN, prompt for candidate selection (tap the candidate name)
   - Optional ballot box selection (dropdown)
   - Auto-captures front image from camera
   - "Flip & Scan Back" button to capture back side
   - Success/error feedback after each scan
   - "Manual Entry" button for typing SN when QR won't scan
   - Shows total scans for current pass (count only, NOT vote tallies)
   - No running count of votes per candidate shown

2. /scan/:roundId/spoiled — Spoiled ballot logging
   - Select spoil type (unreadable/jammed or intent undermined)
   - Enter or scan SN
   - Camera capture for mobile phone scanning of jammed ballots
   - Notes field (free text)
   - Submit button

WebSocket Events:
- "scan:recorded" — broadcast to admin when a new scan comes in (include pass_id and count)
- "pass:complete" — broadcast when a pass is marked complete

Pass Rules:
- Pass 1 and Pass 2 are required before confirmation can proceed
- Additional passes (3, 4, ...) can be added by Election Judge or Admin
- A pass can be deleted if started in error, BEFORE round confirmation. Deletion requires Election Judge role.
```

---

## Phase 5: Confirmation, Mismatch Override & Chair Release

```
Phase 5: Build the confirmation workflow, mismatch handling, and chair preview/release.

Confirmation Service (server/src/services/confirmationService.js):
- Compare Pass 1 and Pass 2 results: for each candidate, check if vote counts match
- If additional passes exist, include them in the comparison view
- Compute results: vote_count and percentage (to 5 decimal places) per candidate
- Store results in round_results table

Confirmation API:
GET  /rounds/:id/comparison    — Compare all passes side-by-side (vote counts per candidate per pass)
POST /rounds/:id/confirm       — Election Judge confirms the round
  Body: { confirmed_by_name, is_override: false }
  - Only allowed if at least Pass 1 and Pass 2 are complete
  - Sets round status to "confirmed" then "pending_release"

POST /rounds/:id/confirm-override — Election Judge overrides a mismatch
  Body: { confirmed_by_name, is_override: true, override_notes (REQUIRED) }
  - override_notes cannot be empty
  - Same behavior as confirm but logs the override

Chair Preview & Release API:
GET  /rounds/:id/chair-preview    — Returns exactly what the public will see for this round (results, SN list, ballot image links). Only accessible to Chair role.
POST /rounds/:id/release          — Chair approves public release
  Body: { released_by_name }
  - Sets round status to "released"
  - Emits WebSocket event "round:released" so the public dashboard updates live

GET  /rounds/:id/chair-decision   — Chair decision screen data
  - Returns: candidate results with percentages to 5 decimals, threshold info
  - Chair can then trigger: eliminate candidate, advance to next round, or declare winner via existing race/round APIs

Admin/Judge UI:

1. /admin/rounds/:id/confirm — Confirmation page
   - Side-by-side comparison table: each pass as a column, candidates as rows, vote counts in cells
   - Mismatch cells highlighted in red
   - If passes match: green "Confirm Results" button
   - If passes DON'T match: yellow warning banner explaining the mismatch
     - "Confirm Anyway (Override)" button — clicking opens a modal requiring notes (text area, cannot be empty)
     - "Add Another Pass" button to do a recount
     - "Delete a Pass" option if one was done in error
   - Confirmation is framed as a QUESTION: "Election Judge: Do you confirm these results?"
   - The judge enters their name and clicks confirm

2. /admin/rounds/:id/chair — Chair decision + preview page
   - Shows vote results with 5-decimal percentages
   - "Preview Public Dashboard" button → opens a modal or panel showing exactly the public view for this round
   - "Release to Public" button (only after previewing)
   - Decision buttons: "Eliminate [candidate]", "Advance to Next Round", "Declare Winner"

WebSocket Events:
- "round:confirmed" — broadcast when judge confirms (admin sees it)
- "round:released" — broadcast when chair releases (public dashboard updates)
```

---

## Phase 6: Public Dashboard (TV + Mobile)

```
Phase 6: Build the public-facing dashboard with TV and mobile modes.

Public API (no auth required):
GET  /api/public/:electionId                    — Election overview with all races and released rounds
GET  /api/public/:electionId/races/:raceId      — Race detail with all released rounds
GET  /api/public/:electionId/rounds/:roundId     — Round detail: results + list of all ballot SNs
GET  /api/public/:electionId/ballots/:serialNumber — Returns the front-page ballot image for this SN
GET  /api/public/:electionId/search?sn=XXXXXXXX  — Search for a ballot SN across all rounds, return matching round + image link

Important: These endpoints ONLY return data for rounds with status = "released". Unreleased rounds are invisible.

Admin API for QR toggle:
PUT  /api/admin/elections/:id/tv-qr  — Enable/disable QR code on TV display
  Body: { enabled: boolean, url: string (the mobile dashboard URL) }

Public Dashboard Pages:

1. /public/:electionId — Main public dashboard (auto-detects TV vs mobile)

   TV DISPLAY MODE (detected by screen width > 1200px or ?mode=tv query param):
   - Full-screen layout, dark background, high contrast, large fonts
   - Election name as header
   - All races displayed as cards/panels
   - Each race shows: race name, status label ("Round 1 Complete", "Round 2 in Progress", "Race Complete"), and results of each released round
   - Results show candidate names + vote counts + percentage bars
   - If admin has enabled the QR code: a QR code is displayed in the corner linking to the mobile dashboard URL
   - Auto-refreshes via WebSocket — when "round:released" fires, new results animate in
   - No interaction needed — this just sits on a TV

   MOBILE DETAIL MODE (screen width <= 1200px or default on phones):
   - Clean, touch-friendly layout
   - Top: Election name + SN search bar
   - Below: List of all races as expandable cards
   - Tap a race → expands to show released rounds
   - Tap a round → navigates to round detail page

2. /public/:electionId/rounds/:roundId — Round detail (mobile)
   - Vote results per candidate (name, count, percentage, bar chart)
   - "Ballots" section: scrollable list of all ballot SNs counted in this round
   - Each SN is a tappable link → opens /public/:electionId/ballots/:sn
   - SN list is searchable/filterable with a text input at the top

3. /public/:electionId/ballots/:serialNumber — Ballot image viewer (mobile)
   - Displays the front-page scanned image of the ballot, full width
   - Shows: SN, Race, Round info above the image
   - Back-page image is NOT shown (stored internally only)
   - "Back to results" link

4. SN Quick Search:
   - Search bar at top of mobile dashboard
   - User types their 8+ character SN
   - If found in a released round: navigates directly to the ballot image
   - If not found or not yet released: shows "Ballot not found or results not yet released"

WebSocket Integration:
- Public dashboard connects to Socket.IO on page load
- Listens for "round:released" events
- On event: fetches updated data and re-renders (TV mode animates, mobile mode refreshes list)

Styling:
- TV mode: Think election-night broadcast. Dark background, bright text, percentage bars, status badges.
- Mobile mode: Clean white/light background, large touch targets, fast loading.
- Both modes must work on local LAN with no internet (no external CDNs — bundle everything).
```

---

## Phase 7: Results PDF + Backup/Export

```
Phase 7: Build the results PDF generator and ballot image backup/export.

Results PDF Service (server/src/pdf/resultsPdf.js):

Generate a PDF at the end of each round containing:
1. Header: Election name, Race name, Round number, Date/time of confirmation
2. Results table: Candidate name, vote count, percentage (5 decimals)
3. Spoiled ballot log: SN, spoil type, notes, who reported it
4. Pass comparison: Table showing each pass's counts per candidate, with mismatches highlighted
5. Override notes: If the Election Judge overrode a mismatch, include their notes
6. Unused serial numbers: Complete list of all SNs that were generated for this round but NOT scanned (status = "unused"). Include a total count at the top of the list: "X of Y serial numbers unused"
7. Footer: "Generated by BallotTrack" + timestamp

API:
GET /api/admin/rounds/:id/results-pdf — Download the results PDF

Backup/Export Service (server/src/services/exportService.js):

1. Ballot Image Export:
   POST /api/admin/elections/:id/export-images — Triggers creation of a ZIP containing ALL scanned ballot images (front + back) organized by round
   GET  /api/admin/elections/:id/export-images/status — Check if export ZIP is ready
   GET  /api/admin/elections/:id/export-images/download — Download the ZIP

   ZIP structure:
   ballot-images/
   ├── race-chair/
   │   ├── round-1/
   │   │   ├── ABCD1234-front.jpg
   │   │   ├── ABCD1234-back.jpg
   │   │   └── ...
   │   └── round-2/
   └── race-vice-chair/
       └── round-1/

2. Full Election Export (for archival):
   POST /api/admin/elections/:id/export-full — ZIP with: all images, all results PDFs, ballot PDFs, and a JSON dump of all election data

Admin UI additions:
- On the election detail page, add an "Export" section:
  - "Export All Ballot Images" button → starts export, shows progress, then download link
  - "Export Full Election Data" button → same flow
- On the round detail page:
  - "Download Results PDF" button
```

---

## Phase 8: Docker, Auth & Polish

```
Phase 8: Final integration — Docker production build, simple auth, and polish.

1. Authentication (simple, no external auth service):
   - Since this runs on a closed LAN, use a simple PIN/password system
   - Admin, Judge, and Chair each get a PIN set in the .env file (ADMIN_PIN, JUDGE_PIN, CHAIR_PIN)
   - Login page: select role dropdown + enter PIN
   - Store role in a session cookie or JWT
   - Tally Operator has no PIN — they access /scan/:roundId directly (link shared by admin)
   - Public dashboard has no auth at all

   Middleware:
   - requireAdmin — checks admin or chair session
   - requireJudge — checks judge or chair session
   - requireChair — checks chair session only
   - Apply to appropriate routes

2. Docker Production Build:
   - Multi-stage Dockerfile: build React client, then serve static files from Express
   - docker-compose.yml for production:
     - app container runs Express serving both API and static React build
     - db container runs PostgreSQL with persistent volume
     - uploads volume persists ballot images and exports
   - Single port (3000) serves everything
   - Health check endpoint: GET /api/health

3. Polish & Error Handling:
   - Add proper error handling middleware on the server
   - Add loading states and error messages in the React UI
   - Make sure all WebSocket reconnection works if connection drops
   - Test the full workflow end-to-end:
     a. Create election → add races → add candidates
     b. Create round (pick paper color)
     c. Generate ballots → download PDF separately from ZIP
     d. Create Pass 1 → scan ballots → complete pass
     e. Create Pass 2 → scan ballots → complete pass
     f. Judge confirms (or overrides with notes)
     g. Chair previews public dashboard → releases round
     h. Public TV and mobile views show results
     i. Public user searches SN → sees ballot image
     j. Export ballot images

4. Sample Election:
   - The seeded sample election should have some pre-populated scan data so the dashboard has something to show
   - Add archive and delete buttons for the sample election on the admin dashboard

5. README.md:
   Write a clear README with:
   - What BallotTrack is (one paragraph)
   - Prerequisites (Docker, Docker Compose)
   - Quick start: clone, copy .env.example to .env, set PINs, docker-compose up
   - Default URLs: admin at /admin, scanner at /scan/:roundId, public at /public/:electionId
   - Troubleshooting section
```

---

## Build Order Checklist

After each phase, do this before moving on:
- [ ] Test it works (docker-compose up, click around)
- [ ] Git commit with message like "Phase 1: project setup and database schema"
- [ ] Push to GitHub

| Phase | What You Get | Depends On |
|-------|-------------|------------|
| 1 | Running containers, database with tables, sample data | Nothing |
| 2 | Admin can create/manage elections, races, candidates, rounds | Phase 1 |
| 3 | Generate ballot PDFs with QR codes, download separately | Phase 2 |
| 4 | Scan ballots, manage passes, log spoiled ballots | Phase 3 |
| 5 | Judge confirms, Chair previews + releases | Phase 4 |
| 6 | Public TV + mobile dashboard with clickable SNs | Phase 5 |
| 7 | Results PDFs with unused SNs, image backup/export | Phase 6 |
| 8 | Auth, Docker prod build, sample data, README | Phase 7 |