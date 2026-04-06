const OUTCOME_BADGES = {
  eliminated: { bg: '#fee2e2', color: '#dc2626', label: 'Eliminated' },
  withdrew: { bg: '#f3f4f6', color: '#6b7280', label: 'Withdrew' },
  advance: { bg: '#dcfce7', color: '#166534', label: 'Advances' },
  convention_winner: { bg: '#fef3c7', color: '#b45309', label: 'Convention Winner' },
  winner: { bg: '#fef3c7', color: '#b45309', label: 'Winner' },
  advance_to_primary: { bg: '#dbeafe', color: '#1e40af', label: 'Advances to Primary' },
};

export default function DashboardPreview({ electionName, raceName, roundNumber, results, decisions, withdrawn, totalVotes }) {
  return (
    <div style={s.panel}>
      <div style={s.header}>
        <h3 style={s.raceName}>{raceName}</h3>
        <span style={s.roundLabel}>Round {roundNumber}</span>
      </div>
      <p style={s.subtitle}>{electionName}</p>

      {results.map(r => {
        const pct = Number(r.percentage);
        const decision = decisions?.[r.candidate_id] || r.outcome;
        const isW = withdrawn?.has(r.candidate_id);
        const isElim = decision === 'eliminated' || decision === 'withdrew' || isW;
        const outcome = OUTCOME_BADGES[decision];

        return (
          <div key={r.candidate_id} style={{ ...s.resultRow, opacity: isElim ? 0.5 : 1 }}>
            <span style={{ ...s.candidateName, textDecoration: isElim ? 'line-through' : 'none' }}>
              {r.candidate_name}
            </span>
            {outcome && (
              <span style={{ background: outcome.bg, color: outcome.color, padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, marginRight: '0.5rem', flexShrink: 0 }}>
                {outcome.label}
              </span>
            )}
            <div style={s.barContainer}>
              <div style={{ ...s.bar, width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span style={s.voteCount}>{r.vote_count}</span>
            <span style={s.pct}>{pct.toFixed(1)}%</span>
          </div>
        );
      })}

      <p style={s.footer}>{totalVotes} ballots counted</p>
      <p style={s.note}>Publishing to the public dashboard is done in the Control Center.</p>
    </div>
  );
}

const s = {
  panel: { background: '#1e293b', color: '#f1f5f9', borderRadius: 8, padding: '1.25rem', marginTop: '0.75rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' },
  raceName: { margin: 0, fontSize: '1.3rem', color: '#fff' },
  roundLabel: { background: '#334155', color: '#94a3b8', padding: '3px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  subtitle: { color: '#64748b', fontSize: '0.8rem', margin: '0 0 1rem' },
  resultRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' },
  candidateName: { width: 140, fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', flexShrink: 0 },
  barContainer: { flex: 1, height: 20, background: '#334155', borderRadius: 10, overflow: 'hidden' },
  bar: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 10, transition: 'width 0.8s ease' },
  voteCount: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#fff', flexShrink: 0 },
  pct: { width: 60, textAlign: 'right', color: '#94a3b8', fontSize: '0.9rem', flexShrink: 0 },
  footer: { color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.75rem' },
  note: { color: '#475569', fontSize: '0.72rem', fontStyle: 'italic', margin: '0.25rem 0 0' },
};
