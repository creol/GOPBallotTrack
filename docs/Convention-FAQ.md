# BallotTrack — Convention Day FAQ

For Admins and Election Judges. Look here first when something looks off.

> **🛑 Universal rule:** The Party Chair must approve every round's results before the Admin clicks **Publish to Dashboard**. The Chair's preview screen exists for exactly this reason — use it.

---

## Confirm vs. Finalize — They Are Two Different Steps

### Q: I clicked "Confirm Results" on the Confirmation page. Is the round done?

**No.** As of v0.169, "Confirm Results" only records the **Election Judge's audit row** and locks in the computed totals. The round stays in **Tallying**. The round is *not* finalized until the **Chair** clicks **Finalize Round & Move to Next** on the Chair Decision page (also PIN-gated).

This split exists because, before, operators were finalizing the round on the Confirmation page without realizing it. Now there are two distinct, intentional, PIN-gated steps:

1. **Judge confirms** (Confirmation page) — judge name + Super Admin PIN. Records audit, computes results. Status stays Tallying.
2. **Chair finalizes** (Chair Decision page) — Super Admin PIN. Status flips to Round Finalized. Then you can publish.

### Q: The Confirmation page asks for a Super Admin PIN now. Why?

As of v0.168, the judge confirm step requires a Super Admin PIN — it used to take just a typed name. The PIN must belong to **the currently logged-in super admin** (not any super admin in the system).

---

## Confirmation & Comparison Screen

### Q: Pass 1 and Pass 2 don't match. What now?

**Don't override yet.** First, find out *why* they disagree.

1. On the **Confirmation** page, toggle **Show Ballot-Level Comparison**.
2. Filter to **Mismatches** — these are the ballots Pass 1 and Pass 2 read differently.
3. Click each disagreeing serial number to open the ballot in the **Ballot Review** panel. Look at the image.
4. Use the **Reconcile Ballots** panel to decide each one:
   - `←` accept Pass 1's read
   - `→` accept Pass 2's read
   - `↓` flag for **Needs Physical Review** (pull the paper ballot, look at it, decide)
5. After every disagreement is reconciled, the candidate totals will update. If they still don't match: run **Pass 3** (use the **Add Another Pass** button or start one from the Round page).

Use **Confirm Anyway (Override)** only as a last resort — and the override notes are required for a reason: write down exactly why you're overriding.

### Q: A ballot has a different vote in each pass — which one is right?

Look at the **OMR confidence** numbers next to each pass's read:
- **Green (>50%)** = the scanner is confident.
- **Amber (20–50%)** = mark is faint or partial.
- **Red (<20%)** = scanner is guessing.

If one pass is green and the other is red, trust the green one. If both are amber/red, pull the physical ballot and look at it yourself.

### Q: I see "Wrong Round Ballot" with a red banner. What is that?

A scanner picked up a ballot whose paper color/round doesn't match the round being tallied. Two options:

- **Reject** — removes the scan, returns the ballot's serial to "unused" so it can be re-scanned in its correct round.
- **Count for [Candidate]** — requires a Super Admin to enter their PIN. Only do this if you're sure the ballot belongs in this round and was mislabeled somehow.

If many ballots are wrong-round (someone fed the wrong stack), use **Reject All Wrong Round** at the top of the comparison table.

### Q: The vote on a ballot is clearly correct on the paper but the system has it as a different candidate.

On the **Ballot Review** panel, use the **candidate dropdown** next to the affected pass. It'll prompt you for your name and a reason — both go into the audit log. The change shows up in the comparison immediately.

### Q: "Add Another Pass" button isn't there.

It only appears when there's an unresolved mismatch. To start a 3rd pass manually: go to the Round page → **Pass Manager** → **Start Pass 3**.

---

## Review Queues (Flagged + Ballot Review)

### Q: When do I pick Count vs. Remade vs. Spoiled vs. Rejected?

| Option | Use when… |
|---|---|
| **Count for [Candidate]** | The ballot is valid; intent is clear. (Most common.) |
| **Remade** | The original ballot was damaged but a replacement was created with the same vote. You'll enter the new ballot's serial number. |
| **Spoiled** | The ballot is unreadable or intent can't be determined. Removed from the count. |
| **Rejected** | The ballot shouldn't be counted at all (wrong round, duplicate, bad serial). |

Note: **Flagged Review** doesn't offer "Remade" — only the **Ballot Review Queue** does.

### Q: What does each flag reason mean?

| Flag | Meaning |
|---|---|
| **No Mark** | The OMR didn't detect a filled oval anywhere. |
| **Overvote** | Two or more candidates marked in the same race. |
| **Uncertain** | A mark exists but the OMR isn't confident enough to call it. |
| **QR Not Found** | The QR code couldn't be read. The ballot has no serial linkage until you handle it. |

For **Uncertain** and **No Mark**, look at the image — sometimes voters use checkmarks, X's, or circle a name. Convention rules typically allow you to count clear intent.

### Q: A ballot is in the queue but I don't see an image.

The agent didn't successfully save the image (crash mid-scan, disk problem). You can't recover the image. **Mark it Spoiled** with a note explaining the missing image, and pull the paper ballot for separate manual handling.

---

## Passes & Scanning

### Q: A pass was started by mistake. How do I delete it?

1. Round page → **Complete Pass** (you can't delete an active pass).
2. The completed pass shows up as a pill with **Reopen** and **Delete** buttons.
3. Click **Delete**. You'll be prompted for a reason and your **Super Admin PIN**.
4. All scans in that pass are reversed; the serial numbers go back to "unused".

### Q: A pass got completed too early — there are more ballots to scan.

Click **Reopen** on the pass pill. You'll be prompted for a reason. Scanning resumes for that pass.

### Q: I need to recount the entire round from scratch.

Round page → **Recount** (in the destructive actions section). Requires Super Admin PIN and a written reason. This:
- Archives the current results
- Soft-deletes all passes
- Removes the round from the public dashboard if published
- Sends the round back to **Tallying**

You start over from Pass 1.

### Q: Scan station shows the wrong round / ballots are going to the wrong round.

The scan operator picked the wrong round on Station Setup, or the station was assigned to a different round earlier and never reset.

1. The operator goes back to **Station Setup** via the Round Selection link on the Scanner page.
2. They click **Start** on the correct round.
3. Any ballots already scanned to the wrong round will appear as **Wrong Round** in the correct round's review queue — reject them so the serials free up, then re-scan.

### Q: Pass shows as Active but no scans are coming in.

Check, in order:
1. **Agent banner** on the scan station — red means the agent isn't running. Double-click the desktop shortcut.
2. **Station assignment** — Station Setup, confirm the right round is selected.
3. **Watch folder** — the scanner is supposed to drop images into a folder the agent watches. If the scanner is dropping them somewhere else, the agent never sees them.
4. If still stuck: delete the pass (above) and start a fresh one to rule out a stuck pass record.

---

## Permissions & PINs

### Q: The Super Admin PIN keeps being rejected.

The PIN is checked against **the currently logged-in super admin's** PIN — not a generic "any super admin" PIN. (This was a bug; it's now fixed and strict.)

1. Confirm who's logged in (top of screen).
2. That user must enter **their own** PIN.
3. If you don't know it: log out and log in as the super admin whose PIN you have.
4. If everyone's PIN is failing: another super admin can reset yours from User Management.

### Q: I don't see the destructive buttons (Recount, Void, Delete Pass).

You're logged in as a Race Admin, not a Super Admin. These actions are Super Admin only. Hand the laptop to a Super Admin or log them in.

---

## Chair / Publish

### Q: Can I publish before the Chair has reviewed?

**No.** The Chair must approve every round's results before publishing. Use the **Preview Public Dashboard** button on the Chair Decision screen to show them exactly what will go live. Wait for verbal approval. Then click **Publish to Dashboard**.

### Q: We published, then noticed a problem.

On the Round page, click **Unpublish**. Results are removed from the public dashboard but the finalization stays in place. Fix the issue (recount, edit, etc.), get the Chair's re-approval, then publish again.

### Q: The Chair changed their mind about a candidate's outcome (e.g., "Advance" → "Eliminated").

If the round isn't finalized yet: Chair Decision page → change the dropdown → it auto-saves. Re-click **Finalize Round & Move to Next**.

If the round **is** finalized: use **Reverse Finalization** on the Round page (Super Admin PIN, written reason) before the dropdowns unlock.

### Q: Where did "Finalize Race" and "Cancel Race" go on the Chair Decision page?

Removed in v0.171 / v0.172. They were too easy to click in the wrong context (terminating the race from a round-level screen). **Race-level actions now live only on the Race detail page** (Election → Race). Go there to finalize or cancel a race.

### Q: Finalize Race is failing — "rounds still active."

As of v0.170, race finalize **refuses** if any round in the race is **Voting Open** or **Tallying** — those rounds have committed work (passes, scans, judge confirmations) that the old auto-cancel was silently sweeping away. You must:

1. Go to each active round.
2. Either finalize it normally (close voting → tally → confirm → chair finalize) or **Void Round** if it should be discarded.
3. Then return to the Race page and click **Finalize Race**.

Rounds in **Ready** or **Needs Action** (no scans yet) are still auto-canceled by the finalize — only rounds with real work block it.

---

## Round Status Stuck

### Q: I can't open scanning. The button isn't there.

Check the status badge on the Round page:

| Status | What to click |
|---|---|
| Ready | **Open Voting** |
| Voting Open | **Close Voting**, then **Open for Tallying** |
| Voting Closed | **Open for Tallying** |
| Tallying | Scanning is open — Pass Manager should be active |
| Round Finalized | Use **Reverse Finalization** (Super Admin) to step back |

### Q: I clicked the wrong status button.

Use the **Revert** actions in the destructive section: Back to Ready, Reopen Voting, Back to Voting Closed. These don't require notes (just confirmation), but they do require Super Admin PIN.

---

## When in doubt

- **Stop.** Don't click destructive buttons to "see what happens."
- **Read the status badge** — most "stuck" issues are just the round being in a state you didn't expect.
- **Ask a Super Admin** before overriding a mismatch or rejecting wrong-round ballots in bulk.
- **The Chair approves before publishing.** Every time.
