import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

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
      const { data } = await api.get(`/rounds/${roundId}/flagged`);
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

  const statusColor = { pending: '#f59e0b', scanning: '#3b82f6', confirmed: '#10b981', pending_release: '#8b5cf6', released: '#6366f1' };
  const hasSerials = ballotStatus?.has_serials;
  const hasPdf = ballotStatus?.pdf_exists;

  return (
    <div style={styles.container}>
      <Link to={`/admin/elections/${electionId}/races/${raceId}`} style={styles.backLink}>
        &larr; Back to {round.race?.name || 'Race'}
      </Link>

      <div style={styles.header}>
        <div>
          <h1>Round {round.round_number}</h1>
          <p style={styles.muted}>Paper color: {round.paper_color}</p>
        </div>
        <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
          {round.status}
        </span>
      </div>

      {/* Workflow Steps */}
      <div style={styles.workflowSection}>
        <WorkflowStep
          number={1}
          title="Scan Ballots"
          description="Feed ballots through the ADF scanner or use the phone scanner"
          done={round.passes?.some(p => p.status === 'complete')}
          active={['pending', 'scanning'].includes(round.status)}
        >
          <Link to={`/scan/${roundId}`} style={styles.btnLink}>Open Scanner</Link>
          <a href={`/api/admin/rounds/${roundId}/calibration-pdf`} style={{ ...styles.btnSmall, textDecoration: 'none' }} target="_blank">Calibration PDF</a>
        </WorkflowStep>

        {flaggedCount > 0 && (
          <WorkflowStep
            number={2}
            title={`Review Flagged Ballots (${flaggedCount})`}
            description="Ballots that couldn't be read automatically need manual review"
            done={false}
            active={true}
          >
            <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/review`}
              style={{ ...styles.btnLink, background: '#dc2626' }}>
              Review Flagged ({flaggedCount})
            </Link>
          </WorkflowStep>
        )}

        <WorkflowStep
          number={flaggedCount > 0 ? 3 : 2}
          title="Confirm Results"
          description="Compare pass counts and confirm the results are accurate"
          done={['confirmed', 'pending_release', 'released'].includes(round.status)}
          active={['scanning', 'pending'].includes(round.status)}
        >
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/confirm`} style={styles.btnLinkGreen}>
            Confirm Round
          </Link>
        </WorkflowStep>

        <WorkflowStep
          number={flaggedCount > 0 ? 4 : 3}
          title="Preview & Release"
          description="Preview what the public will see, then release the results"
          done={round.status === 'released'}
          active={['confirmed', 'pending_release'].includes(round.status)}
        >
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`} style={styles.btnLinkPurple}>
            Preview & Release
          </Link>
        </WorkflowStep>

        {['confirmed', 'pending_release', 'released'].includes(round.status) && (
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

      {/* Scanner → Box Assignment */}
      <ScannerBoxAssignment electionId={electionId} roundId={roundId} />

      {/* Passes summary */}
      {round.passes && round.passes.length > 0 && (
        <div style={styles.section}>
          <h2>Passes</h2>
          {round.passes.map(p => (
            <div key={p.id} style={styles.passRow}>
              <span>Pass {p.pass_number}</span>
              <span style={styles.muted}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Results summary */}
      {round.results && round.results.length > 0 && (
        <div style={styles.section}>
          <h2>Results</h2>
          {round.results.map(r => (
            <div key={r.id} style={styles.resultRow}>
              <span style={{ fontWeight: 600 }}>{r.candidate_name}</span>
              <span>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
            </div>
          ))}
        </div>
      )}

      {/* Ballots Section */}
      <div style={styles.section}>
        <h2>Ballots</h2>

        {/* State: SNs exist + PDF exists → download */}
        {hasSerials && hasPdf && (
          <>
            <div style={styles.generatedBanner}>
              <strong>{ballotStatus.serial_count} serial numbers &nbsp;|&nbsp; PDF ready</strong>
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

function ScannerBoxAssignment({ electionId, roundId }) {
  const [scanners, setScanners] = useState([]);
  const [boxes, setBoxes] = useState([]);

  const fetchData = async () => {
    try {
      const [scRes, bxRes] = await Promise.all([
        api.get(`/admin/elections/${electionId}/scanners`),
        api.get(`/admin/elections/${electionId}/ballot-boxes`),
      ]);
      setScanners(scRes.data);
      setBoxes(bxRes.data);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [electionId]);

  const handleAssign = async (scannerId, boxId) => {
    await api.put(`/admin/scanners/${scannerId}/assign-box`, { box_id: boxId || null });
    fetchData();
  };

  if (scanners.length === 0) return null;

  return (
    <div style={styles.section}>
      <h2>Scanner → Box Assignment</h2>
      {scanners.map(sc => (
        <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 600, width: 120 }}>{sc.name}</span>
          <span style={styles.muted}>→</span>
          <select style={styles.input} value={sc.current_box_id || ''}
            onChange={e => handleAssign(sc.id, e.target.value ? parseInt(e.target.value) : null)}>
            <option value="">No box assigned</option>
            {boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      ))}
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
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
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
