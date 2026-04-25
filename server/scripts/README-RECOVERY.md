# Ballot-Spec Recovery

Tools for fixing OMR scan zone misalignment when printed ballots no longer match the
`ballot-spec.json` files on disk. Used when ballots were regenerated AFTER printing.

## Two ways to run recovery

**1. Admin UI (preferred for live events)** — On any race detail page, in the Rounds
tab, click **"Fix scan zones from PDF"**. Upload the printed PDF. The UI shows a
preview (detected ballot size, QR position, candidate matches against the DB, list
of rounds that will be updated). If everything looks right, click "Apply" — the
server writes the corrected spec to every round of the race and saves the source PDF
for audit.

**2. CLI (for offline / batched / scripted recovery)** — The same code path exposed
as a command-line tool. Useful when you have multiple races to fix at once or want
to verify spec output before applying. See the steps below.

Both paths use the **same shared service** at
[server/src/services/ballotSpecRecovery.js](../src/services/ballotSpecRecovery.js),
so they produce identical output for the same input PDF.

## What broke

1. Operator generated ballots and sent the PDFs to the printer.
2. Printer reported overlapping content; operator adjusted the ballot design.
3. Operator regenerated ballots and re-sent to the printer.
4. The regeneration **overwrote** each round's `ballot-spec.json` (which the OMR uses
   at scan time to know where each candidate's oval is on the scanned image).
5. The physical paper that was actually printed and the spec on disk no longer agree —
   so when the scanner reads a ballot, it samples the WRONG pixel zones for each
   candidate, and votes get misattributed.

## How recovery works

The OMR (`server/src/services/omrService.js`) does NOT read the PDF or the printed
paper at scan time. It reads `uploads/elections/{eid}/rounds/{rid}/ballot-spec.json`
which encodes each candidate's oval position as 300-DPI pixel offsets from the QR.

Fix: read the EXACT PDF that was sent to the printer, extract the QR + oval
coordinates from its drawing operators (PDF-native, no rendering needed), and write a
new `ballot-spec.json` for every round of the affected race. No re-printing.

## Three scripts

| Script | Where to run | What it does |
|---|---|---|
| `recoverBallotSpecFromPdf.js` | Anywhere with Node | Reads a printed PDF, writes a draft spec JSON. **No DB access required.** |
| `verifyRecoveredSpec.js` | Anywhere with Node | Renders an overlay PDF you can compare visually with the source PDF. |
| `applyRecoveredSpec.js` | The production server | Looks up race + candidates in DB, writes the final spec into every round of the race (after backing up the broken one). |

## Step-by-step recovery for the urgent fix (election 12, races 63, 69, 73, 74)

### 1. Extract draft specs from the operator-supplied PDFs (local, no DB)

The 4 PDFs are at `uploads/elections/12/recovery-source-pdfs/race-{63,69,73,74}.pdf`.
Already extracted; draft specs are at the same path with `.draft-spec.json` extension.

If you need to re-run extraction:

```powershell
cd E:\GOPBallotTrack
foreach ($id in 63, 69, 73, 74) {
  node server/scripts/recoverBallotSpecFromPdf.js `
    --pdf "uploads/elections/12/recovery-source-pdfs/race-$id.pdf" `
    --out "uploads/elections/12/recovery-source-pdfs/race-$id.draft-spec.json"
}
```

The output prints a summary including each oval's center and the matched candidate
name. Inspect it. Every candidate should match.

### 2. (Optional) Visual verify — open the overlay PDF beside the source PDF

```powershell
foreach ($id in 63, 69, 73, 74) {
  node server/scripts/verifyRecoveredSpec.js `
    --draft-spec "uploads/elections/12/recovery-source-pdfs/race-$id.draft-spec.json" `
    --out "uploads/elections/12/recovery-source-pdfs/race-$id.verify.pdf"
}
```

Open both PDFs in any viewer. The GREEN box must surround the printed QR code in
each cell; the RED box must sit inside each printed oval (and to the LEFT of the
candidate name). All four cells should look identical.

### 3. Deploy the scripts and draft specs to the production server

```bash
# From your local machine, push the new scripts and the new pdfjs-dist dep:
git add server/scripts/ server/package.json server/package-lock.json
git commit -m "Add ballot-spec recovery tools"
git push origin chris

# SSH to the production server and pull:
ssh user@54.187.135.244
cd /path/to/GOPBallotTrack
git pull
cd server && npm install && cd ..

# Copy the 4 draft specs to the server's uploads/ folder.
# From your laptop, in another terminal:
scp uploads/elections/12/recovery-source-pdfs/race-{63,69,73,74}.draft-spec.json \
    user@54.187.135.244:/path/to/GOPBallotTrack/uploads/elections/12/recovery-source-pdfs/
```

If your deploy method differs (Docker, PM2, systemd), adapt accordingly. The key
requirements on the server are:

- The new `server/scripts/*.js` files exist
- `server/node_modules/pdfjs-dist` is installed (only needed for the recover script;
  apply doesn't need pdfjs-dist)
- The 4 `.draft-spec.json` files are in `uploads/elections/12/recovery-source-pdfs/`
- The Node process can read `DATABASE_URL` (same env the main server uses)

### 4. Dry-run apply on the server (read-only sanity check)

```bash
# On the production server
cd /path/to/GOPBallotTrack
for race_id in 63 69 73 74; do
  node server/scripts/applyRecoveredSpec.js \
    --draft-spec "uploads/elections/12/recovery-source-pdfs/race-${race_id}.draft-spec.json" \
    --race-id ${race_id} \
    --dry-run
done
```

For each race, this prints:

- The DB candidates for the race (with their IDs, names, status)
- The match between draft spec names and DB candidates
- The list of rounds that will be updated
- The exact paths it WOULD write to (no actual writes in dry-run)

Verify:

- Every draft candidate matches a DB candidate (`OK:` lines, no `FAIL:`)
- The number of rounds listed matches what you expect

### 5. Apply for real

```bash
# On the production server
for race_id in 63 69 73 74; do
  node server/scripts/applyRecoveredSpec.js \
    --draft-spec "uploads/elections/12/recovery-source-pdfs/race-${race_id}.draft-spec.json" \
    --race-id ${race_id}
done
```

For each round, this:

1. Backs up the existing `ballot-spec.json` to
   `ballot-spec.broken-<timestamp>.json` in the same folder.
2. Writes the new `ballot-spec.json` with proper `election_id`, `race_id`, `round_id`,
   and `candidate_id` for every candidate.
3. Appends a record to `uploads/elections/12/recovery-log.json`.

### 5b. (Optional) Test on a duplicate election WITHOUT touching production

If you want to verify the recovered specs scan correctly before applying them to the
real election, you can clone the election and test there:

1. On the production server's admin UI, go to the election's detail page.
2. Click **"Export Clone (with ballot files)"** — downloads a ZIP that bundles the
   structural data PLUS each round's `ballots.pdf`, `ballot-spec.json`, and
   `ballot-data.zip`.
3. Go back to the admin dashboard, click **"Import JSON or ZIP"**, select the ZIP.
4. A duplicate election is created with `(Imported)` appended to the name.
   - Each round gets the SAME serial-number strings as the original (uniqueness is
     per-round, so this is safe).
   - The ballot files (PDF + spec) are copied as-is; embedded `election_id` /
     `race_id` / `round_id` / `candidate_id` values inside the spec are remapped
     automatically to point at the new election's IDs.
   - **Ballots are NOT regenerated** — your recovered scan zones are preserved.
5. Run the apply tool against the DUPLICATE's race IDs (you can find them in the
   duplicate's URL) to push the recovered spec on top, then physically scan a marked
   ballot and verify the OMR reads correctly.
6. If the duplicate works, run the apply tool against the real election's race IDs
   (the URLs the user originally reported: 74, 73, 63, 69).

### 6. Live test BEFORE letting voting begin

For each of the 4 races (63, 69, 73, 74):

1. Take one physical printed ballot for that race.
2. Mark a specific candidate (write down which one).
3. Scan it through the production scanner, exactly as the tally operator will.
4. Confirm the scan recorded the marked candidate. Check `omr_confidence` is
   reasonable (>= 0.3 ideally).
5. Repeat with a DIFFERENT candidate to rule out luck.

If a race fails the live test:

- Re-open the verify PDF for that race, compare to a printed ballot, look for the
  misalignment.
- Restore the backup if needed:
  `cp ballot-spec.broken-*.json ballot-spec.json` in the affected round dir.
- Capture details of the misalignment and we'll iterate.

## Rollback (if something goes wrong)

Every round's old spec is kept as `ballot-spec.broken-<timestamp>.json` in the same
folder. To roll back a single round:

```bash
cd uploads/elections/12/rounds/<round_id>
ls ballot-spec.broken-*.json   # find the backup
cp ballot-spec.broken-<timestamp>.json ballot-spec.json
```

To roll back all rounds for an election, use a one-liner that finds and restores all
backups (do this carefully; the timestamp suffix should match the apply run you want
to undo).

## Notes / caveats

- **Layout assumption:** all four PDFs in this incident use the IDENTICAL layout
  (default config — QR at cell-local 222.64,300.64 pts; ovals at cx=29.36 with
  rx=7, ry=5 for quarter_letter). The recovery still applies per-race in case any
  given race had a different design tweak.

- **Ballot size:** the recover script auto-detects ballot size from the page
  dimensions and number of QR-shaped images on page 1. All 4 PDFs are
  `quarter_letter` (4-up on Letter). Override with `--ballot-size <key>` if needed.

- **Withdrawn candidates:** the apply script matches against ALL candidates in the
  race regardless of `status`, since the printed paper still shows withdrawn
  candidates. The OMR will still report a vote for a withdrawn candidate's oval; the
  system's downstream logic decides what to do.

- **PDF must be PDFKit-generated by this codebase.** The recover tool's ellipse
  detection assumes PDFKit's exact `.ellipse()` operator pattern (m + 4c + h). If the
  operator regenerated through some other tool, the tool will fail to find ovals and
  abort.

- **The fix is per-round.** Each round's `ballot-spec.json` is rewritten. Other
  artifacts (`ballots.pdf`, `ballot-data.zip`) are NOT touched — the physical paper
  is already printed and remains the source of truth.
