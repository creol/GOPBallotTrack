import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

const CANDIDATE_OUTCOMES = [
  { value: '', label: '— No decision —' },
  { value: 'eliminated', label: 'Eliminated', color: '#ef4444', bg: '#fef2f2' },
  { value: 'advance', label: 'Advance', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'convention_winner', label: 'Convention Winner', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'winner', label: 'Winner', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'advance_to_primary', label: 'Advance to Primary', color: '#16a34a', bg: '#f0fdf4' },
];

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
  const [decisions, setDecisions] = useState({});
  const [withdrawn, setWithdrawn] = useState(new Set());
  const [showAction, setShowAction] = useState(null);
  const [actionPin, setActionPin] = useState('');
  const [actionError, setActionError] = useState(null);

  const fetchData = async () => {
    try {
      const { data: decision } = await api.get(`/rounds/${roundId}/chair-decision`);
      setData(decision);
      if (decision.round.published_at) setReleased(true);
      const { data: cands } = await api.get(`/admin/races/${raceId}/candidates`);
      setWithdrawn(new Set(cands.filter(c => c.status === 'withdrawn').map(c => c.id)));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    }
  };

  useEffect(() => { fetchData(); }, [roundId]);

  const handleDecisionChange = (candidateId, outcome) => {
    setDecisions(prev => {
      const next = { ...prev };
      if (outcome) {
        next[candidateId] = outcome;
      } else {
        delete next[candidateId];
      }
      return next;
    });
  };

  const handleApplyDecisions = async () => {
    setError(null);
    try {
      for (const [candidateId, outcome] of Object.entries(decisions)) {
        if (outcome === 'eliminated') {
          await api.put(`/admin/candidates/${candidateId}/withdraw`);
          setWithdrawn(prev => new Set([...prev, parseInt(candidateId)]));
        }
      }
      // TODO: Store other outcomes (advance, winner, etc.) when round_results.outcome column exists
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply decisions');
    }
  };

  const handleResetDecisions = () => {
    setDecisions({});
  };

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

  const verifyPinAndExecute = async (action) => {
    if (!actionPin) { setActionError('PIN is required'); return; }
    try {
      await api.post('/auth/login', { role: 'admin', pin: actionPin });
    } catch {
      setActionError('Invalid PIN');
      return;
    }
    setActionError(null);

    try {
      if (action === 'next_round') {
        await handleApplyDecisions();
        await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'advances_next_round' });
        setShowAction(null);
        setActionPin('');
        navigate(`/admin/elections/${electionId}/races/${raceId}`);
      } else if (action === 'finalize') {
        await handleApplyDecisions();
        // Determine outcome from decisions
        const winnerEntry = Object.entries(decisions).find(([, o]) => o === 'winner' || o === 'convention_winner');
        const primaryEntry = Object.entries(decisions).find(([, o]) => o === 'advance_to_primary');
        if (winnerEntry) {
          await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'winner', candidate_id: parseInt(winnerEntry[0]) });
        } else if (primaryEntry) {
          await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'advances_primary' });
        } else {
          await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'closed', notes: 'Race finalized' });
        }
        alert('Race finalized.');
        setShowAction(null);
        setActionPin('');
        fetchData();
      } else if (action === 'cancel') {
        const notes = prompt('Reason for canceling (required):');
        if (!notes) { setActionError('Reason is required'); return; }
        await api.put(`/admin/races/${raceId}/outcome`, { outcome: 'closed', notes });
        alert('Race canceled.');
        setShowAction(null);
        setActionPin('');
        fetchData();
      }
    } catch (err) {
      setActionError(err.response?.data?.error || 'Action failed');
    }
  };

  if (!data) return <div style={styles.container}><p>{error || 'Loading...'}</p></div>;

  const hasDecisions = Object.keys(decisions).length > 0;

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: data.election?.name || 'Election', to: `/admin/elections/${electionId}` },
      { label: data.race?.name || 'Race', to: `/admin/elections/${electionId}/races/${raceId}` },
      { label: `Round ${data.round?.round_number}`, to: `/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}` },
      { label: 'Results' },
    ]}>

      <h1>Results — Round {data.round.round_number}</h1>
      <p style={styles.muted}>{data.race.name} — {data.election.name}</p>

      {released && (
        <div style={styles.releasedBanner}>Results have been released to the public.</div>
      )}

      {/* Results Table with Outcome Dropdowns */}
      <div style={styles.section}>
        <h2>Results</h2>
        <p style={styles.muted}>Total votes: {data.total_votes}</p>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Candidate</th>
              <th style={styles.th}>Votes</th>
              <th style={styles.th}>Percentage</th>
              <th style={styles.th}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map(r => {
              const pct = Number(r.percentage);
              const isWithdrawn = withdrawn.has(r.candidate_id);
              const decision = decisions[r.candidate_id] || '';
              const outcomeInfo = CANDIDATE_OUTCOMES.find(o => o.value === decision);
              return (
                <tr key={r.candidate_id} style={{
                  background: isWithdrawn ? '#fef2f2' : outcomeInfo?.bg || '',
                  opacity: isWithdrawn ? 0.6 : 1,
                }}>
                  <td style={styles.td}>
                    <strong style={isWithdrawn ? { textDecoration: 'line-through' } : {}}>
                      {r.candidate_name}
                    </strong>
                    {isWithdrawn && <span style={styles.eliminatedBadge}>Withdrawn</span>}
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
                    {!released && !isWithdrawn && (
                      <select
                        style={{ ...styles.input, fontSize: '0.82rem', padding: '0.3rem 0.4rem',
                          color: outcomeInfo?.color || '#333',
                          fontWeight: decision ? 700 : 400,
                        }}
                        value={decision}
                        onChange={e => handleDecisionChange(r.candidate_id, e.target.value)}
                      >
                        {CANDIDATE_OUTCOMES.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Apply / Reset buttons */}
        {!released && hasDecisions && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={styles.btnReset} onClick={handleResetDecisions}>Reset All Decisions</button>
          </div>
        )}
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
                const isW = withdrawn.has(r.candidate_id);
                const decision = decisions[r.candidate_id];
                const outcomeInfo = CANDIDATE_OUTCOMES.find(o => o.value === decision);
                return (
                  <div key={r.candidate_id} style={{ ...styles.previewRow, opacity: isW || decision === 'eliminated' ? 0.5 : 1 }}>
                    <span style={{ flex: 1, fontWeight: 600 }}>
                      <span style={{ textDecoration: isW || decision === 'eliminated' ? 'line-through' : 'none' }}>{r.candidate_name}</span>
                      {isW && <span style={{ color: '#f87171', fontSize: '0.75rem', marginLeft: '0.5rem' }}>WITHDRAWN</span>}
                      {outcomeInfo && decision && (
                        <span style={{ color: outcomeInfo.color, fontSize: '0.75rem', marginLeft: '0.5rem' }}>{outcomeInfo.label.toUpperCase()}</span>
                      )}
                    </span>
                    <span>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
                  </div>
                );
              })}
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{data.total_votes} ballots counted</p>
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

      {/* Race Actions */}
      <div style={styles.section}>
        <h2>Race Actions</h2>
        <p style={styles.muted}>All actions require Admin PIN verification.</p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button style={styles.btnPrimary} onClick={() => { setShowAction('next_round'); setActionPin(''); setActionError(null); }}>
            Move to Next Round
          </button>
          <button style={styles.btnSuccess} onClick={() => { setShowAction('finalize'); setActionPin(''); setActionError(null); }}>
            Finalize Race
          </button>
          <button style={styles.btnDangerLarge} onClick={() => { setShowAction('cancel'); setActionPin(''); setActionError(null); }}>
            Cancel Race
          </button>
        </div>

        {/* PIN Modal */}
        {showAction && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <h3 style={{ margin: '0 0 0.5rem' }}>
                {showAction === 'next_round' && 'Move to Next Round'}
                {showAction === 'finalize' && 'Finalize Race'}
                {showAction === 'cancel' && 'Cancel Race'}
              </h3>
              <p style={{ color: '#4b5563', margin: '0 0 1rem', fontSize: '0.9rem' }}>
                {showAction === 'next_round' && 'This will apply candidate decisions and create the next round.'}
                {showAction === 'finalize' && 'This will apply all candidate decisions and close the race. This cannot be undone.'}
                {showAction === 'cancel' && 'This will cancel the race. A reason is required. This cannot be undone.'}
              </p>
              {hasDecisions && (
                <div style={{ background: '#f3f4f6', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                  <strong>Pending decisions:</strong>
                  {Object.entries(decisions).map(([cid, outcome]) => {
                    const cand = data.results.find(r => r.candidate_id === parseInt(cid));
                    const info = CANDIDATE_OUTCOMES.find(o => o.value === outcome);
                    return <div key={cid} style={{ color: info?.color }}>{cand?.candidate_name}: {info?.label}</div>;
                  })}
                </div>
              )}
              <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                Enter Admin PIN to confirm
              </label>
              <input
                style={styles.input}
                type="password"
                placeholder="Admin PIN"
                value={actionPin}
                onChange={e => { setActionPin(e.target.value); setActionError(null); }}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') verifyPinAndExecute(showAction); }}
              />
              {actionError && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{actionError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button
                  style={showAction === 'cancel' ? styles.btnDangerLarge : styles.btnPrimary}
                  onClick={() => verifyPinAndExecute(showAction)}
                >
                  Confirm
                </button>
                <button style={styles.btnReset} onClick={() => setShowAction(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p style={styles.errorMsg}>{error}</p>}
    </ElectionLayout>
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
  eliminatedBadge: { marginLeft: '0.5rem', background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700 },
  releasedBanner: { background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 8, padding: '0.75rem', fontWeight: 600, color: '#1e40af', marginBottom: '1rem' },
  previewPanel: { background: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: '1rem', marginTop: '0.75rem' },
  previewRow: { display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #334155' },
  releaseBox: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  btnPreview: { padding: '0.5rem 1rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnRelease: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnSuccess: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnDangerLarge: { padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnReset: { padding: '0.5rem 1rem', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.75rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modalCard: {
    background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 420,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
};
