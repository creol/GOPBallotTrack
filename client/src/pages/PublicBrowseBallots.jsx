import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

const PAGE_SIZE = 50;

export default function PublicBrowseBallots() {
  const { electionId } = useParams();
  const [election, setElection] = useState(null);
  const [expandedRound, setExpandedRound] = useState(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    api.get(`/public/${electionId}`).then(({ data }) => setElection(data));
  }, [electionId]);

  if (!election) return <div style={s.container}><p>Loading...</p></div>;

  // Collect all published rounds with their SNs
  const roundsWithSNs = [];
  for (const race of election.races) {
    for (const round of race.rounds) {
      roundsWithSNs.push({
        roundId: round.id,
        raceName: race.name,
        roundNumber: round.round_number,
      });
    }
  }

  return (
    <div style={s.container}>
      <Link to={`/public/${electionId}`} style={s.backLink}>&larr; Back to Dashboard</Link>
      <h1>Browse All Ballots</h1>
      <p style={s.muted}>{election.name}</p>

      {roundsWithSNs.length === 0 && (
        <p style={s.muted}>No results have been published yet.</p>
      )}

      {roundsWithSNs.map(rw => (
        <RoundSNList
          key={rw.roundId}
          electionId={electionId}
          roundId={rw.roundId}
          raceName={rw.raceName}
          roundNumber={rw.roundNumber}
          isExpanded={expandedRound === rw.roundId}
          onToggle={() => { setExpandedRound(expandedRound === rw.roundId ? null : rw.roundId); setPage(0); }}
          page={expandedRound === rw.roundId ? page : 0}
          setPage={setPage}
        />
      ))}
    </div>
  );
}

function RoundSNList({ electionId, roundId, raceName, roundNumber, isExpanded, onToggle, page, setPage }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (isExpanded && !data) {
      api.get(`/public/${electionId}/rounds/${roundId}`).then(({ data: d }) => setData(d));
    }
  }, [isExpanded, roundId, electionId]);

  const sns = data?.serial_numbers || [];
  const totalPages = Math.ceil(sns.length / PAGE_SIZE);
  const pageSNs = sns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div style={s.roundSection}>
      <div style={s.roundHeader} onClick={onToggle}>
        <span style={{ fontWeight: 700 }}>{raceName} — Round {roundNumber}</span>
        <span style={s.muted}>{isExpanded && data ? `${sns.length} ballots` : ''}</span>
        <span style={{ color: '#9ca3af' }}>{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div style={s.snBody}>
          {!data && <p style={s.muted}>Loading...</p>}

          {data && (
            <>
              <div style={s.snGrid}>
                {pageSNs.map(sn => (
                  <Link key={sn} to={`/public/${electionId}/ballots/${sn}`} style={s.snChip}>
                    {sn}
                  </Link>
                ))}
              </div>

              {totalPages > 1 && (
                <div style={s.pagination}>
                  <button style={s.pageBtn} onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                    &larr; Prev
                  </button>
                  <span style={{ fontSize: '0.85rem' }}>Page {page + 1} of {totalPages}</span>
                  <button style={s.pageBtn} onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                    Next &rarr;
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  container: { maxWidth: 600, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
  roundSection: { border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: '0.75rem', overflow: 'hidden' },
  roundHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', cursor: 'pointer', background: '#f9fafb' },
  snBody: { padding: '0.75rem 1rem' },
  snGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  snChip: {
    display: 'inline-block', padding: '0.4rem 0.7rem',
    background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6,
    fontFamily: 'monospace', fontSize: '0.85rem', color: '#1f2937',
    textDecoration: 'none',
  },
  pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' },
  pageBtn: { padding: '0.4rem 0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
};
