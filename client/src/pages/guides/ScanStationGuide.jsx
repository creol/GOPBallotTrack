import GuideLayout, { Section, Step, Callout, Pill, Table } from '../../components/GuideLayout';

const SECTIONS = [
  { id: 'setup',     label: '1. Set Up Your Station' },
  { id: 'wait',      label: '2. Wait for a Pass' },
  { id: 'scan',      label: '3. Scan Ballots' },
  { id: 'done',      label: '4. When the Stack Is Done' },
  { id: 'spoiled',   label: '5. Problem Ballots' },
  { id: 'donts',     label: 'Things You Should NOT Do' },
  { id: 'troubleshooting', label: 'Quick Troubleshooting' },
];

export default function ScanStationGuide() {
  return (
    <GuideLayout
      eyebrow="Convention Day Guide"
      title="Scan Station Quick Start"
      subtitle="You scan ballots. The Admin and the Judge decide what counts. If anything is weird, tell the Admin."
      audience="For Scan Operators"
      accent="#7c3aed"
      sections={SECTIONS}
    >
      <Callout kind="tip" title="The golden rule">
        When in doubt: <strong>stop scanning and ask the Admin.</strong> You will not break anything by pausing.
      </Callout>

      <Section id="setup" title="1. Set Up Your Station">
        <Step n={1} title="Open Station Setup">
          <p>From the BallotTrack site, go to <strong>Station Setup</strong>.</p>
        </Step>
        <Step n={2} title="Check the Agent Banner">
          <ul>
            <li><Pill kind="green">🟢 Green</Pill> = scanner agent is running. Good.</li>
            <li><Pill kind="amber">🟡 Yellow</Pill> = checking. Wait 10 seconds.</li>
            <li><Pill kind="red">🔴 Red</Pill> = agent not running. <strong>Double-click the BallotTrack Station shortcut on the desktop.</strong> Wait for green.</li>
          </ul>
        </Step>
        <Step n={3} title="Pick Your Round">
          <p>You'll see a list of <strong>active rounds</strong>. Find your race + round — it should match the paper color of the ballots in your stack.</p>
          <p>Click <strong>Start</strong> on that round.</p>
        </Step>
        <Callout kind="warning">
          If your round isn't in the list: the Admin hasn't opened tallying yet. <strong>Wait.</strong> Don't start without an assignment.
        </Callout>
      </Section>

      <Section id="wait" title="2. Wait for the Admin to Start a Pass">
        <p>The Scanner page shows: <em>"No active pass — waiting for admin to start a pass…"</em></p>
        <p>When the Admin clicks <strong>Start Pass N</strong>, the page updates and you can begin.</p>
      </Section>

      <Section id="scan" title="3. Scan Ballots">
        <Step n={1} title="Feed ballots one at a time">
          Front + back. The agent picks up each ballot automatically.
        </Step>
        <Step n={2} title="Watch your Local count climb">
          The Admin sees the <strong>Total</strong> across all stations.
        </Step>
        <Step n={3} title="Keep going until your stack is empty">
          Don't stop just because something looks odd — flagged ballots are handled later by the review team.
        </Step>
        <Callout kind="info" title="You won't see vote tallies">
          That's intentional — you're not supposed to know who's winning while you scan.
        </Callout>
      </Section>

      <Section id="done" title="4. When the Stack Is Done">
        <ul>
          <li>Tell the Admin you're finished.</li>
          <li>The Admin clicks <strong>Complete Pass</strong>. You're done with this pass.</li>
          <li>For Pass 2, repeat from Step 2 above.</li>
        </ul>
      </Section>

      <Section id="spoiled" title="5. Problem Ballots — Use the Spoiled Ballot Page">
        <p>Click the <strong>Spoiled Ballot</strong> link on the Scanner page.</p>
        <Table
          headers={['Situation', 'Spoil Type', 'Notes']}
          rows={[
            ['Ballot jammed or torn — won\'t feed', <Pill kind="amber">Unreadable / Jammed</Pill>, 'Type the SN if you can read it. Snap a photo with the camera if helpful.'],
            ['Voter clearly tried to undo their vote (scribbled out, "VOID" written, etc.)', <Pill kind="red">Intent Undermined</Pill>, 'Type the SN. Add notes describing what you saw.'],
          ]}
        />
        <p>Click <strong>Mark as Spoiled</strong>. The ballot is removed from the count.</p>
      </Section>

      <Section id="donts" title="Things You Should NOT Do">
        <Callout kind="danger">
          <ul style={{ margin: 0 }}>
            <li>❌ Don't start or complete a pass yourself (Admin only).</li>
            <li>❌ Don't delete a pass. Ever. (Tell the Admin.)</li>
            <li>❌ Don't try to "fix" a ballot that scanned wrong — flag it to the Admin so they can correct it on the Confirmation screen.</li>
            <li>❌ Don't hand-type a ballot serial number into the scanner — if the QR won't read, the ballot lands in <strong>Flagged Review</strong> and the Admin handles it.</li>
            <li>❌ Don't scan ballots from a different round / color into your station — they'll get flagged "Wrong Round" and create cleanup work.</li>
          </ul>
        </Callout>
      </Section>

      <Section id="troubleshooting" title="Quick Troubleshooting">
        <Table
          headers={['Symptom', 'Do this']}
          rows={[
            ['Agent banner is red', 'Double-click the desktop shortcut. Still red? Tell the Admin.'],
            ['Round not in the list', "Admin hasn't opened tallying yet. Wait."],
            ['Scanning but counts not going up', 'Check agent banner. If green, tell the Admin — could be a watch-folder problem.'],
            ['Ballot jammed', 'Clear the jam. Use Spoiled Ballot → Unreadable/Jammed.'],
            ['QR code damaged on the ballot', "Just feed it — the agent flags it for review. Don't try to enter it manually."],
            ['Scanned a ballot from the wrong round', "Tell the Admin immediately. Don't try to undo it yourself."],
          ]}
        />
      </Section>
    </GuideLayout>
  );
}
