import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function ChairDecision() {
  const { id: electionId, raceId, roundId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [chairName, setChairName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [hasPreviewedOnce, setHasPreviewedOnce] = useState(false);
  const [released, setReleased] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [eliminated, setEliminated] = useState(new Set());

  const fetchData = async () => {
    try {
      const { data: decision } = await api.get(`/rounds/${roundId}/chair-decision`);
      setData(decision);
      if (decision.round.status === 'released') setReleased(true);
      // Track which candidates are already withdrawn
      const { data: cands } = await api.get(`/admin/races/${raceId}/candidates`);
      setEliminated(new Set(cands.filter(c => c.status === 'withdrawn').map(c => c.id)));
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
      await api.post(`/rounds/${roundId}/release`, { released_by_name: chairName });
      setReleased(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (candidateId, candidateName) => {
    if (!confirm(`Eliminate ${candidateName}? They will not appear as a candidate in the next round.`)) return;
    try {
      await api.put(`/admin/candidates/${candidateId}/withdraw`);
      setEliminated(prev => new Set([...prev, candidateId]));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to eliminate candidate');
    }
  };

  const handleCreateNextRound = async () => {
    const color = prompt('Paper color for the next round:');
    if (!color) return;
    try {
      const { data: newRound } = await api.post(`/admin/races/${raceId}/rounds`, { paper_color: color });
      navigate(`/admin/elections/${electionId}/races/${raceId}/rounds/${newRound.id}`);
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

      <h1>Results — Round {data.round.round_number}</h1>
      <p style={styles.muted}>{data.race.name} — {data.election.name}</p>

      {released && (
        <div style={styles.releasedBanner}>Results have been released to the public.</div>
      )}

      {/* Results Table */}
      <div style={styles.section}>
        <h2>Results</h2>
        <p style={styles.muted}>Total votes: {data.total_votes}</p>

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
              const isEliminated = eliminated.has(r.candidate_id);
              return (
                <tr key={r.candidate_id} style={{
                  background: isEliminated ? '#fef2f2' : '',
                  opacity: isEliminated ? 0.6 : 1,
                }}>
                  <td style={styles.td}>
                    <strong style={isEliminated ? { textDecoration: 'line-through' } : {}}>
                      {r.candidate_name}
                    </strong>
                    {isEliminated && <span style={styles.eliminatedBadge}>Eliminated</span>}
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
                    {!released && !isEliminated && (
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

      {/* Release Section */}
      {!released && (
        <div style={styles.section}>
          <h2>Release Results</h2>

          <button
            style={styles.btnPreview}
            onClick={() => { setShowPreview(!showPreview); setHasPreviewedOnce(true); }}
          >
            {showPreview ? 'Close Preview' : 'Preview Public Dashboard'}
          </button>

          {showPreview && (
            <div style={styles.previewPanel}>
              <h3 style={{ marginTop: 0 }}>Public View Preview</h3>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{data.election.name} — {data.race.name} — Round {data.round.round_number}</p>
              {data.results.map(r => {
                const isElim = eliminated.has(r.candidate_id);
                return (
                  <div key={r.candidate_id} style={{ ...styles.previewRow, opacity: isElim ? 0.5 : 1 }}>
                    <span style={{ flex: 1, fontWeight: 600, textDecoration: isElim ? 'line-through' : 'none' }}>
                      {r.candidate_name}
                      {isElim && <span style={{ color: '#f87171', fontSize: '0.75rem', marginLeft: '0.5rem' }}>ELIMINATED</span>}
                    </span>
                    <span>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
                  </div>
                );
              })}
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{data.serials.length} ballots counted</p>
            </div>
          )}

          {hasPreviewedOnce && (
            <div style={styles.releaseBox}>
              <input style={styles.input} placeholder="Your name" value={chairName}
                onChange={e => setChairName(e.target.value)} />
              <button style={{ ...styles.btnRelease, opacity: submitting ? 0.6 : 1 }}
                onClick={handleRelease} disabled={submitting}>
                {submitting ? 'Releasing...' : 'Release to Public'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Race Decision */}
      <div style={styles.section}>
        <h2>Race Decision</h2>

        {eliminated.size > 0 && (
          <p style={styles.muted}>{eliminated.size} candidate(s) eliminated so far.</p>
        )}

        <div style={styles.decisionGrid}>
          {/* Declare Winner */}
          <DecisionCard
            title="Declare Winner"
            description="Select the winning candidate to close this race"
            color="#16a34a"
          >
            <select style={styles.input} id="winner-select" defaultValue="">
              <option value="" disabled>Select winner...</option>
              {data.results.filter(r => !eliminated.has(r.candidate_id)).map(r => (
                <option key={r.candidate_id} value={r.candidate_id}>{r.candidate_name}</option>
              ))}
            </select>
            <button style={styles.btnSuccess} onClick={async () => {
              const sel = document.getElementById('winner-select');
              if (!sel.value) return alert('Select a candidate');
              if (!confirm(`Declare ${sel.options[sel.selectedIndex].text} as the winner?`)) return;
              await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'winner', candidate_id: parseInt(sel.value) });
              alert('Winner declared. Race is complete.');
              fetchData();
            }}>Declare Winner</button>
          </DecisionCard>

          {/* Advance to Next Round */}
          <DecisionCard
            title="Advance to Next Round"
            description="No winner yet — continue with another round of voting"
            color="#2563eb"
          >
            <button style={styles.btnPrimary} onClick={async () => {
              await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'advances_next_round' });
              handleCreateNextRound();
            }}>Create Next Round</button>
          </DecisionCard>

          {/* Advances to Primary */}
          <DecisionCard
            title="Advances to Primary"
            description="Top candidates advance to a primary election"
            color="#7c3aed"
          >
            <button style={{ ...styles.btnPrimary, background: '#7c3aed' }} onClick={async () => {
              const notes = prompt('Notes (which candidates advance, primary details):');
              await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'advances_primary', notes });
              alert('Race marked as advancing to primary.');
              fetchData();
            }}>Mark as Advancing to Primary</button>
          </DecisionCard>

          {/* Close Race */}
          <DecisionCard
            title="Close Race"
            description="End this race without a winner. Cancels any future rounds."
            color="#dc2626"
          >
            <button style={styles.btnDangerLarge} onClick={async () => {
              const notes = prompt('Reason for closing (optional):');
              if (!confirm('Close this race? All pending rounds will be cancelled.')) return;
              await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'closed', notes });
              alert('Race closed.');
              fetchData();
            }}>Close Race</button>
          </DecisionCard>
        </div>
      </div>

      {error && <p style={styles.errorMsg}>{error}</p>}
    </div>
  );
}

function DecisionCard({ title, description, color, children }) {
  return (
    <div style={{ border: `2px solid ${color}20`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: '1rem', background: '#fff' }}>
      <h3 style={{ margin: '0 0 0.25rem', color, fontSize: '1rem' }}>{title}</h3>
      <p style={{ color: '#666', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>{description}</p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>
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
  eliminatedBadge: { marginLeft: '0.5rem', background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700 },
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
  btnDangerLarge: { padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSuccess: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  decisionGrid: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.75rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
};
