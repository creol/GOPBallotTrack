import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

const BALLOT_SIZES = [
  { value: 'letter', label: 'Letter (8.5" x 11") — 1 per page' },
  { value: 'half_letter', label: 'Half Letter (5.5" x 8.5") — 2 per page' },
  { value: 'quarter_letter', label: 'Quarter Letter (4.25" x 5.5") — 4 per page' },
  { value: 'eighth_letter', label: '1/8 Letter (2.75" x 4.25") — 8 per page' },
];

export default function RoundDetail() {
  const { id: electionId, raceId, roundId } = useParams();
  const [round, setRound] = useState(null);
  const [quantity, setQuantity] = useState(50);
  const [size, setSize] = useState('letter');
  const [logo, setLogo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [ballotStatus, setBallotStatus] = useState(null); // { generated, serial_count, pdf_exists }
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [testGenCount, setTestGenCount] = useState(10);
  const [testBadPct, setTestBadPct] = useState(10);
  const [generatingTest, setGeneratingTest] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);

  const fetchRound = async () => {
    const { data } = await api.get(`/admin/rounds/${roundId}`);
    setRound(data);
  };

  const fetchBallotStatus = async () => {
    try {
      const { data } = await api.get(`/admin/rounds/${roundId}/ballot-status`);
      setBallotStatus(data);
    } catch {
      setBallotStatus({ has_serials: false, serial_count: 0, pdf_exists: false });
    }
  };

  const fetchFlaggedCount = async () => {
    try {
      const { data } = await api.get(`/rounds/${roundId}/reviewed-ballots?status=unresolved`);
      setFlaggedCount(Array.isArray(data) ? data.length : 0);
    } catch {}
  };

  useEffect(() => { fetchRound(); fetchBallotStatus(); fetchFlaggedCount(); }, [roundId]);

  const handleGenerate = async (e) => {
    e.preventDefault();

    // If PDF already exists, require confirmation to regenerate
    if (ballotStatus?.pdf_exists && !showRegenerate) {
      setShowRegenerate(true);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const formData = new FormData();
      // Only send quantity if no pre-existing SNs
      if (!ballotStatus?.has_serials) formData.append('quantity', quantity);
      formData.append('size', size);
      if (logo) formData.append('logo', logo);
      if (ballotStatus?.pdf_exists) formData.append('confirm_regenerate', 'true');

      await api.post(`/admin/rounds/${roundId}/generate-ballots`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowRegenerate(false);
      setPreviewUrl(`/api/admin/rounds/${roundId}/ballot-preview?t=${Date.now()}`);
      fetchBallotStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate ballots');
    } finally {
      setGenerating(false);
    }
  };

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', voting_open: '#3b82f6', voting_closed: '#8b5cf6', tallying: '#f59e0b', round_finalized: '#6366f1', canceled: '#6b7280' };
  const hasSerials = ballotStatus?.has_serials;
  const hasPdf = ballotStatus?.pdf_exists;

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: round.race?.election?.name || 'Election', to: `/admin/elections/${electionId}` },
      { label: round.race?.name || 'Race', to: `/admin/elections/${electionId}/races/${raceId}` },
      { label: `Round ${round.round_number}` },
    ]}>

      <div style={styles.header}>
        <div>
          <h1>Round {round.round_number}</h1>
          <p style={styles.muted}>Paper color: {round.paper_color}</p>
        </div>
        <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
          {round.status}
        </span>
      </div>

      {/* Results summary — shown at top when available */}
      {round.results && round.results.length > 0 && (
        <div style={styles.resultsPanel}>
          <h2 style={styles.resultsPanelTitle}>Results</h2>
          {round.results.map(r => {
            const pct = Number(r.percentage);
            return (
              <div key={r.id} style={styles.tvResultRow}>
                <span style={styles.tvCandidateName}>{r.candidate_name}</span>
                <div style={styles.tvBarContainer}>
                  <div style={{ ...styles.tvBar, width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span style={styles.tvVoteCount}>{r.vote_count}</span>
                <span style={styles.tvPct}>{pct.toFixed(5)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Workflow Steps */}
      <div style={styles.workflowSection}>
        <WorkflowStep
          number={1}
          title="Scan Ballots"
          description="Feed ballots through the ADF scanner or use the phone scanner"
          done={round.passes?.some(p => p.status === 'complete')}
          active={['pending_needs_action', 'ready', 'tallying'].includes(round.status)}
        >
          <Link to={`/scan/${roundId}`} style={styles.btnLink}>Open Scanner</Link>
          <a href={`/api/admin/rounds/${roundId}/calibration-pdf`} style={{ ...styles.btnSmall, textDecoration: 'none' }} target="_blank">Calibration PDF</a>
          <button style={styles.btnSmall} onClick={() => setShowTestGen(!showTestGen)}>
            {showTestGen ? 'Hide Test Tools' : 'Generate Test Ballots'}
          </button>
          {showTestGen && (
            <div style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Count:</label>
                <input type="number" min="1" max="500" value={testGenCount} onChange={e => setTestGenCount(parseInt(e.target.value) || 10)}
                  style={{ width: 60, padding: '0.3rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }} />
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Bad fill %:</label>
                <input type="number" min="0" max="100" value={testBadPct} onChange={e => setTestBadPct(parseInt(e.target.value) || 0)}
                  style={{ width: 50, padding: '0.3rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }} />
                <button
                  style={{ ...styles.btnSmall, background: '#7c3aed', color: '#fff', opacity: generatingTest ? 0.6 : 1 }}
                  disabled={generatingTest}
                  onClick={async () => {
                    setGeneratingTest(true);
                    try {
                      const { data } = await api.post(`/admin/rounds/${roundId}/generate-test-ballots`, {
                        count: testGenCount, bad_fill_percentage: testBadPct,
                      });
                      alert(`Generated ${data.total} test ballots (${data.bad_fills} bad fills) in:\n${data.output_dir}`);
                    } catch (err) {
                      alert('Failed: ' + (err.response?.data?.error || err.message));
                    } finally {
                      setGeneratingTest(false);
                    }
                  }}
                >
                  {generatingTest ? 'Generating...' : 'Generate'}
                </button>
              </div>
              <p style={{ color: '#666', fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
                Creates filled ballot images from the real PDF for scanner testing. Bad fills simulate partial/light marks.
              </p>
              <a href={`/api/admin/rounds/${roundId}/test-ballot-preview`} target="_blank"
                style={{ color: '#2563eb', fontSize: '0.8rem' }}>Preview test ballot</a>
            </div>
          )}
        </WorkflowStep>

        {flaggedCount > 0 && (
          <WorkflowStep
            number={2}
            title={`Review Ballots (${flaggedCount})`}
            description="Ballots needing manual review — resolve all before finalizing"
            done={false}
            active={true}
          >
            <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/review`}
              style={{ ...styles.btnLink, background: '#dc2626' }}>
              Review Ballots ({flaggedCount})
            </Link>
          </WorkflowStep>
        )}

        <WorkflowStep
          number={flaggedCount > 0 ? 3 : 2}
          title="Confirm Results"
          description="Compare pass counts and confirm the results are accurate"
          done={['round_finalized'].includes(round.status)}
          active={['tallying', 'voting_closed'].includes(round.status)}
        >
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/confirm`} style={styles.btnLinkGreen}>
            Confirm Round
          </Link>
        </WorkflowStep>

        <WorkflowStep
          number={flaggedCount > 0 ? 4 : 3}
          title="Preview & Release"
          description="Preview what the public will see, then release the results"
          done={!!round.published_at}
          active={['round_finalized'].includes(round.status) && !round.published_at}
        >
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`} style={styles.btnLinkPurple}>
            Preview & Release
          </Link>
        </WorkflowStep>

        {['round_finalized'].includes(round.status) && (
          <WorkflowStep
            number={flaggedCount > 0 ? 5 : 4}
            title="Download Results"
            description="Download the official results PDF"
            done={false}
            active={true}
          >
            <a href={`/api/admin/rounds/${roundId}/results-pdf`} style={styles.btnLinkGreen} download>
              Download Results PDF
            </a>
          </WorkflowStep>
        )}
      </div>

      {/* Additional Links */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link to={`/admin/rounds/${roundId}/boxes`} style={styles.btnLink}>Ballot Box Breakdown</Link>
      </div>

      {/* Pass Management */}
      <PassManager roundId={roundId} onUpdate={fetchRound} />

      {/* Ballots Section */}
      <div style={styles.section}>
        <h2>Ballots</h2>

        {/* State: SNs exist + PDF exists → download */}
        {hasSerials && hasPdf && (
          <>
            <div style={styles.generatedBanner}>
              <strong>{ballotStatus.serial_count} serial numbers &nbsp;|&nbsp; PDF ready</strong>
              {ballotStatus.generated_at && (
                <p style={styles.muted}>
                  Generated: {new Date(ballotStatus.generated_at).toLocaleString()}
                </p>
              )}
              <p style={styles.muted}>
                The PDF and serial numbers are saved. Download and print at any time —
                the serial numbers will not change.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
              <a href={`/api/admin/rounds/${roundId}/ballot-pdf`} style={styles.btnDownloadLarge} download>
                Download Ballot PDF
              </a>
              <a href={`/api/admin/rounds/${roundId}/ballot-data`} style={styles.btnDownload} download>
                Download Data ZIP
              </a>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <iframe src={previewUrl || `/api/admin/rounds/${roundId}/ballot-preview`}
                style={styles.previewFrame} title="Ballot Preview" />
            </div>

            {/* Regenerate PDF with different size — hidden behind button */}
            <div style={{ marginTop: '1.5rem' }}>
              {!showRegenerate ? (
                <button style={styles.btnDangerSmall} onClick={() => setShowRegenerate(true)}>
                  Regenerate PDF with different size...
                </button>
              ) : (
                <div style={styles.warningBox}>
                  <h3 style={{ margin: '0 0 0.5rem', color: '#dc2626' }}>Regenerate PDF</h3>
                  <p style={{ margin: '0 0 0.75rem', color: '#374151' }}>
                    This will overwrite the existing PDF using the same serial numbers but a different size layout.
                  </p>
                  <form onSubmit={handleGenerate} style={styles.genForm}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Ballot Size</label>
                      <select style={styles.input} value={size} onChange={e => setSize(e.target.value)}>
                        {BALLOT_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button style={{ ...styles.btnDanger, opacity: generating ? 0.6 : 1 }} type="submit" disabled={generating}>
                        {generating ? 'Generating...' : 'Regenerate PDF'}
                      </button>
                      <button style={styles.btnSmall} type="button" onClick={() => setShowRegenerate(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </>
        )}

        {/* State: SNs exist but no PDF yet → generate PDF */}
        {hasSerials && !hasPdf && (
          <>
            <div style={styles.generatedBanner}>
              <strong>{ballotStatus.serial_count} serial numbers ready</strong>
              <p style={styles.muted}>
                Serial numbers were generated when this round was created. Choose a ballot size to generate the printable PDF.
              </p>
            </div>

            <form onSubmit={handleGenerate} style={{ ...styles.genForm, marginTop: '0.75rem' }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Ballot Size</label>
                <select style={styles.input} value={size} onChange={e => setSize(e.target.value)}>
                  {BALLOT_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Logo (optional)</label>
                <input style={styles.input} type="file" accept="image/*"
                  onChange={e => setLogo(e.target.files[0] || null)} />
              </div>
              <button style={{ ...styles.btnPrimary, opacity: generating ? 0.6 : 1 }} type="submit" disabled={generating}>
                {generating ? 'Generating...' : 'Generate Ballot PDF'}
              </button>
            </form>
          </>
        )}

        {/* State: No SNs at all → full generate form (legacy / no ballot_count on race) */}
        {!hasSerials && (
          <>
            <p style={styles.muted}>
              No serial numbers for this round. Set ballot count when creating the race to auto-generate, or enter a quantity below.
            </p>
            <form onSubmit={handleGenerate} style={styles.genForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Quantity</label>
                <input style={styles.input} type="number" min="1" max="5000" value={quantity}
                  onChange={e => setQuantity(parseInt(e.target.value) || 1)} required />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Ballot Size</label>
                <select style={styles.input} value={size} onChange={e => setSize(e.target.value)}>
                  {BALLOT_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Logo (optional)</label>
                <input style={styles.input} type="file" accept="image/*"
                  onChange={e => setLogo(e.target.files[0] || null)} />
              </div>
              <button style={{ ...styles.btnPrimary, opacity: generating ? 0.6 : 1 }} type="submit" disabled={generating}>
                {generating ? 'Generating...' : 'Generate Ballots'}
              </button>
            </form>
          </>
        )}

        {error && <p style={styles.errorMsg}>{error}</p>}
      </div>
    </ElectionLayout>
  );
}

function PassManager({ roundId, onUpdate }) {
  const [passes, setPasses] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchPasses = async () => {
    try {
      const { data } = await api.get(`/rounds/${roundId}/passes`);
      setPasses(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => {
    fetchPasses();
    const interval = setInterval(fetchPasses, 3000); // poll every 3s for ADF updates
    return () => clearInterval(interval);
  }, [roundId]);

  const handleComplete = async (passId, passNumber) => {
    if (!confirm(`Complete Pass ${passNumber}? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await api.put(`/passes/${passId}/complete`);
      fetchPasses();
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('Failed to complete pass: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post(`/rounds/${roundId}/passes`);
      fetchPasses();
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('Failed to create pass: ' + (err.response?.data?.error || err.message));
    }
  };

  const activePasses = passes.filter(p => p.status === 'active');
  const completedPasses = passes.filter(p => p.status === 'complete');

  return (
    <div style={styles.section}>
      <h2>Passes</h2>

      {passes.length === 0 && (
        <p style={styles.muted}>No passes yet. Scans from the ADF scanner will auto-create a pass.</p>
      )}

      {activePasses.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem',
          border: '2px solid #3b82f6', borderRadius: 8, background: '#eff6ff', marginBottom: '0.5rem',
        }}>
          <span style={{ fontWeight: 700 }}>Pass {p.pass_number}</span>
          <span style={{
            background: '#dbeafe', color: '#1e40af', padding: '2px 10px', borderRadius: 12,
            fontWeight: 600, fontSize: '0.85rem',
          }}>{p.scan_count || 0} scans</span>
          <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>Active</span>
          <button
            style={{
              marginLeft: 'auto', padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
            onClick={() => handleComplete(p.id, p.pass_number)}
            disabled={loading}
          >
            {loading ? 'Completing...' : 'Complete Pass'}
          </button>
        </div>
      ))}

      {completedPasses.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
          borderBottom: '1px solid #eee',
        }}>
          <span style={{ fontWeight: 600 }}>Pass {p.pass_number}</span>
          <span style={styles.muted}>{p.scan_count || 0} scans</span>
          <span style={{ color: '#16a34a', fontSize: '0.82rem' }}>✓ Complete</span>
        </div>
      ))}

      {activePasses.length === 0 && (
        <button style={{ ...styles.btnPrimary, marginTop: '0.5rem' }} onClick={handleCreate}>
          Start Pass {passes.length + 1}
        </button>
      )}
    </div>
  );
}

function WorkflowStep({ number, title, description, done, active, children }) {
  return (
    <div style={{
      display: 'flex', gap: '0.75rem', padding: '0.75rem', marginBottom: '0.5rem',
      borderRadius: 8, border: '1px solid',
      borderColor: done ? '#86efac' : active ? '#93c5fd' : '#e5e7eb',
      background: done ? '#f0fdf4' : active ? '#eff6ff' : '#f9fafb',
      opacity: done ? 0.7 : 1,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.8rem', fontWeight: 700, flexShrink: 0,
        background: done ? '#16a34a' : active ? '#2563eb' : '#d1d5db',
        color: '#fff',
      }}>
        {done ? '✓' : number}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.15rem' }}>{title}</div>
        <div style={{ color: '#666', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{description}</div>
        {!done && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{children}</div>}
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  workflowSection: { marginBottom: '1.5rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '2rem' },
  passRow: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  resultsPanel: { background: '#1e293b', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid #334155' },
  resultsPanelTitle: { margin: '0 0 1rem', fontSize: '1.25rem', color: '#fff' },
  tvResultRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' },
  tvCandidateName: { width: 140, fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' },
  tvBarContainer: { flex: 1, height: 20, background: '#334155', borderRadius: 10, overflow: 'hidden' },
  tvBar: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 10, transition: 'width 0.8s ease' },
  tvVoteCount: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#fff' },
  tvPct: { width: 80, textAlign: 'right', color: '#94a3b8', fontSize: '0.85rem' },
  genForm: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 400 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontWeight: 600, fontSize: '0.85rem' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  generatedBanner: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem' },
  warningBox: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem' },
  previewFrame: { width: '100%', height: 500, border: '1px solid #ddd', borderRadius: 4 },
  statusBadge: { color: '#fff', padding: '4px 12px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 },
  btnPrimary: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem', alignSelf: 'flex-start' },
  btnDownloadLarge: { padding: '0.75rem 1.5rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1.05rem', fontWeight: 700, textDecoration: 'none', display: 'inline-block' },
  btnDownload: { padding: '0.5rem 1rem', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-block' },
  btnLink: { padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  btnLinkGreen: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  btnLinkPurple: { padding: '0.5rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  btnDanger: { padding: '0.6rem 1.2rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem' },
  btnDangerSmall: { padding: '0.35rem 0.75rem', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnSmall: { padding: '0.4rem 0.8rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.5rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
