import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

const FLAG_COLORS = {
  no_mark: { bg: '#fef3c7', color: '#92400e', label: 'No Mark' },
  overvote: { bg: '#fee2e2', color: '#dc2626', label: 'Overvote' },
  uncertain: { bg: '#ffedd5', color: '#c2410c', label: 'Uncertain' },
  qr_not_found: { bg: '#f3f4f6', color: '#6b7280', label: 'QR Not Found' },
};

export default function FlaggedReview() {
  const { id: electionId, raceId, roundId } = useParams();
  const [flagged, setFlagged] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [reviewerName, setReviewerName] = useState('');

  const fetchFlagged = async () => {
    try {
      const { data } = await api.get(`/rounds/${roundId}/flagged`);
      setFlagged(data);
    } catch {}
  };

  const fetchCandidates = async () => {
    try {
      const { data } = await api.get(`/admin/races/${raceId}/candidates`);
      setCandidates(data.filter(c => c.status === 'active'));
    } catch {}
  };

  useEffect(() => { fetchFlagged(); fetchCandidates(); }, [roundId, raceId]);

  const handleReview = async (flaggedId, decision, candidateId, notes) => {
    if (!reviewerName.trim()) {
      alert('Enter your name first');
      return;
    }
    try {
      await api.post(`/flagged/${flaggedId}/review`, {
        reviewed_by: reviewerName,
        decision,
        candidate_id: candidateId || undefined,
        notes: notes || undefined,
      });
      fetchFlagged();
    } catch (err) {
      alert('Review failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div style={s.container}>
      <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}`} style={s.backLink}>
        &larr; Back to Round
      </Link>

      <h1>Flagged Ballots ({flagged.length} remaining)</h1>

      <div style={s.nameRow}>
        <label style={s.label}>Reviewer Name:</label>
        <input style={s.input} placeholder="Your name" value={reviewerName}
          onChange={e => setReviewerName(e.target.value)} />
      </div>

      {flagged.length === 0 && (
        <div style={s.empty}>No flagged ballots to review</div>
      )}

      {flagged.map(item => (
        <FlaggedCard
          key={item.id}
          item={item}
          candidates={candidates}
          onReview={handleReview}
        />
      ))}
    </div>
  );
}

function FlaggedCard({ item, candidates, onReview }) {
  const [notes, setNotes] = useState('');
  const flag = FLAG_COLORS[item.flag_reason] || FLAG_COLORS.uncertain;
  const scores = item.omr_scores || [];
  const maxFill = Math.max(...scores.map(s => s.fill_ratio || 0), 0.01);

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.sn}>{item.serial_number || 'Unknown SN'}</span>
        <span style={{ ...s.badge, background: flag.bg, color: flag.color }}>{flag.label}</span>
      </div>

      {/* Ballot image */}
      {item.image_path && (
        <img
          src={`/data/scans/${item.image_path.replace(/^\/app\/data\/scans\//, '')}`}
          alt={`Ballot ${item.serial_number}`}
          style={s.ballotImg}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}

      {/* OMR scores */}
      {scores.length > 0 && (
        <div style={s.scoresSection}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>OMR Confidence Scores</h4>
          {scores.map((score, i) => (
            <div key={i} style={s.scoreRow}>
              <span style={s.scoreName}>{score.name}</span>
              <div style={s.barBg}>
                <div style={{
                  ...s.barFill,
                  width: `${(score.fill_ratio / maxFill) * 100}%`,
                  background: score.is_marked ? '#16a34a' : score.is_uncertain ? '#f59e0b' : '#94a3b8',
                }} />
              </div>
              <span style={s.scoreVal}>{((score.fill_ratio || 0) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      <input style={{ ...s.input, width: '100%', marginTop: '0.5rem', boxSizing: 'border-box' }}
        placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />

      {/* Action buttons */}
      <div style={s.actions}>
        {candidates.map(c => (
          <button key={c.id} style={s.btnCount}
            onClick={() => onReview(item.id, 'counted', c.id, notes)}>
            Count for {c.name}
          </button>
        ))}
        <button style={s.btnSpoil} onClick={() => onReview(item.id, 'spoiled', null, notes)}>
          Mark as Spoiled
        </button>
        <button style={s.btnReject} onClick={() => onReview(item.id, 'rejected', null, notes)}>
          Reject
        </button>
      </div>
    </div>
  );
}

const s = {
  container: { maxWidth: 800, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  nameRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' },
  label: { fontWeight: 600, fontSize: '0.9rem' },
  input: { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' },
  empty: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '2rem', textAlign: 'center', color: '#166534', fontSize: '1.1rem' },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem', background: '#fff' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  sn: { fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' },
  badge: { padding: '3px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  ballotImg: { width: '100%', maxHeight: 400, objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: 4, marginBottom: '0.75rem' },
  scoresSection: { background: '#f9fafb', borderRadius: 6, padding: '0.75rem', marginBottom: '0.5rem' },
  scoreRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' },
  scoreName: { width: 120, fontSize: '0.82rem', fontWeight: 600 },
  barBg: { flex: 1, height: 14, background: '#e5e7eb', borderRadius: 7, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 7, transition: 'width 0.3s' },
  scoreVal: { width: 50, textAlign: 'right', fontSize: '0.8rem', color: '#666' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' },
  btnCount: { padding: '0.5rem 0.75rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 },
  btnSpoil: { padding: '0.5rem 0.75rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  btnReject: { padding: '0.5rem 0.75rem', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
};
