import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

const FLAG_COLORS = {
  no_mark: { bg: '#fef3c7', color: '#92400e', label: 'No Mark' },
  overvote: { bg: '#fee2e2', color: '#dc2626', label: 'Overvote' },
  uncertain: { bg: '#ffedd5', color: '#c2410c', label: 'Uncertain' },
  qr_not_found: { bg: '#f3f4f6', color: '#6b7280', label: 'QR Not Found' },
  wrong_round: { bg: '#fef2f2', color: '#dc2626', label: 'Wrong Round' },
  wrong_station: { bg: '#fef2f2', color: '#991b1b', label: 'Wrong Station' },
  unknown_sn: { bg: '#f3f4f6', color: '#6b7280', label: 'Unknown Serial' },
};

export default function BallotReviewQueue() {
  const { id: electionId, raceId, roundId } = useParams();
  const [reviews, setReviews] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [unusedSerials, setUnusedSerials] = useState([]);
  const [reviewerName, setReviewerName] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const fetchReviews = async () => {
    try {
      const url = showResolved
        ? `/rounds/${roundId}/reviewed-ballots`
        : `/rounds/${roundId}/reviewed-ballots?status=unresolved`;
      const { data } = await api.get(url);
      setReviews(data);
    } catch {}
  };

  const fetchCandidates = async () => {
    try {
      const { data } = await api.get(`/admin/races/${raceId}/candidates`);
      setCandidates(data.filter(c => c.status === 'active'));
    } catch {}
  };

  const fetchUnusedSerials = async () => {
    try {
      const { data } = await api.get(`/admin/rounds/${roundId}`);
      // Get unused serials from ballot_serials for this round
      const { data: allSerials } = await api.get(`/rounds/${roundId}/reviewed-ballots`);
      // We'll fetch unused serials via a dedicated query in the PUT call
    } catch {}
  };

  useEffect(() => { fetchReviews(); fetchCandidates(); }, [roundId, raceId, showResolved]);

  const handleReview = async (reviewId, outcome, candidateId, replacementSerialId, notes, pinData) => {
    if (!reviewerName.trim()) {
      alert('Enter your name first');
      return;
    }
    try {
      await api.put(`/reviewed-ballots/${reviewId}`, {
        outcome,
        candidate_id: candidateId || undefined,
        replacement_serial_id: replacementSerialId || undefined,
        notes: notes || undefined,
        reviewed_by: reviewerName,
        ...(pinData || {}),
      });
      fetchReviews();
    } catch (err) {
      alert('Review failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const unresolved = reviews.filter(r => !r.outcome);
  const resolved = reviews.filter(r => r.outcome);

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: 'Race', to: `/admin/elections/${electionId}/races/${raceId}` },
      { label: 'Round', to: `/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}` },
      { label: 'Ballot Review' },
    ]}>

      <h1>Ballot Review Queue ({unresolved.length} pending)</h1>

      <div style={s.nameRow}>
        <label style={s.label}>Reviewer Name:</label>
        <input style={s.input} placeholder="Your name" value={reviewerName}
          onChange={e => setReviewerName(e.target.value)} />
      </div>

      {unresolved.length === 0 && (
        <div style={s.empty}>All ballots reviewed — ready to finalize</div>
      )}

      {unresolved.map(item => (
        <ReviewCard
          key={item.id}
          item={item}
          candidates={candidates}
          roundId={roundId}
          onReview={handleReview}
        />
      ))}

      {/* Toggle resolved */}
      {resolved.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <button style={s.btnToggle} onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? 'Hide' : 'Show'} Resolved ({resolved.length})
          </button>
          {showResolved && resolved.map(item => (
            <div key={item.id} style={{ ...s.card, opacity: 0.7 }}>
              <div style={s.cardHeader}>
                <span style={s.sn}>{item.serial_number || 'Unknown SN'}</span>
                <span style={{ ...s.badge, background: OUTCOME_COLORS[item.outcome]?.bg || '#e5e7eb', color: OUTCOME_COLORS[item.outcome]?.color || '#333' }}>
                  {item.outcome}
                </span>
              </div>
              {item.notes && <p style={{ color: '#666', fontSize: '0.85rem', margin: '0.25rem 0' }}>{item.notes}</p>}
              <p style={{ color: '#999', fontSize: '0.8rem', margin: 0 }}>Reviewed by {item.reviewed_by}</p>
            </div>
          ))}
        </div>
      )}
    </ElectionLayout>
  );
}

const OUTCOME_COLORS = {
  counted: { bg: '#dcfce7', color: '#166534' },
  remade: { bg: '#dbeafe', color: '#1e40af' },
  spoiled: { bg: '#fef3c7', color: '#92400e' },
  rejected: { bg: '#f3f4f6', color: '#6b7280' },
};

function ReviewCard({ item, candidates, roundId, onReview }) {
  const [notes, setNotes] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [showRemade, setShowRemade] = useState(false);
  const [replacementSN, setReplacementSN] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);
  const isWrongRound = item.flag_reason === 'wrong_round';
  const flag = FLAG_COLORS[item.flag_reason] || FLAG_COLORS.uncertain;
  const scores = item.omr_scores || [];
  const maxFill = Math.max(...scores.map(s => s.fill_ratio || 0), 0.01);

  // Fetch admin users for wrong-round PIN verification
  useEffect(() => {
    if (isWrongRound && adminUsers.length === 0) {
      api.get('/admin/users').then(({ data }) => setAdminUsers(data || [])).catch(() => {});
    }
  }, [isWrongRound]);

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.sn}>{item.serial_number || 'Unknown SN'}</span>
        {item.flag_reason && (
          <span style={{ ...s.badge, background: flag.bg, color: flag.color }}>{flag.label}</span>
        )}
      </div>

      {/* Ballot image */}
      {(item.image_path || item.photo_path) && (
        <img
          src={`/data/scans/${(item.image_path || item.photo_path).replace(/^\/app\/data\/scans\//, '')}`}
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

      {/* Wrong-round warning + PIN requirement */}
      {isWrongRound && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
          <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '0.35rem' }}>
            Wrong Round Ballot
          </div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#7f1d1d' }}>
            {item.notes || 'This ballot belongs to a different round.'}
            {' '}Admin PIN is required to count this ballot.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={s.input} value={adminUserId} onChange={e => setAdminUserId(e.target.value)}>
              <option value="">Select admin...</option>
              {adminUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <input style={{ ...s.input, width: 120 }} type="password" placeholder="Admin PIN"
              value={adminPin} onChange={e => setAdminPin(e.target.value)} />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={s.actions}>
        {/* Count for candidate */}
        {candidates.map(c => (
          <button key={c.id} style={s.btnCount}
            onClick={() => {
              if (isWrongRound) {
                if (!adminUserId || !adminPin) {
                  alert('Admin PIN verification is required to count a wrong-round ballot');
                  return;
                }
                onReview(item.id, 'counted', c.id, null, notes, { admin_user_id: parseInt(adminUserId), pin: adminPin });
              } else {
                onReview(item.id, 'counted', c.id, null, notes);
              }
            }}>
            Count for {c.name}
          </button>
        ))}

        {/* Remade */}
        {!showRemade ? (
          <button style={s.btnRemade} onClick={() => setShowRemade(true)}>
            Remade
          </button>
        ) : (
          <div style={s.remadePanel}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Remade Ballot</p>
            <select style={s.input} value={selectedCandidate} onChange={e => setSelectedCandidate(e.target.value)}>
              <option value="">Select candidate...</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input style={{ ...s.input, marginTop: '0.25rem' }} placeholder="Replacement SN (unused)"
              value={replacementSN} onChange={e => setReplacementSN(e.target.value.toUpperCase())} />
            <button style={{ ...s.btnRemade, marginTop: '0.25rem' }}
              onClick={() => {
                if (!selectedCandidate) return alert('Select a candidate');
                if (!replacementSN) return alert('Enter a replacement SN');
                onReview(item.id, 'remade', selectedCandidate, replacementSN, notes);
              }}>
              Confirm Remade
            </button>
            <button style={{ ...s.btnToggle, marginTop: '0.25rem' }} onClick={() => setShowRemade(false)}>Cancel</button>
          </div>
        )}

        <button style={s.btnSpoil} onClick={() => onReview(item.id, 'spoiled', null, null, notes)}>
          Spoiled
        </button>
        <button style={s.btnReject} onClick={() => onReview(item.id, 'rejected', null, null, notes)}>
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
  btnRemade: { padding: '0.5rem 0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  remadePanel: { width: '100%', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '0.75rem', marginTop: '0.25rem' },
  btnSpoil: { padding: '0.5rem 0.75rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  btnReject: { padding: '0.5rem 0.75rem', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  btnToggle: { padding: '0.4rem 0.8rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
};
