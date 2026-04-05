import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';

export default function BallotBoxDetail() {
  const { roundId } = useParams();
  const [round, setRound] = useState(null);
  const [data, setData] = useState(null);

  const fetchData = async () => {
    try {
      const [roundRes, boxRes] = await Promise.all([
        api.get(`/admin/rounds/${roundId}`),
        api.get(`/admin/rounds/${roundId}/box-counts`),
      ]);
      setRound(roundRes.data);
      setData(boxRes.data);
    } catch {}
  };

  useEffect(() => {
    fetchData();
    const socket = io();
    socket.on('scan:recorded', () => fetchData());
    return () => socket.disconnect();
  }, [roundId]);

  if (!round || !data) return <div style={s.container}><p>Loading...</p></div>;

  const passes = data.passes || [];

  return (
    <div style={s.container}>
      <Link to={`/admin/elections/${round.race?.election_id}/races/${round.race_id}/rounds/${roundId}`} style={s.backLink}>
        &larr; Back to Round
      </Link>

      <h1>Ballot Box Breakdown</h1>
      <p style={s.muted}>{round.race?.name} — Round {round.round_number} — {round.status}</p>

      {passes.length === 0 && <p style={s.muted}>No scans recorded yet.</p>}

      {passes.map(pass => {
        const boxCounts = pass.boxes || [];
        const grandTotal = boxCounts.reduce((sum, b) => sum + b.total_scans, 0);

        return (
          <div key={pass.pass_id} style={{ marginBottom: '2rem' }}>
            <h2 style={s.passTitle}>
              Pass {pass.pass_number}
              <span style={{ ...s.passBadge, background: pass.status === 'complete' ? '#dcfce7' : '#dbeafe', color: pass.status === 'complete' ? '#166534' : '#1e40af' }}>
                {pass.status === 'complete' ? 'Complete' : 'Active'} — {grandTotal} ballots
              </span>
            </h2>

            {/* Total — All Boxes (at the top) */}
            {boxCounts.length > 0 && (
              <div style={{ ...s.card, background: '#f0fdf4', borderColor: '#86efac' }}>
                <div style={s.cardHeader}>
                  <h3 style={{ margin: 0 }}>Total — All Boxes</h3>
                  <span style={s.totalBadge}>{grandTotal} ballots</span>
                </div>
                <div style={s.candidateGrid}>
                  {boxCounts[0]?.candidates.map(c => {
                    const total = boxCounts.reduce((sum, b) => {
                      const match = b.candidates.find(bc => bc.candidate_id === c.candidate_id);
                      return sum + (match ? match.count : 0);
                    }, 0);
                    return (
                      <div key={c.candidate_id} style={s.candidateRow}>
                        <span style={s.candidateName}>{c.candidate_name}</span>
                        <div style={s.barBg}>
                          <div style={{
                            ...s.barFill,
                            width: grandTotal > 0 ? `${(total / grandTotal) * 100}%` : '0%',
                          }} />
                        </div>
                        <span style={s.countVal}>{total}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Per-box breakdown */}
            {boxCounts.map(box => (
              <div key={box.box_id || 'null'} style={s.card}>
                <div style={s.cardHeader}>
                  <h3 style={{ margin: 0 }}>{box.box_name}</h3>
                  <span style={s.totalBadge}>{box.total_scans} ballots</span>
                </div>

                {box.scanners.length > 0 && (
                  <p style={s.scannerInfo}>Scanner: {box.scanners.join(', ')}</p>
                )}

                <div style={s.candidateGrid}>
                  {box.candidates.map(c => (
                    <div key={c.candidate_id} style={s.candidateRow}>
                      <span style={s.candidateName}>{c.candidate_name}</span>
                      <div style={s.barBg}>
                        <div style={{
                          ...s.barFill,
                          width: box.total_scans > 0 ? `${(c.count / box.total_scans) * 100}%` : '0%',
                        }} />
                      </div>
                      <span style={s.countVal}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const s = {
  container: { maxWidth: 800, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
  passTitle: { display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.2rem', marginBottom: '0.75rem' },
  passBadge: { padding: '3px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#fff' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  totalBadge: { background: '#dbeafe', color: '#1e40af', padding: '3px 10px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 600 },
  scannerInfo: { color: '#6b7280', fontSize: '0.82rem', marginBottom: '0.5rem' },
  candidateGrid: {},
  candidateRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' },
  candidateName: { width: 140, fontSize: '0.85rem', fontWeight: 600 },
  barBg: { flex: 1, height: 16, background: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: '100%', background: '#3b82f6', borderRadius: 8, transition: 'width 0.5s' },
  countVal: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' },
};
