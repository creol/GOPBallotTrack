import GuideLayout, { Section, Step, Callout, Pill, Table } from '../../components/GuideLayout';

const SECTIONS = [
  { id: 'checklist',  label: 'Per-Round Checklist' },
  { id: 'step-1',  label: '1. Open Voting', depth: 2 },
  { id: 'step-2',  label: '2. Close Voting', depth: 2 },
  { id: 'step-3',  label: '3. Open for Tallying', depth: 2 },
  { id: 'step-4',  label: '4. Run Pass 1', depth: 2 },
  { id: 'step-5',  label: '5. Run Pass 2', depth: 2 },
  { id: 'step-6',  label: '6. Clear Review Queues', depth: 2 },
  { id: 'step-7',  label: '7. Judge Confirms', depth: 2 },
  { id: 'step-8',  label: '8. Chair Decision', depth: 2 },
  { id: 'step-9',  label: '9. Publish to Dashboard', depth: 2 },
  { id: 'step-10', label: '10. Finalize the Race', depth: 2 },
  { id: 'status',  label: 'Status Cheat Sheet' },
  { id: 'pins',    label: 'Super Admin PIN Actions' },
  { id: 'reminders', label: 'Day-of Reminders' },
];

export default function AdminQuickstartGuide() {
  return (
    <GuideLayout
      eyebrow="Convention Day Guide"
      title="Admin Quick Start"
      subtitle="A step-by-step playbook for running a race round from open voting through public release."
      audience="For Admins"
      accent="#2563eb"
      sections={SECTIONS}
    >
      <Callout kind="danger" title="Chair must approve before publishing">
        Before clicking <strong>Publish to Dashboard</strong> on any round, the Party Chair must approve
        the results in person. Once published, the results are live on every TV and phone in the room.
      </Callout>

      <Section id="checklist" title="Per-Round Checklist">
        <p>For each race, each round, walk through these ten steps top to bottom.</p>

        <div id="step-1">
          <Step n={1} title="Open Voting">
            <ul>
              <li>Go to <strong>Admin → Election → Race → Round</strong>.</li>
              <li>Status badge should read <Pill kind="green">Ready</Pill>.</li>
              <li>Click <strong>Open Voting</strong>.</li>
              <li>Status changes to <Pill kind="blue">Voting Open</Pill>. Polling begins.</li>
            </ul>
          </Step>
        </div>

        <div id="step-2">
          <Step n={2} title="Close Voting (when polls close)">
            <ul>
              <li>Click <strong>Close Voting</strong>.</li>
              <li>Status changes to <Pill kind="purple">Voting Closed</Pill>.</li>
            </ul>
            <Callout kind="warning">Scanning is <em>not</em> available yet — you still need to open tallying.</Callout>
          </Step>
        </div>

        <div id="step-3">
          <Step n={3} title="Open for Tallying">
            <ul>
              <li>Click <strong>Open for Tallying</strong>.</li>
              <li>Status changes to <Pill kind="amber">Tallying</Pill>.</li>
              <li>The <strong>Pass Manager</strong> section becomes active.</li>
              <li>Scan stations can now begin scanning.</li>
            </ul>
          </Step>
        </div>

        <div id="step-4">
          <Step n={4} title="Run Pass 1">
            <ul>
              <li>Click <strong>Start Pass 1</strong>.</li>
              <li>Tell the scan team to begin.</li>
              <li>Watch live counts in <strong>Pass Manager</strong> — Total = all stations, Local = this laptop's station.</li>
              <li>When all ballots are scanned: click <strong>Complete Pass</strong>.</li>
            </ul>
          </Step>
        </div>

        <div id="step-5">
          <Step n={5} title="Run Pass 2 (required)">
            <ul>
              <li>Click <strong>Start Pass 2</strong>.</li>
              <li>Same process. Click <strong>Complete Pass</strong> when done.</li>
            </ul>
          </Step>
        </div>

        <div id="step-6">
          <Step n={6} title="Clear the Review Queues">
            <p>Two separate queues — both must be empty before confirmation.</p>
            <ul>
              <li>
                <strong>Flagged Review</strong> (auto-flagged: no mark, overvote, uncertain, QR not found)
                <ul>
                  <li>Enter your name at top.</li>
                  <li>For each ballot: <strong>Count for [Candidate]</strong>, <strong>Mark as Spoiled</strong>, or <strong>Reject</strong>.</li>
                </ul>
              </li>
              <li>
                <strong>Ballot Review Queue</strong> (manually reported issues)
                <ul>
                  <li>Choose <strong>Count for [Candidate]</strong>, <strong>Remade</strong> (need a replacement SN), <strong>Spoiled</strong>, or <strong>Reject</strong>.</li>
                  <li>"Wrong Round" ballots require a <Pill kind="red">Super Admin PIN</Pill> to count.</li>
                </ul>
              </li>
            </ul>
          </Step>
        </div>

        <div id="step-7">
          <Step n={7} title="Judge Confirms the Round">
            <ul>
              <li>Open the <strong>Confirmation</strong> page.</li>
              <li>
                Compare Pass 1 vs Pass 2 in the comparison table.
                <ul>
                  <li><Pill kind="green">Green</Pill> = passes agree → proceed.</li>
                  <li><Pill kind="red">Red</Pill> = mismatch → see FAQ. Don't override blindly.</li>
                </ul>
              </li>
              <li>Use <strong>Show Ballot-Level Comparison</strong> to find disagreements.</li>
              <li>Use the <strong>Reconcile Ballots</strong> panel (← Pass 1, → Pass 2, ↓ Physical Review) to resolve each disagreement.</li>
              <li>Enter the Election Judge's name <strong>and</strong> a Super Admin PIN. Click <strong>Confirm Results</strong>.</li>
            </ul>
            <Callout kind="warning" title="This does not finalize the round">
              Confirming records the judge's audit row + computes results. The status stays in <Pill kind="amber">Tallying</Pill>.
              Only the Chair's action in Step 8 flips the round to Finalized.
            </Callout>
          </Step>
        </div>

        <div id="step-8">
          <Step n={8} title="Chair Decision (🛑 Chair Present)">
            <ul>
              <li>The <strong>Chair Decision</strong> screen opens.</li>
              <li>Set each candidate's outcome from the dropdown (Eliminated, Withdrew, Advance, Winner, etc.).</li>
              <li>Click <strong>Preview Public Dashboard</strong> — show the Chair exactly what the public will see.</li>
              <li><strong>Wait for the Chair's verbal approval.</strong></li>
              <li>Click <strong>Finalize Round &amp; Move to Next</strong>. Enter Super Admin PIN.</li>
              <li>This is the action that flips the round to <Pill kind="indigo">Round Finalized</Pill>.</li>
            </ul>
            <Callout kind="warning" title="Race-level actions live elsewhere">
              <strong>Finalize Race</strong> and <strong>Cancel Race</strong> are not on this page anymore.
              They live on the <strong>Race detail page</strong> — go there if this round decides the whole race.
            </Callout>
          </Step>
        </div>

        <div id="step-9">
          <Step n={9} title="Publish to Dashboard (🛑 Chair Approved)">
            <ul>
              <li>Back on the Round page, status is now <Pill kind="indigo">Round Finalized</Pill>.</li>
              <li><strong>Confirm the Chair has approved.</strong> Then click <strong>Publish to Dashboard</strong>.</li>
              <li>TV and mobile dashboards update live.</li>
            </ul>
          </Step>
        </div>

        <div id="step-10">
          <Step n={10} title="Finalize the Race (if it's decided)">
            <ul>
              <li>Go to the <strong>Race detail page</strong> (Election → Race).</li>
              <li>Click <strong>Finalize Race</strong>. Enter Super Admin PIN.</li>
            </ul>
            <Callout kind="warning">
              Race finalization is <strong>refused</strong> if any round in the race is still <Pill kind="blue">Voting Open</Pill> or
              <Pill kind="amber">Tallying</Pill>. Finalize or void those rounds first. Rounds in <em>Ready</em> or
              <em> Needs Action</em> are auto-canceled — they have no committed work.
            </Callout>
          </Step>
        </div>
      </Section>

      <Section id="status" title="Status Cheat Sheet">
        <Table
          headers={['Badge', 'What it means', 'Next button']}
          rows={[
            [<Pill kind="green">Ready</Pill>, 'Round set up, not voting', <code>Open Voting</code>],
            [<Pill kind="blue">Voting Open</Pill>, 'Voters voting', <code>Close Voting</code>],
            [<Pill kind="purple">Voting Closed</Pill>, 'No more votes accepted', <code>Open for Tallying</code>],
            [<Pill kind="amber">Tallying</Pill>, 'Scanning + review in progress', <code>Start Pass / Complete Pass</code>],
            [<Pill kind="indigo">Round Finalized</Pill>, 'Confirmed by Judge + Chair decided', <code>Publish to Dashboard</code>],
            [<Pill kind="green">Published</Pill>, 'Live on public dashboard', <em>Done — Unpublish only if needed</em>],
          ]}
        />
      </Section>

      <Section id="pins" title="Things That Need a Super Admin PIN">
        <p>The PIN is bound to <strong>the logged-in super admin</strong> — your own PIN, not a co-admin's.</p>
        <ul>
          <li><strong>Judge Confirm Results</strong> on the Confirmation page <Pill>v0.168</Pill></li>
          <li><strong>Finalize Round &amp; Move to Next</strong> on the Chair Decision page</li>
          <li><strong>Finalize Race / Cancel Race</strong> on the Race detail page only <Pill>v0.171–v0.172</Pill></li>
          <li>Delete a pass</li>
          <li>Reset spoiled ballots</li>
          <li>Recount round (destructive)</li>
          <li>Reverse finalization</li>
          <li>Void round</li>
          <li>Count a wrong-round ballot</li>
        </ul>
      </Section>

      <Section id="reminders" title="Day-of Reminders">
        <ul>
          <li><strong>Pass 1 and Pass 2 are both required</strong> before you can confirm.</li>
          <li><strong>Both review queues must be empty</strong> before the comparison numbers settle.</li>
          <li><strong>The Chair approves results before publishing.</strong> Always.</li>
          <li>If something looks wrong, <strong>stop and ask</strong> — don't override a mismatch without understanding it (see <a href="/admin/guides/faq">FAQ</a>).</li>
        </ul>
      </Section>
    </GuideLayout>
  );
}
