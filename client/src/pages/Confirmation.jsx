import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Confirmation() {
  const { id: electionId, raceId, roundId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [judgeName, setJudgeName] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const fetchComparison = async () => {
    try {
      const { data: comp } = await api.get(`/rounds/${roundId}/comparison`);
      setData(comp);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load comparison');
    }
  };

  useEffect(() => { fetchComparison(); }, [roundId]);

  const handleConfirm = async () => {
    if (!judgeName.trim()) { setError('Please enter your name'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/rounds/${roundId}/confirm`, { confirmed_by_name: judgeName });
      navigate(`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`);
    } catch (err) {
      setError(err.response?.data?.error || 'Confirmation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverride = async () => {
    if (!judgeName.trim()) { setError('Please enter your name'); return; }
    if (!overrideNotes.trim()) { setError('Override notes are required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/rounds/${roundId}/confirm-override`, {
        confirmed_by_name: judgeName,
        override_notes: overrideNotes,
      });
      navigate(`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`);
    } catch (err) {
      setError(err.response?.data?.error || 'Override failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPass = () => {
    navigate(`/scan/${roundId}`);
  };

  if (!data) return <div style={styles.container}><p>{error || 'Loading...'}</p></div>;

  const passNumbers = data.passes.map(p => p.pass_number);
  const notEnoughPasses = data.passes.length < 2;

  return (
    <div style={styles.container}>
      <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}`} style={styles.backLink}>
        &larr; Back to Round
      </Link>

      <h1>Confirm Round {data.round.round_number}</h1>
      <p style={styles.muted}>{data.race.name} — Paper: {data.round.paper_color}</p>

      {notEnoughPasses && (
        <div style={styles.warningBanner}>
          At least 2 completed passes are required before confirmation.
          Currently {data.passes.length} completed pass(es).
          <button style={styles.btnPrimary} onClick={handleAddPass}>Go to Scanner</button>
        </div>
      )}

      {/* Comparison Table */}
      <div style={styles.section}>
        <h2>Pass Comparison</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Candidate</th>
                {passNumbers.map(n => (
                  <th key={n} style={styles.th}>Pass {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.comparison.map(row => {
                const counts = Object.values(row.counts);
                const mismatch = new Set(counts).size > 1;
                return (
                  <tr key={row.candidate_id}>
                    <td style={styles.td}>{row.candidate_name}</td>
                    {passNumbers.map(n => (
                      <td
                        key={n}
                        style={{
                          ...styles.td,
                          ...styles.countCell,
                          background: mismatch ? '#fef2f2' : '#f0fdf4',
                          color: mismatch ? '#dc2626' : '#166534',
                          fontWeight: 700,
                        }}
                      >
                        {row.counts[n] ?? '-'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mismatch Warning or Match Confirmation */}
      {!notEnoughPasses && (
        <div style={styles.section}>
          {data.hasMismatch ? (
            <div style={styles.mismatchBanner}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>Mismatch Detected</h3>
              <p>Pass counts do not match for one or more candidates. You may:</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button style={styles.btnWarning} onClick={() => setShowOverride(true)}>
                  Confirm Anyway (Override)
                </button>
                <button style={styles.btnPrimary} onClick={handleAddPass}>Add Another Pass</button>
              </div>
            </div>
          ) : (
            <div style={styles.matchBanner}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>Passes Match</h3>
              <p>All pass counts agree. Ready for confirmation.</p>
            </div>
          )}

          {/* Override Modal */}
          {showOverride && (
            <div style={styles.overrideBox}>
              <h3>Override Mismatch</h3>
              <p style={styles.muted}>Explain why you are confirming despite the mismatch:</p>
              <textarea
                style={{ ...styles.input, minHeight: 80, width: '100%', resize: 'vertical' }}
                placeholder="Notes are required..."
                value={overrideNotes}
                onChange={e => setOverrideNotes(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button style={styles.btnWarning} onClick={handleOverride} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Confirm Override'}
                </button>
                <button style={styles.btnSmall} onClick={() => setShowOverride(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Normal Confirm */}
          {!data.hasMismatch && !showOverride && (
            <div style={styles.confirmBox}>
              <h3 style={{ marginBottom: '0.5rem' }}>Election Judge: Do you confirm these results?</h3>
              <input
                style={styles.input}
                placeholder="Your name"
                value={judgeName}
                onChange={e => setJudgeName(e.target.value)}
              />
              <button
                style={{ ...styles.btnConfirm, opacity: submitting ? 0.6 : 1 }}
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? 'Confirming...' : 'Confirm Results'}
              </button>
            </div>
          )}

          {/* Name input for override path */}
          {showOverride && (
            <div style={{ marginTop: '0.75rem' }}>
              <input
                style={styles.input}
                placeholder="Your name"
                value={judgeName}
                onChange={e => setJudgeName(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {error && <p style={styles.errorMsg}>{error}</p>}
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '1.5rem' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' },
  th: { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #e5e7eb', fontSize: '0.85rem', fontWeight: 700 },
  td: { padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb' },
  countCell: { textAlign: 'center', fontSize: '1.1rem' },
  warningBanner: { background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  mismatchBanner: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem' },
  matchBanner: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem' },
  overrideBox: { background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '1rem', marginTop: '1rem' },
  confirmBox: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnConfirm: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnWarning: { padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnSmall: { padding: '0.3rem 0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.75rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
};
