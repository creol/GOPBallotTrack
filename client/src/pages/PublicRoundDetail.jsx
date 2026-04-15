import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import { VersionTag } from '../components/AppHeader';

export default function PublicRoundDetail() {
  const { electionId, roundId } = useParams();
  const [data, setData] = useState(null);
  const [snFilter, setSnFilter] = useState('');

  useEffect(() => {
    api.get(`/public/${electionId}/rounds/${roundId}`).then(({ data }) => setData(data));
  }, [electionId, roundId]);

  if (!data) return <div style={styles.container}><p>Loading...</p></div>;

  const totalVotes = data.results.reduce((sum, r) => sum + r.vote_count, 0);
  const filteredSNs = data.serial_numbers.filter(sn =>
    sn.toLowerCase().includes(snFilter.toLowerCase())
  );

  return (
    <div style={styles.container}>
      <VersionTag />
      <Link to={`/public/${electionId}`} style={styles.backLink}>&larr; Back to Dashboard</Link>

      <h1>{data.race.name} — Round {data.round.round_number}</h1>
      <p style={styles.muted}>Paper: {data.round.paper_color} | {totalVotes} total votes</p>

      {/* Results */}
      <div style={styles.section}>
        {data.results.map(r => {
          const pct = Number(r.percentage);
          return (
            <div key={r.candidate_id} style={styles.resultRow}>
              <div style={styles.candidateInfo}>
                <span style={styles.candidateName}>{r.candidate_name}</span>
                <span style={styles.voteLabel}>{r.vote_count} votes ({pct.toFixed(5)}%)</span>
              </div>
              <div style={styles.barBg}>
                <div style={{ ...styles.barFill, width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Ballot SNs — only show if browse or search is enabled for this race */}
      {(data.race.public_browse_enabled || data.race.public_search_enabled !== false) && (
        <div style={styles.section}>
          <h2>Ballots ({data.serial_numbers.length})</h2>
          {(data.race.public_search_enabled !== false) && (
            <input
              style={styles.filterInput}
              placeholder="Filter serial numbers..."
              value={snFilter}
              onChange={e => setSnFilter(e.target.value.toUpperCase())}
            />
          )}

          {data.race.public_browse_enabled && (
            <div style={styles.snGrid}>
              {filteredSNs.map(sn => (
                <Link
                  key={sn}
                  to={`/public/${electionId}/ballots/${sn}`}
                  style={styles.snChip}
                >
                  {sn}
                </Link>
              ))}
            </div>
          )}

          {!data.race.public_browse_enabled && data.race.public_search_enabled !== false && (
            <p style={styles.muted}>Use the search bar above to look up a specific ballot by serial number.</p>
          )}

          {data.race.public_browse_enabled && filteredSNs.length === 0 && snFilter && (
            <p style={styles.muted}>No matching serial numbers</p>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 600, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '1.5rem' },
  resultRow: { marginBottom: '1rem' },
  candidateInfo: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' },
  candidateName: { fontWeight: 700, fontSize: '1rem' },
  voteLabel: { color: '#666', fontSize: '0.85rem' },
  barBg: { height: 16, background: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  barFill: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 8, transition: 'width 0.5s ease' },
  filterInput: { width: '100%', padding: '0.6rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.95rem', fontFamily: 'monospace', textTransform: 'uppercase', marginBottom: '0.75rem', boxSizing: 'border-box' },
  snGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  snChip: {
    display: 'inline-block', padding: '0.4rem 0.7rem',
    background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6,
    fontFamily: 'monospace', fontSize: '0.85rem', color: '#1f2937',
    textDecoration: 'none', cursor: 'pointer',
  },
  muted: { color: '#666', fontSize: '0.9rem' },
};
