import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import api from '../api/client';
import DashboardPreview from '../components/DashboardPreview';
import AppHeader from '../components/AppHeader';

const STATUS_COLORS = {
  pending_needs_action: { bg: '#fef3c7', color: '#92400e', label: 'Needs Action' },
  ready: { bg: '#dcfce7', color: '#166534', label: 'Ready' },
  voting_open: { bg: '#dbeafe', color: '#1e40af', label: 'Voting Open' },
  voting_closed: { bg: '#e0e7ff', color: '#3730a3', label: 'Voting Closed' },
  tallying: { bg: '#fef3c7', color: '#92400e', label: 'Tallying' },
  round_finalized: { bg: '#f3e8ff', color: '#6b21a8', label: 'Finalized' },
  canceled: { bg: '#f3f4f6', color: '#6b7280', label: 'Canceled' },
};

const OUTCOME_COLORS = {
  eliminated: { color: '#ef4444', label: 'Eliminated' },
  withdrew: { color: '#6b7280', label: 'Withdrew' },
  advance: { color: '#16a34a', label: 'Advances' },
  convention_winner: { color: '#16a34a', label: 'Convention Winner' },
  winner: { color: '#16a34a', label: 'Winner' },
  advance_to_primary: { color: '#16a34a', label: 'Advances to Primary' },
};

export default function ControlCenter() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      const { data: result } = await api.get('/admin/control-center');
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const socket = socketIO();
    socket.on('status:changed', () => fetchData());
    socket.on('round:released', () => fetchData());
    socket.on('scan:recorded', () => fetchData());
    return () => socket.disconnect();
  }, []);

  const handleAction = async (url, body, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setActionLoading(url);
    setError(null);
    try {
      await api.post(url, body || {});
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleWithNotes = async (url, promptMsg) => {
    const notes = prompt(promptMsg);
    if (!notes) return;
    await handleAction(url, { notes });
  };

  // Group races by election
  const elections = {};
  for (const race of data) {
    if (!elections[race.election_id]) {
      elections[race.election_id] = { name: race.election_name, id: race.election_id, races: [] };
    }
    elections[race.election_id].races.push(race);
  }
  const electionList = Object.values(elections);

  if (loading) return <div style={s.container}><p>Loading...</p></div>;

  return (
    <div style={s.container}>
      <AppHeader title="Control Center" />
      <Link to="/admin" style={s.backLink}>&larr; Back to Dashboard</Link>
      <h1>Control Center</h1>
      <p style={s.muted}>Manage voting, tallying, and result publication for all races.</p>

      {error && <div style={s.errorBanner}>{error}</div>}

      {electionList.length === 0 && <p style={s.muted}>No election events found.</p>}

      {electionList.map(election => (
        <ElectionSection
          key={election.id}
          election={election}
          onAction={handleAction}
          onActionWithNotes={handleWithNotes}
          actionLoading={actionLoading}
          defaultExpanded={electionList.length === 1}
        />
      ))}
    </div>
  );
}

function ElectionSection({ election, onAction, onActionWithNotes, actionLoading, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={s.electionSection}>
      <div style={s.electionHeader} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{expanded ? '▾' : '▸'}</span>
          <h2 style={{ margin: 0, fontSize: '1.3rem' }}>{election.name}</h2>
        </div>
        <span style={s.electionCount}>{election.races.length} race{election.races.length !== 1 ? 's' : ''}</span>
      </div>

      {expanded && election.races.map(race => (
        <RacePanel
          key={race.race_id}
          race={race}
          onAction={onAction}
          onActionWithNotes={onActionWithNotes}
          actionLoading={actionLoading}
        />
      ))}
    </div>
  );
}

function RacePanel({ race, onAction, onActionWithNotes, actionLoading }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={s.raceCard}>
      <div style={{ ...s.raceHeader, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{expanded ? '▾' : '▸'}</span>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{race.race_name}</h3>
        </div>
        <span style={{ ...s.badge, background: STATUS_COLORS[race.race_status]?.bg || '#e5e7eb', color: STATUS_COLORS[race.race_status]?.color || '#333' }}>
          {STATUS_COLORS[race.race_status]?.label || race.race_status}
        </span>
      </div>

      {expanded && (
        <>
          {race.rounds.map(round => (
            <RoundPanel
              key={round.id}
              round={round}
              raceId={race.race_id}
              raceName={race.race_name}
              electionName={race.election_name}
              onAction={onAction}
              onActionWithNotes={onActionWithNotes}
              actionLoading={actionLoading}
            />
          ))}

          {race.race_status !== 'results_finalized' && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb' }}>
              <button
                style={s.btnDanger}
                onClick={() => onAction(`/admin/control-center/race/${race.race_id}/finalize`, {}, 'Finalize this race? All pending rounds will be canceled.')}
                disabled={actionLoading}
              >
                Finalize Race — No More Rounds
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoundPanel({ round, raceId, raceName, electionName, onAction, onActionWithNotes, actionLoading }) {
  const [showPreview, setShowPreview] = useState(false);
  const st = STATUS_COLORS[round.status] || {};
  const isPublished = !!round.published_at;
  const totalVotes = round.results?.reduce((sum, r) => sum + r.vote_count, 0) || 0;

  return (
    <div style={{ ...s.roundCard, borderLeftColor: st.color || '#d1d5db' }}>
      <div style={s.roundHeader}>
        <span style={{ fontWeight: 700 }}>Round {round.round_number}</span>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>{round.paper_color}</span>
        <span style={{ ...s.badge, background: st.bg, color: st.color }}>{st.label || round.status}</span>
        {isPublished && <span style={{ ...s.badge, background: '#dcfce7', color: '#166534' }}>Published</span>}
      </div>

      {/* Results summary for finalized rounds */}
      {round.results && round.results.length > 0 && (
        <>
          <div style={s.resultsPreview}>
            {round.results.map(r => {
              const oc = OUTCOME_COLORS[r.outcome];
              return (
                <div key={r.candidate_id} style={s.resultRow}>
                  <span style={{ fontWeight: 600, flex: 1 }}>
                    {r.candidate_name}
                    {oc && <span style={{ color: oc.color, fontSize: '0.75rem', marginLeft: '0.5rem' }}>{oc.label}</span>}
                  </span>
                  <span style={s.muted}>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
                </div>
              );
            })}
          </div>
          <button
            style={{ ...s.btnSmall, marginTop: '0.35rem', marginBottom: '0.35rem' }}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? 'Hide Dashboard Preview' : 'Preview Dashboard'}
          </button>
          {showPreview && (
            <DashboardPreview
              electionName={electionName}
              raceName={raceName}
              roundNumber={round.round_number}
              results={round.results}
              decisions={{}}
              withdrawn={new Set()}
              totalVotes={totalVotes}
            />
          )}
        </>
      )}

      {/* Action buttons based on current status */}
      <div style={s.actions}>
        {round.status === 'ready' && (
          <button style={s.btnSuccess} onClick={() => onAction(`/admin/control-center/round/${round.id}/open-voting`)} disabled={actionLoading}>
            Open Voting
          </button>
        )}

        {round.status === 'voting_open' && (
          <button style={s.btnWarning} onClick={() => onAction(`/admin/control-center/round/${round.id}/close-voting`)} disabled={actionLoading}>
            Close Voting
          </button>
        )}

        {round.status === 'voting_closed' && (
          <button style={s.btnPrimary} onClick={() => onAction(`/admin/control-center/round/${round.id}/open-tallying`)} disabled={actionLoading}>
            Open for Tallying
          </button>
        )}

        {round.status === 'round_finalized' && !isPublished && (
          <button style={s.btnPublish} onClick={() => onAction(`/admin/control-center/round/${round.id}/publish`, {}, 'Publish these results to the public dashboard?')} disabled={actionLoading}>
            Publish to Dashboard
          </button>
        )}

        {round.status === 'round_finalized' && (
          <>
            <button style={s.btnSmall} onClick={() => onActionWithNotes(`/admin/control-center/round/${round.id}/recount`, 'Reason for recount (required):')} disabled={actionLoading}>
              Issue Recount
            </button>
            <button style={s.btnDangerSmall} onClick={() => {
              if (!confirm(`VOID Round ${round.round_number}? This will cancel ONLY this round. Other rounds will not be affected. This cannot be undone.`)) return;
              onActionWithNotes(`/admin/control-center/round/${round.id}/void`, 'Reason for voiding this round (required):');
            }} disabled={actionLoading}>
              Void Round {round.round_number}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  muted: { color: '#666', fontSize: '0.85rem' },
  errorBanner: { background: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem', fontWeight: 600 },
  electionSection: { marginBottom: '2rem' },
  electionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', paddingBottom: '0.5rem', marginBottom: '0.75rem', borderBottom: '2px solid #e5e7eb', userSelect: 'none' },
  electionCount: { color: '#9ca3af', fontSize: '0.85rem', fontWeight: 500 },
  raceCard: { border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem', marginBottom: '0.75rem', background: '#fff' },
  raceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  roundCard: { borderLeft: '4px solid #d1d5db', padding: '0.75rem', marginBottom: '0.5rem', background: '#f9fafb', borderRadius: '0 6px 6px 0' },
  roundHeader: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' },
  badge: { padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  resultsPreview: { background: '#fff', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem', border: '1px solid #e5e7eb' },
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.85rem' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  btnSuccess: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnWarning: { padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnPublish: { padding: '0.5rem 1rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700 },
  btnDanger: { padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnSmall: { padding: '0.35rem 0.75rem', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  btnDangerSmall: { padding: '0.35rem 0.75rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
};
