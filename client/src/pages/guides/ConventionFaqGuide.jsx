import GuideLayout, { Section, Callout, Pill, Kbd, Table } from '../../components/GuideLayout';

const SECTIONS = [
  { id: 'confirm-vs-finalize', label: 'Confirm vs. Finalize' },
  { id: 'comparison',          label: 'Confirmation & Comparison' },
  { id: 'queues',              label: 'Review Queues' },
  { id: 'passes',              label: 'Passes & Scanning' },
  { id: 'pins',                label: 'Permissions & PINs' },
  { id: 'chair',               label: 'Chair / Publish' },
  { id: 'stuck',               label: 'Round Status Stuck' },
  { id: 'doubt',               label: 'When in Doubt' },
];

function Q({ id, q, children }) {
  return (
    <div id={id} style={{ margin: '1.25rem 0', scrollMarginTop: '1.5rem' }}>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.4rem', fontSize: '0.98rem' }}>
        <span style={{ color: '#2563eb', marginRight: '0.5rem' }}>Q.</span>{q}
      </div>
      <div style={{ paddingLeft: '1.5rem', borderLeft: '3px solid #e5e7eb', color: '#374151', fontSize: '0.9rem', lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}

export default function ConventionFaqGuide() {
  return (
    <GuideLayout
      eyebrow="Convention Day Guide"
      title="Convention FAQ"
      subtitle="Real failure modes, real fixes. Look here first when something looks off."
      audience="For Admins & Judges"
      accent="#dc2626"
      sections={SECTIONS}
    >
      <Callout kind="danger" title="Universal rule">
        The Party Chair must approve every round's results <strong>before</strong> the Admin clicks
        <strong> Publish to Dashboard</strong>. The Chair's preview screen exists for exactly this reason — use it.
      </Callout>

      <Section id="confirm-vs-finalize" title="Confirm vs. Finalize — They Are Two Different Steps">
        <Q q={`I clicked "Confirm Results" on the Confirmation page. Is the round done?`}>
          <p><strong>No.</strong> As of v0.169, "Confirm Results" only records the <strong>Election Judge's audit row</strong> and locks in the computed totals. The round stays in <Pill kind="amber">Tallying</Pill>.</p>
          <p>The round is <em>not</em> finalized until the <strong>Chair</strong> clicks <strong>Finalize Round &amp; Move to Next</strong> on the Chair Decision page (also PIN-gated).</p>
          <p>This split exists because, before, operators were finalizing the round on the Confirmation page without realizing it. Now there are two distinct, intentional, PIN-gated steps:</p>
          <ol>
            <li><strong>Judge confirms</strong> (Confirmation page) — judge name + Super Admin PIN. Records audit, computes results. Status stays Tallying.</li>
            <li><strong>Chair finalizes</strong> (Chair Decision page) — Super Admin PIN. Status flips to Round Finalized. Then you can publish.</li>
          </ol>
        </Q>

        <Q q="The Confirmation page asks for a Super Admin PIN now. Why?">
          <p>As of v0.168, the judge confirm step requires a Super Admin PIN — it used to take just a typed name. The PIN must belong to <strong>the currently logged-in super admin</strong> (not any super admin in the system).</p>
        </Q>
      </Section>

      <Section id="comparison" title="Confirmation & Comparison Screen">
        <Q q="Pass 1 and Pass 2 don't match. What now?">
          <p><strong>Don't override yet.</strong> First, find out <em>why</em> they disagree.</p>
          <ol>
            <li>On the Confirmation page, toggle <strong>Show Ballot-Level Comparison</strong>.</li>
            <li>Filter to <strong>Mismatches</strong> — these are the ballots Pass 1 and Pass 2 read differently.</li>
            <li>Click each disagreeing serial number to open the ballot in the <strong>Ballot Review</strong> panel. Look at the image.</li>
            <li>Use the <strong>Reconcile Ballots</strong> panel to decide each one:
              <ul>
                <li><Kbd>←</Kbd> accept Pass 1's read</li>
                <li><Kbd>→</Kbd> accept Pass 2's read</li>
                <li><Kbd>↓</Kbd> flag for <strong>Needs Physical Review</strong> (pull the paper ballot, look at it, decide)</li>
              </ul>
            </li>
            <li>After every disagreement is reconciled, the candidate totals will update. If they still don't match: run <strong>Pass 3</strong>.</li>
          </ol>
          <p>Use <strong>Confirm Anyway (Override)</strong> only as a last resort — and the override notes are required for a reason: write down exactly why you're overriding.</p>
        </Q>

        <Q q="A ballot has a different vote in each pass — which one is right?">
          <p>Look at the <strong>OMR confidence</strong> numbers next to each pass's read:</p>
          <ul>
            <li><Pill kind="green">Green (&gt;50%)</Pill> = the scanner is confident.</li>
            <li><Pill kind="amber">Amber (20–50%)</Pill> = mark is faint or partial.</li>
            <li><Pill kind="red">Red (&lt;20%)</Pill> = scanner is guessing.</li>
          </ul>
          <p>If one pass is green and the other is red, trust the green one. If both are amber/red, pull the physical ballot and look at it yourself.</p>
        </Q>

        <Q q={`I see "Wrong Round Ballot" with a red banner. What is that?`}>
          <p>A scanner picked up a ballot whose paper color/round doesn't match the round being tallied. Two options:</p>
          <ul>
            <li><strong>Reject</strong> — removes the scan, returns the ballot's serial to "unused" so it can be re-scanned in its correct round.</li>
            <li><strong>Count for [Candidate]</strong> — requires a Super Admin to enter their PIN. Only do this if you're sure the ballot belongs in this round and was mislabeled somehow.</li>
          </ul>
          <p>If many ballots are wrong-round (someone fed the wrong stack), use <strong>Reject All Wrong Round</strong> at the top of the comparison table.</p>
        </Q>

        <Q q="The vote on a ballot is clearly correct on the paper but the system has it as a different candidate.">
          <p>On the <strong>Ballot Review</strong> panel, use the <strong>candidate dropdown</strong> next to the affected pass. It'll prompt you for your name and a reason — both go into the audit log. The change shows up in the comparison immediately.</p>
        </Q>

        <Q q={`"Add Another Pass" button isn't there.`}>
          <p>It only appears when there's an unresolved mismatch. To start a 3rd pass manually: go to the Round page → <strong>Pass Manager</strong> → <strong>Start Pass 3</strong>.</p>
        </Q>
      </Section>

      <Section id="queues" title="Review Queues (Flagged + Ballot Review)">
        <Q q="When do I pick Count vs. Remade vs. Spoiled vs. Rejected?">
          <Table
            headers={['Option', 'Use when…']}
            rows={[
              [<strong>Count for [Candidate]</strong>, 'The ballot is valid; intent is clear. (Most common.)'],
              [<strong>Remade</strong>, "The original ballot was damaged but a replacement was created with the same vote. You'll enter the new ballot's serial number."],
              [<strong>Spoiled</strong>, "The ballot is unreadable or intent can't be determined. Removed from the count."],
              [<strong>Rejected</strong>, "The ballot shouldn't be counted at all (wrong round, duplicate, bad serial)."],
            ]}
          />
          <p><strong>Note:</strong> <em>Flagged Review</em> doesn't offer "Remade" — only the <em>Ballot Review Queue</em> does.</p>
        </Q>

        <Q q="What does each flag reason mean?">
          <Table
            headers={['Flag', 'Meaning']}
            rows={[
              [<Pill kind="amber">No Mark</Pill>, "The OMR didn't detect a filled oval anywhere."],
              [<Pill kind="amber">Overvote</Pill>, 'Two or more candidates marked in the same race.'],
              [<Pill kind="amber">Uncertain</Pill>, "A mark exists but the OMR isn't confident enough to call it."],
              [<Pill kind="red">QR Not Found</Pill>, 'The QR code couldn\'t be read. The ballot has no serial linkage until you handle it.'],
            ]}
          />
          <p>For <em>Uncertain</em> and <em>No Mark</em>, look at the image — sometimes voters use checkmarks, X's, or circle a name. Convention rules typically allow you to count clear intent.</p>
        </Q>

        <Q q="A ballot is in the queue but I don't see an image.">
          <p>The agent didn't successfully save the image (crash mid-scan, disk problem). You can't recover the image. <strong>Mark it Spoiled</strong> with a note explaining the missing image, and pull the paper ballot for separate manual handling.</p>
        </Q>
      </Section>

      <Section id="passes" title="Passes & Scanning">
        <Q q="A pass was started by mistake. How do I delete it?">
          <ol>
            <li>Round page → <strong>Complete Pass</strong> (you can't delete an active pass).</li>
            <li>The completed pass shows up as a pill with <strong>Reopen</strong> and <strong>Delete</strong> buttons.</li>
            <li>Click <strong>Delete</strong>. You'll be prompted for a reason and your <strong>Super Admin PIN</strong>.</li>
            <li>All scans in that pass are reversed; the serial numbers go back to "unused".</li>
            <li>Now you can reopen a previous pass or start a correct one.</li>
          </ol>
        </Q>

        <Q q="A pass got completed too early — there are more ballots to scan.">
          <p>Click <strong>Reopen</strong> on the pass pill. You'll be prompted for a reason. Scanning resumes for that pass.</p>
        </Q>

        <Q q="I need to recount the entire round from scratch.">
          <p>Round page → <strong>Recount</strong> (in the destructive actions section). Requires Super Admin PIN and a written reason. This:</p>
          <ul>
            <li>Archives the current results</li>
            <li>Soft-deletes all passes</li>
            <li>Removes the round from the public dashboard if published</li>
            <li>Sends the round back to <Pill kind="amber">Tallying</Pill></li>
          </ul>
          <p>You start over from Pass 1.</p>
        </Q>

        <Q q="Scan station shows the wrong round / ballots are going to the wrong round.">
          <p>The scan operator picked the wrong round on Station Setup, or the station was assigned to a different round earlier and never reset.</p>
          <ol>
            <li>The operator goes back to <strong>Station Setup</strong> via the Round Selection link on the Scanner page.</li>
            <li>They click <strong>Start</strong> on the correct round.</li>
            <li>Any ballots already scanned to the wrong round will appear as <Pill kind="red">Wrong Round</Pill> in the correct round's review queue — reject them so the serials free up, then re-scan.</li>
          </ol>
        </Q>

        <Q q="Pass shows as Active but no scans are coming in.">
          <p>Check, in order:</p>
          <ol>
            <li><strong>Agent banner</strong> on the scan station — red means the agent isn't running. Double-click the desktop shortcut.</li>
            <li><strong>Station assignment</strong> — Station Setup, confirm the right round is selected.</li>
            <li><strong>Watch folder</strong> — the scanner is supposed to drop images into a folder the agent watches. If the scanner is dropping them somewhere else, the agent never sees them.</li>
            <li>If still stuck: delete the pass and start a fresh one to rule out a stuck pass record.</li>
          </ol>
        </Q>
      </Section>

      <Section id="pins" title="Permissions & PINs">
        <Q q="The Super Admin PIN keeps being rejected.">
          <p>The PIN is checked against <strong>the currently logged-in super admin's</strong> PIN — not a generic "any super admin" PIN. (This was a bug; it's now fixed and strict.)</p>
          <ol>
            <li>Confirm who's logged in (top of screen).</li>
            <li>That user must enter <strong>their own</strong> PIN.</li>
            <li>If you don't know it: log out and log in as the super admin whose PIN you have.</li>
            <li>If everyone's PIN is failing: another super admin can reset yours from User Management.</li>
          </ol>
        </Q>

        <Q q="I don't see the destructive buttons (Recount, Void, Delete Pass).">
          <p>You're logged in as a Race Admin, not a Super Admin. These actions are Super Admin only. Hand the laptop to a Super Admin or log them in.</p>
        </Q>
      </Section>

      <Section id="chair" title="Chair / Publish">
        <Q q="Can I publish before the Chair has reviewed?">
          <p><strong>No.</strong> The Chair must approve every round's results before publishing. Use the <strong>Preview Public Dashboard</strong> button on the Chair Decision screen to show them exactly what will go live. Wait for verbal approval. Then click <strong>Publish to Dashboard</strong>.</p>
        </Q>

        <Q q="We published, then noticed a problem.">
          <p>On the Round page, click <strong>Unpublish</strong>. Results are removed from the public dashboard but the finalization stays in place. Fix the issue (recount, edit, etc.), get the Chair's re-approval, then publish again.</p>
        </Q>

        <Q q={`The Chair changed their mind about a candidate's outcome (e.g., "Advance" → "Eliminated").`}>
          <p>If the round isn't finalized yet: Chair Decision page → change the dropdown → it auto-saves. Re-click <strong>Finalize Round &amp; Move to Next</strong>.</p>
          <p>If the round <strong>is</strong> finalized: use <strong>Reverse Finalization</strong> on the Round page (Super Admin PIN, written reason) before the dropdowns unlock.</p>
        </Q>

        <Q q={`Where did "Finalize Race" and "Cancel Race" go on the Chair Decision page?`}>
          <p>Removed in v0.171 / v0.172. They were too easy to click in the wrong context (terminating the race from a round-level screen). <strong>Race-level actions now live only on the Race detail page</strong> (Election → Race). Go there to finalize or cancel a race.</p>
        </Q>

        <Q q={`Finalize Race is failing — "rounds still active."`}>
          <p>As of v0.170, race finalize <strong>refuses</strong> if any round in the race is <Pill kind="blue">Voting Open</Pill> or <Pill kind="amber">Tallying</Pill> — those rounds have committed work (passes, scans, judge confirmations) that the old auto-cancel was silently sweeping away. You must:</p>
          <ol>
            <li>Go to each active round.</li>
            <li>Either finalize it normally (close voting → tally → confirm → chair finalize) or <strong>Void Round</strong> if it should be discarded.</li>
            <li>Then return to the Race page and click <strong>Finalize Race</strong>.</li>
          </ol>
          <p>Rounds in <em>Ready</em> or <em>Needs Action</em> (no scans yet) are still auto-canceled by the finalize — only rounds with real work block it.</p>
        </Q>
      </Section>

      <Section id="stuck" title="Round Status Stuck">
        <Q q="I can't open scanning. The button isn't there.">
          <p>Check the status badge on the Round page:</p>
          <Table
            headers={['Status', 'What to click']}
            rows={[
              [<Pill kind="green">Ready</Pill>, <strong>Open Voting</strong>],
              [<Pill kind="blue">Voting Open</Pill>, <><strong>Close Voting</strong>, then <strong>Open for Tallying</strong></>],
              [<Pill kind="purple">Voting Closed</Pill>, <strong>Open for Tallying</strong>],
              [<Pill kind="amber">Tallying</Pill>, 'Scanning is open — Pass Manager should be active'],
              [<Pill kind="indigo">Round Finalized</Pill>, <>Use <strong>Reverse Finalization</strong> (Super Admin) to step back</>],
            ]}
          />
        </Q>

        <Q q="I clicked the wrong status button.">
          <p>Use the <strong>Revert</strong> actions in the destructive section: <em>Back to Ready</em>, <em>Reopen Voting</em>, <em>Back to Voting Closed</em>. These don't require notes (just confirmation), but they do require Super Admin PIN.</p>
        </Q>
      </Section>

      <Section id="doubt" title="When in Doubt">
        <Callout kind="warning">
          <ul style={{ margin: 0 }}>
            <li><strong>Stop.</strong> Don't click destructive buttons to "see what happens."</li>
            <li><strong>Read the status badge</strong> — most "stuck" issues are just the round being in a state you didn't expect.</li>
            <li><strong>Ask a Super Admin</strong> before overriding a mismatch or rejecting wrong-round ballots in bulk.</li>
            <li><strong>The Chair approves before publishing.</strong> Every time.</li>
          </ul>
        </Callout>
      </Section>
    </GuideLayout>
  );
}
