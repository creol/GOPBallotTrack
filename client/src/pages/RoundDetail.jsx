import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import { useAuth } from '../context/AuthContext';

export default function RoundDetail() {
  const { id: electionId, raceId, roundId } = useParams();
  const [round, setRound] = useState(null);
  const [error, setError] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [spoiledCount, setSpoiledCount] = useState(0);
  const [resettingSpoiled, setResettingSpoiled] = useState(false);

  const fetchRound = async () => {
    const { data } = await api.get(`/admin/rounds/${roundId}`);
    setRound(data);
  };

  const fetchFlaggedCount = async () => {
    try {
      const { data } = await api.get(`/rounds/${roundId}/reviewed-ballots?status=unresolved`);
      setFlaggedCount(Array.isArray(data) ? data.length : 0);
    } catch {}
  };

  const fetchSpoiledCount = async () => {
    try {
      const { data } = await api.get(`/admin/rounds/${roundId}/ballot-serials-summary`);
      setSpoiledCount(data.spoiled || 0);
    } catch {}
  };

  const handleResetSpoiled = async () => {
    const name = prompt('Enter your name to log this action:');
    if (!name) return;
    if (!confirm(`Reset all ${spoiledCount} spoiled ballots in this round back to unused? They will be available to scan again.`)) return;
    setResettingSpoiled(true);
    try {
      const { data } = await api.put(`/admin/rounds/${roundId}/reset-spoiled`, { reset_by: name });
      alert(`${data.count} ballots reset to unused.`);
      fetchSpoiledCount();
      fetchRound();
    } catch (err) {
      alert('Reset failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setResettingSpoiled(false);
    }
  };

  useEffect(() => { fetchRound(); fetchFlaggedCount(); fetchSpoiledCount(); }, [roundId]);

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', voting_open: '#3b82f6', voting_closed: '#8b5cf6', tallying: '#f59e0b', round_finalized: '#6366f1', canceled: '#6b7280' };
  const statusLabel = { ready: 'Ready', voting_open: 'Voting Open', voting_closed: 'Voting Closed', tallying: 'Tallying', round_finalized: 'Finalized', canceled: 'Canceled' };

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
        {statusLabel[round.status] && (
          <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
            {statusLabel[round.status]}
          </span>
        )}
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
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <Link to={`/admin/rounds/${roundId}/boxes`} style={styles.btnLink}>Ballot Box Breakdown</Link>
        {spoiledCount > 0 && (
          <button
            style={{ padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, opacity: resettingSpoiled ? 0.6 : 1 }}
            onClick={handleResetSpoiled}
            disabled={resettingSpoiled}
          >
            {resettingSpoiled ? 'Resetting...' : `Reset ${spoiledCount} Spoiled Ballot${spoiledCount === 1 ? '' : 's'} to Unused`}
          </button>
        )}
      </div>

      {/* Pass Management */}
      <PassManager roundId={roundId} onUpdate={fetchRound} />

      {error && <p style={styles.errorMsg}>{error}</p>}
    </ElectionLayout>
  );
}

function PassManager({ roundId, onUpdate }) {
  const { auth } = useAuth();
  const isSuperAdmin = auth?.role === 'super_admin';
  const [passes, setPasses] = useState([]);
  const [stationCounts, setStationCounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchPasses = async () => {
    try {
      const [passesRes, countsRes] = await Promise.all([
        api.get(`/rounds/${roundId}/passes`),
        api.get(`/rounds/${roundId}/station-counts`),
      ]);
      setPasses(Array.isArray(passesRes.data) ? passesRes.data : []);
      setStationCounts(Array.isArray(countsRes.data) ? countsRes.data : []);
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

  const handleCancel = async (passId, passNumber, scanCount) => {
    const reason = prompt(`Why are you deleting Pass ${passNumber}? (${scanCount || 0} scans will be deleted, ballots reset to unused)`);
    if (!reason || !reason.trim()) return;
    const pin = prompt('Enter your PIN to confirm deletion:');
    if (!pin) return;
    setLoading(true);
    try {
      await api.delete(`/passes/${passId}`, { data: { deleted_reason: reason, confirm_pin: pin } });
      fetchPasses();
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('Failed to delete pass: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleReopen = async (passId, passNumber) => {
    const reason = prompt(`Why are you reopening Pass ${passNumber}?`);
    if (!reason || !reason.trim()) return;
    setLoading(true);
    try {
      await api.put(`/passes/${passId}/reopen`, { reason });
      fetchPasses();
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('Failed to reopen pass: ' + (err.response?.data?.error || err.message));
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
          }} title="Total uploads (any outcome)">{p.upload_count ?? p.scan_count ?? 0} scans</span>
          <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>Active</span>
          {isSuperAdmin && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button
                style={{
                  padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                  opacity: loading ? 0.6 : 1,
                }}
                onClick={() => handleCancel(p.id, p.pass_number, p.scan_count)}
                disabled={loading}
              >
                Delete Pass
              </button>
              <button
                style={{
                  padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                  opacity: loading ? 0.6 : 1,
                }}
                onClick={() => handleComplete(p.id, p.pass_number)}
                disabled={loading}
              >
                {loading ? 'Completing...' : 'Complete Pass'}
              </button>
            </div>
          )}
        </div>
      ))}

      {completedPasses.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
          borderBottom: '1px solid #eee',
        }}>
          <span style={{ fontWeight: 600 }}>Pass {p.pass_number}</span>
          <span style={styles.muted} title="Total uploads (any outcome)">{p.upload_count ?? p.scan_count ?? 0} scans</span>
          <span style={{ color: '#16a34a', fontSize: '0.82rem' }}>✓ Complete</span>
          {isSuperAdmin && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button
                style={{
                  padding: '0.3rem 0.6rem', background: '#dbeafe', color: '#1e40af',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                }}
                onClick={() => handleReopen(p.id, p.pass_number)}
                disabled={loading}
              >Reopen</button>
              <button
                style={{
                  padding: '0.3rem 0.6rem', background: '#fee2e2', color: '#dc2626',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                }}
                onClick={() => handleCancel(p.id, p.pass_number, p.scan_count)}
                disabled={loading}
              >Delete</button>
            </div>
          )}
        </div>
      ))}

      {isSuperAdmin && activePasses.length === 0 && (
        <button style={{ ...styles.btnPrimary, marginTop: '0.5rem' }} onClick={handleCreate}>
          Start Pass {passes.length + 1}
        </button>
      )}
      {!isSuperAdmin && activePasses.length === 0 && passes.length === 0 && (
        <p style={styles.muted}>Waiting for Super Admin to start a pass.</p>
      )}

      <StationCountsTable passes={passes} stationCounts={stationCounts} />
    </div>
  );
}

// Per-station × per-pass upload breakdown. Rows are stations, columns are passes,
// cells show total uploads (any outcome). "Unassigned" groups rows whose upload
// couldn't be bucketed into a pass (e.g. agent uploaded before a pass existed).
function StationCountsTable({ passes, stationCounts }) {
  if (!stationCounts || stationCounts.length === 0) return null;

  const nonDeletedPasses = passes.filter(p => p.status !== 'deleted');
  const passColumns = nonDeletedPasses.map(p => ({ id: p.id, label: `Pass ${p.pass_number}` }));
  const hasUnbucketed = stationCounts.some(r => r.pass_id == null);
  if (hasUnbucketed) passColumns.push({ id: null, label: 'Unassigned' });

  const stationIds = Array.from(new Set(stationCounts.map(r => r.station_id))).sort();
  const lookup = new Map();
  stationCounts.forEach(r => { lookup.set(`${r.station_id}|${r.pass_id ?? 'null'}`, r.uploads || 0); });

  const colTotal = (passId) =>
    stationCounts.filter(r => (r.pass_id ?? null) === passId).reduce((s, r) => s + (r.uploads || 0), 0);
  const rowTotal = (station) =>
    stationCounts.filter(r => r.station_id === station).reduce((s, r) => s + (r.uploads || 0), 0);
  const grandTotal = stationCounts.reduce((s, r) => s + (r.uploads || 0), 0);

  const th = { textAlign: 'left', padding: '0.5rem 0.75rem', background: '#f9fafb', fontSize: '0.82rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700 };
  const td = { padding: '0.4rem 0.75rem', fontSize: '0.88rem', borderBottom: '1px solid #f3f4f6' };
  const numeric = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Scans by Station</h3>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Station</th>
              {passColumns.map(c => (
                <th key={c.id ?? 'null'} style={{ ...th, textAlign: 'right' }}>{c.label}</th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {stationIds.map(sid => (
              <tr key={sid}>
                <td style={{ ...td, fontFamily: 'monospace' }}>{sid}</td>
                {passColumns.map(c => (
                  <td key={c.id ?? 'null'} style={numeric}>{lookup.get(`${sid}|${c.id ?? 'null'}`) || 0}</td>
                ))}
                <td style={{ ...numeric, fontWeight: 700 }}>{rowTotal(sid)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 700, background: '#f9fafb' }}>Total</td>
              {passColumns.map(c => (
                <td key={c.id ?? 'null'} style={{ ...numeric, fontWeight: 700, background: '#f9fafb' }}>{colTotal(c.id ?? null)}</td>
              ))}
              <td style={{ ...numeric, fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>{grandTotal}</td>
            </tr>
          </tbody>
        </table>
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{children}</div>
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
