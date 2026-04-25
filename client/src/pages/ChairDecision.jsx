import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import DashboardPreview from '../components/DashboardPreview';

const CANDIDATE_OUTCOMES = [
  { value: '', label: '— No decision —' },
  { value: 'eliminated', label: 'Eliminated', color: '#ef4444', bg: '#fef2f2' },
  { value: 'withdrew', label: 'Withdrew', color: '#6b7280', bg: '#f3f4f6' },
  { value: 'advance', label: 'Advance', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'convention_winner', label: 'Convention Winner', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'winner', label: 'Winner', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'advance_to_primary', label: 'Advance to Primary', color: '#16a34a', bg: '#f0fdf4' },
];

export default function ChairDecision() {
  const { id: electionId, raceId, roundId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [released, setReleased] = useState(false);
  const [error, setError] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [withdrawn, setWithdrawn] = useState(new Set());
  const [showAction, setShowAction] = useState(null);
  const [actionPin, setActionPin] = useState('');
  const [actionError, setActionError] = useState(null);

  const fetchData = async () => {
    try {
      const { data: decision } = await api.get(`/admin/rounds/${roundId}/chair-decision`);
      setData(decision);
      if (decision.round.published_at) setReleased(true);
      // Load existing outcomes from DB into decisions state
      const existingDecisions = {};
      for (const r of decision.results) {
        if (r.outcome) existingDecisions[r.candidate_id] = r.outcome;
      }

      // Carry forward eliminated/withdrew from prior rounds if this round has no decisions yet
      if (Object.keys(existingDecisions).length === 0 && decision.round.round_number > 1) {
        try {
          // Get all published rounds for this race to find prior outcomes
          const { data: raceRounds } = await api.get(`/admin/races/${raceId}/rounds`);
          for (const pr of raceRounds) {
            if (pr.round_number >= decision.round.round_number) continue;
            try {
              const { data: prDecision } = await api.get(`/admin/rounds/${pr.id}/chair-decision`);
              for (const r of prDecision.results) {
                if (r.outcome === 'eliminated' || r.outcome === 'withdrew') {
                  existingDecisions[r.candidate_id] = r.outcome;
                }
              }
            } catch {}
          }
          // Auto-save carried-forward decisions
          if (Object.keys(existingDecisions).length > 0) {
            await api.put(`/admin/rounds/${roundId}/candidate-outcomes`, { outcomes: existingDecisions });
          }
        } catch {}
      }

      setDecisions(existingDecisions);
      const { data: cands } = await api.get(`/admin/races/${raceId}/candidates`);
      setWithdrawn(new Set(cands.filter(c => c.status === 'withdrawn').map(c => c.id)));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    }
  };

  useEffect(() => { fetchData(); }, [roundId]);

  const handleDecisionChange = async (candidateId, outcome) => {
    console.log('[Decision] Change:', candidateId, '→', outcome);
    const next = { ...decisions };
    if (outcome) {
      next[candidateId] = outcome;
    } else {
      delete next[candidateId];
    }
    setDecisions(next);

    // Auto-save to DB
    try {
      const resp = await api.put(`/admin/rounds/${roundId}/candidate-outcomes`, {
        outcomes: { [candidateId]: outcome || null },
      });
      console.log('[Decision] Saved:', resp.data);
    } catch (err) {
      console.error('[Decision] Save failed:', err.response?.data || err.message);
      setError('Failed to save decision: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleApplyDecisions = async () => {
    setError(null);
    try {
      // Save all outcomes to round_results
      if (Object.keys(decisions).length > 0) {
        await api.put(`/admin/rounds/${roundId}/candidate-outcomes`, { outcomes: decisions });
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply decisions');
    }
  };

  const handleResetDecisions = async () => {
    // Clear all outcomes in DB
    const clearOutcomes = {};
    for (const candidateId of Object.keys(decisions)) {
      clearOutcomes[candidateId] = null;
    }
    try {
      await api.put(`/admin/rounds/${roundId}/candidate-outcomes`, { outcomes: clearOutcomes });
      setDecisions({});
    } catch (err) {
      setError('Failed to reset: ' + (err.response?.data?.error || err.message));
    }
  };

  // Server-side PIN gate is the source of truth — every destructive endpoint below
  // re-verifies the operator's super-admin PIN against their session and rejects with
  // 401 if it doesn't match. We surface that 401 as the modal error so a wrong PIN
  // can never silently succeed (which is what the old client-only pre-check allowed).
  const verifyPinAndExecute = async (action) => {
    if (!actionPin) { setActionError('PIN is required'); return; }
    setActionError(null);
    const pin = actionPin;

    try {
      if (action === 'next_round') {
        await handleApplyDecisions();
        // Chair-side finalization — flips the round to round_finalized.
        // The Election Judge confirm step (Confirmation.jsx) only records the
        // audit; the actual status change happens here, only with a valid PIN.
        await api.post(`/admin/rounds/${roundId}/finalize`, { pin, finalized_by_name: 'admin' });
        setShowAction(null);
        setActionPin('');
        navigate(`/admin/elections/${electionId}/races/${raceId}`);
      }
    } catch (err) {
      // Server returns 401 with "Invalid Super Admin PIN" when the PIN doesn't match
      // the logged-in user. Show the server's message verbatim so the operator knows
      // whether it was the PIN or something else.
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
              const decision = decisions[r.candidate_id] || '';
              const outcomeInfo = CANDIDATE_OUTCOMES.find(o => o.value === decision);
              const isOut = decision === 'eliminated' || decision === 'withdrew' || r.candidate_status === 'withdrawn';
              return (
                <tr key={r.candidate_id} style={{
                  background: outcomeInfo?.bg || '',
                  opacity: isOut ? 0.6 : 1,
                }}>
                  <td style={styles.td}>
                    <strong style={isOut ? { textDecoration: 'line-through' } : {}}>
                      {r.candidate_name}
                    </strong>
                    {outcomeInfo && decision && (
                      <span style={{ marginLeft: '0.5rem', background: outcomeInfo.bg, color: outcomeInfo.color, padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700 }}>
                        {outcomeInfo.label}
                      </span>
                    )}
                    {!decision && r.candidate_status === 'withdrawn' && <span style={styles.eliminatedBadge}>Withdrawn</span>}
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
                      <select
                        style={{ ...styles.input, fontSize: '0.82rem', padding: '0.3rem 0.4rem',
                          color: outcomeInfo?.color || '#333',
                          fontWeight: decision ? 700 : 400,
                        }}
                        value={decision}
                        onChange={e => {
                          console.log('[Select] onChange fired for', r.candidate_id, e.target.value);
                          handleDecisionChange(r.candidate_id, e.target.value);
                        }}
                        disabled={data.race?.status === 'results_finalized'}
                      >
                        {CANDIDATE_OUTCOMES.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Apply / Reset buttons */}
        {data.race?.status !== 'results_finalized' && hasDecisions && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button style={styles.btnReset} onClick={handleResetDecisions}>Reset All Decisions</button>
          </div>
        )}
      </div>

      {/* Preview Section */}
      <div style={styles.section}>
        <button
          style={styles.btnPreview}
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Close Preview' : 'Preview Public Dashboard'}
        </button>

        {showPreview && (
          <DashboardPreview
            electionName={data.election.name}
            raceName={data.race.name}
            roundNumber={data.round.round_number}
            results={data.results}
            decisions={decisions}
            withdrawn={withdrawn}
            totalVotes={data.total_votes}
          />
        )}
      </div>

      {/* Race Actions */}
      <div style={styles.section}>
        <h2>Race Actions</h2>
        <p style={styles.muted}>All actions require Admin PIN verification.</p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button style={styles.btnPrimary} onClick={() => { setShowAction('next_round'); setActionPin(''); setActionError(null); }}>
            Finalize Round & Move to Next
          </button>
        </div>

        {/* PIN Modal */}
        {showAction && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <h3 style={{ margin: '0 0 0.5rem' }}>
                {showAction === 'next_round' && 'Finalize Round & Move to Next'}
              </h3>
              <p style={{ color: '#4b5563', margin: '0 0 1rem', fontSize: '0.9rem' }}>
                {showAction === 'next_round' && 'This will save candidate decisions, finalize this round, and return to the race page. The round will be available for publishing from the Round page.'}
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
                  style={styles.btnPrimary}
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
