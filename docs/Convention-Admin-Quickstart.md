# BallotTrack — Admin Quickstart (Convention Day)

**Print this. Keep it next to the laptop.**

> **🛑 Before publishing ANY round to the dashboard, the Party Chair must approve the results in person.** No exceptions. The "Publish to Dashboard" button is the public release — once clicked, results are live on every TV and phone in the room.

---

## Per-Round Checklist (do in order)

For each race, each round, walk through these steps top to bottom.

### 1. Open Voting
- Go to **Admin → Election → Race → Round**.
- Status badge should read **Ready**.
- Click **Open Voting**.
- Status changes to **Voting Open**. Polling begins.

### 2. Close Voting (when polls close)
- Click **Close Voting**.
- Status changes to **Voting Closed**.
- ⚠️ Scanning is *not* available yet.

### 3. Open for Tallying
- Click **Open for Tallying**.
- Status changes to **Tallying**.
- The **Pass Manager** section becomes active.
- Scan stations can now begin scanning.

### 4. Run Pass 1
- Click **Start Pass 1**.
- Tell the scan team to begin.
- Watch live counts update in **Pass Manager** (Total = all stations, Local = this laptop's station).
- When all ballots are scanned: click **Complete Pass**.

### 5. Run Pass 2 (required)
- Click **Start Pass 2**.
- Same process. Click **Complete Pass** when done.

### 6. Clear the Review Queues
Two separate queues — both must be empty before confirmation.

- **Flagged Review** (auto-flagged: no mark, overvote, uncertain, QR not found)
  - Enter your name at top.
  - For each ballot: pick **Count for [Candidate]**, **Mark as Spoiled**, or **Reject**.
- **Ballot Review Queue** (manually reported issues)
  - Choose **Count for [Candidate]**, **Remade** (need a replacement SN), **Spoiled**, or **Reject**.
  - "Wrong Round" ballots require a Super Admin PIN to count.

### 7. Judge Confirms the Round
- Open the **Confirmation** page.
- Compare Pass 1 vs Pass 2 in the comparison table.
  - **Green** = passes agree → proceed.
  - **Red** = mismatch → see FAQ. Don't override blindly.
- Use the **Ballot-Level Comparison** toggle to find specific disagreements.
- Use the **Reconcile Ballots** panel (← Pass 1, → Pass 2, ↓ Physical Review) to resolve each disagreeing ballot.
- Enter the **Election Judge's name AND a Super Admin PIN**. Click **Confirm Results**.
- ⚠️ **This step records the judge's audit + computes results. It does NOT finalize the round.** The status stays in **Tallying** — only the Chair's action in Step 8 flips it to Round Finalized.

### 8. Chair Decision (🛑 CHAIR PRESENT)
- The **Chair Decision** screen opens.
- Set each candidate's outcome from the dropdown (Eliminated, Withdrew, Advance, Winner, etc.).
- Click **Preview Public Dashboard** — show the Chair exactly what the public will see.
- **Wait for the Chair's verbal approval.**
- Click **Finalize Round & Move to Next**. Enter Super Admin PIN.
- This is the action that flips the round to **Round Finalized**.
- ⚠️ **Race-level actions (Finalize Race, Cancel Race) are NOT on this page.** They live on the **Race detail page** — go there if this round decides the whole race.

### 9. Publish to Dashboard (🛑 CHAIR APPROVED)
- Back on the Round page, status is now **Round Finalized**.
- **Confirm the Chair has approved.** Then click **Publish to Dashboard**.
- TV and mobile dashboards update live.

### 10. (If race is decided) Finalize the Race
- Go to the **Race detail page** (Election → Race).
- Click **Finalize Race**. Enter Super Admin PIN.
- ⚠️ **Race finalization is refused if any round in the race is still Voting Open or Tallying.** Finalize or void those rounds first. (Rounds in Ready / Needs Action are auto-canceled — they have no committed work.)

---

## Status Cheat Sheet

| Badge | What it means | Next button |
|---|---|---|
| Ready | Round set up, not voting | Open Voting |
| Voting Open | Voters voting | Close Voting |
| Voting Closed | No more votes accepted | Open for Tallying |
| Tallying | Scanning + review in progress | Start Pass / Complete Pass |
| Round Finalized | Confirmed by Judge + Chair decided | Publish to Dashboard |
| Published | Live on public dashboard | (done — Unpublish only if needed) |

---

## Things That Need a Super Admin PIN

PIN is bound to **the logged-in super admin** — your own PIN, not a co-admin's.

- **Judge Confirm Results** (on the Confirmation page — new in v0.168)
- **Finalize Round & Move to Next** (Chair Decision page)
- **Finalize Race / Cancel Race** (Race detail page only — removed from the Chair page in v0.171/v0.172)
- Delete a pass
- Reset spoiled ballots
- Recount round (destructive)
- Reverse finalization
- Void round
- Count a wrong-round ballot

---

## Reminders

- **Pass 1 and Pass 2 are both required** before you can confirm.
- **Both review queues must be empty** before the comparison numbers settle.
- **The Chair approves results before publishing.** Always.
- If something looks wrong, **stop and ask** — don't override a mismatch without understanding it (see FAQ).
