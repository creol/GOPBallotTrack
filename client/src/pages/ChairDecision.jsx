import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

export default function ChairDecision() {
  const { id: electionId, raceId, roundId } = useParams();
  const [data, setData] = useState(null);
  const [chairName, setChairName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [hasPreviewedOnce, setHasPreviewedOnce] = useState(false);
  const [released, setReleased] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      const { data: decision } = await api.get(`/api/rounds/${roundId}/chair-decision`);
      setData(decision);
      if (decision.round.status === 'released') setReleased(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    }
  };

  useEffect(() => { fetchData(); }, [roundId]);

  const handleRelease = async () => {
    if (!chairName.trim()) { setError('Please enter your name'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/rounds/${roundId}/release`, { released_by_name: chairName });
      setReleased(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (candidateId, candidateName) => {
    if (!confirm(`Eliminate ${candidateName} from this race?`)) return;
    try {
      await api.put(`/admin/candidates/${candidateId}/withdraw`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to withdraw candidate');
    }
  };

  const handleCreateNextRound = async () => {
    const color = prompt('Paper color for next round:');
    if (!color) return;
    try {
      await api.post(`/admin/races/${raceId}/rounds`, { paper_color: color });
      alert('Next round created. Navigate to it from the race detail page.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create round');
    }
  };

  if (!data) return <div style={styles.container}><p>{error || 'Loading...'}</p></div>;

  return (
    <div style={styles.container}>
      <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}`} style={styles.backLink}>
        &larr; Back to Round
      </Link>

      <h1>Chair Decision — Round {data.round.round_number}</h1>
      <p style={styles.muted}>{data.race.name} — {data.election.name}</p>

      {released && (
        <div style={styles.releasedBanner}>Results have been released to the public.</div>
      )}

      {/* Results Table */}
      <div style={styles.section}>
        <h2>Results</h2>
        <p style={styles.muted}>
          Threshold: {data.threshold_type === 'custom'
            ? `${data.threshold_value}%`
            : data.threshold_type.replace('_', ' ')} ({data.threshold_value.toFixed(2)}%)
          &nbsp;|&nbsp; Total votes: {data.total_votes}
        </p>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Candidate</th>
              <th style={styles.th}>Votes</th>
              <th style={styles.th}>Percentage</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {data.results.map(r => {
              const pct = Number(r.percentage);
              const isWinner = pct > data.threshold_value;
              return (
                <tr key={r.candidate_id} style={isWinner ? { background: '#f0fdf4' } : {}}>
                  <td style={styles.td}>
                    <strong>{r.candidate_name}</strong>
                    {isWinner && <span style={styles.winnerBadge}>Winner</span>}
                  </td>
                  <td style={styles.td}>{r.vote_count}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={styles.barBg}>
                        <div style={{ ...styles.barFill, width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{pct.toFixed(5)}%</span>
                    </div>
                  </td>
                  <td style={styles.td}>
                    {!released && !isWinner && (
                      <button style={styles.btnDanger} onClick={() => handleWithdraw(r.candidate_id, r.candidate_name)}>
                        Eliminate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview & Release */}
      {!released && (
        <div style={styles.section}>
          <h2>Release to Public</h2>

          <button
            style={styles.btnPreview}
            onClick={() => { setShowPreview(!showPreview); setHasPreviewedOnce(true); }}
          >
            {showPreview ? 'Close Preview' : 'Preview Public Dashboard'}
          </button>

          {showPreview && (
            <div style={styles.previewPanel}>
              <h3 style={{ marginTop: 0 }}>Public View Preview</h3>
              <p style={styles.muted}>{data.election.name} — {data.race.name} — Round {data.round.round_number}</p>
              {data.results.map(r => (
                <div key={r.candidate_id} style={styles.previewRow}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{r.candidate_name}</span>
                  <span>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
                </div>
              ))}
              <p style={styles.muted}>{data.serials.length} ballots counted</p>
            </div>
          )}

          {hasPreviewedOnce && (
            <div style={styles.releaseBox}>
              <input
                style={styles.input}
                placeholder="Chair name"
                value={chairName}
                onChange={e => setChairName(e.target.value)}
              />
              <button
                style={{ ...styles.btnRelease, opacity: submitting ? 0.6 : 1 }}
                onClick={handleRelease}
                disabled={submitting}
              >
                {submitting ? 'Releasing...' : 'Release to Public'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Decision Buttons */}
      {!released && (
        <div style={styles.section}>
          <h2>Next Steps</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {data.has_winner ? (
              <div style={styles.winnerBanner}>
                <strong>{data.winner.candidate_name}</strong> has met the {data.threshold_type.replace('_', ' ')} threshold.
              </div>
            ) : (
              <>
                <button style={styles.btnPrimary} onClick={handleCreateNextRound}>Advance to Next Round</button>
                <p style={styles.muted}>Use "Eliminate" buttons in the results table to remove candidates before the next round.</p>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p style={styles.errorMsg}>{error}</p>}
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '2rem' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' },
  th: { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #e5e7eb', fontSize: '0.85rem' },
  td: { padding: '0.6rem 0.75rem', borderBottom: '1px solid #e5e7eb' },
  barBg: { flex: 1, height: 12, background: '#e5e7eb', borderRadius: 6, overflow: 'hidden', maxWidth: 200 },
  barFill: { height: '100%', background: '#3b82f6', borderRadius: 6 },
  winnerBadge: { marginLeft: '0.5rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700 },
  winnerBanner: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem', width: '100%' },
  releasedBanner: { background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 8, padding: '0.75rem', fontWeight: 600, color: '#1e40af', marginBottom: '1rem' },
  previewPanel: { background: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: '1rem', marginTop: '0.75rem' },
  previewRow: { display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #334155' },
  releaseBox: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  btnPreview: { padding: '0.5rem 1rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnRelease: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.75rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
};
