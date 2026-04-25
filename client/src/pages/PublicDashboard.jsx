import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import api from '../api/client';
import { formatRaceSchedule } from '../utils/dateFormat';
import { VersionTag } from '../components/AppHeader';

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return width;
}

export default function PublicDashboard() {
  const { electionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const windowWidth = useWindowWidth();
  const isTvMode = searchParams.get('mode') === 'tv' || windowWidth > 1200;

  const [election, setElection] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [searchSN, setSearchSN] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [expandedRace, setExpandedRace] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get(`/public/${electionId}`);
      setElection(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message || 'Failed to load');
    }
  }, [electionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [connected, setConnected] = useState(true);

  // WebSocket for live updates with reconnection
  useEffect(() => {
    const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });
    socket.on('round:released', () => fetchData());
    socket.on('status:changed', () => fetchData());
    // Race reorder / visibility toggle / rename — refresh if it's for this election
    socket.on('races:changed', (payload) => {
      if (!payload || payload.election_id == null || String(payload.election_id) === String(electionId)) {
        fetchData();
      }
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    return () => socket.disconnect();
  }, [fetchData, electionId]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (searchSN.length < 8) return;
    try {
      const { data } = await api.get(`/public/${electionId}/search?sn=${searchSN}`);
      setSearchResult(data);
      if (data.found) {
        navigate(`/public/${electionId}/ballots/${data.serial_number}`);
      }
    } catch {
      setSearchResult({ found: false, message: 'Search failed' });
    }
  };

  if (!election) return (
    <div style={isTvMode ? tv.container : mob.container}>
      <p>{loadError ? `Error: ${loadError}` : 'Loading...'}</p>
      {loadError && <button onClick={fetchData} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginTop: '0.5rem' }}>Retry</button>}
    </div>
  );

  if (isTvMode) return <><TVMode election={election} connected={connected} /><VersionTag /></>;
  return (
    <><MobileMode
      election={election}
      electionId={electionId}
      searchSN={searchSN}
      setSearchSN={setSearchSN}
      searchResult={searchResult}
      handleSearch={handleSearch}
      expandedRace={expandedRace}
      setExpandedRace={setExpandedRace}
    /><VersionTag /></>
  );
}

const OUTCOME_BADGES = {
  eliminated: { bg: '#fee2e2', color: '#dc2626', label: 'Eliminated' },
  withdrew: { bg: '#f3f4f6', color: '#6b7280', label: 'Withdrew' },
  advance: { bg: '#dcfce7', color: '#166534', label: 'Advances' },
  convention_winner: { bg: '#fef3c7', color: '#b45309', label: 'Convention Winner' },
  winner: { bg: '#fef3c7', color: '#b45309', label: 'Winner' },
  advance_to_primary: { bg: '#dbeafe', color: '#1e40af', label: 'Advances to Primary' },
};

const STATUS_BADGE_STYLES = {
  'Awaiting Vote': { bg: '#334155', color: '#94a3b8' },
  'Voting Open': { bg: '#16a34a', color: '#fff' },
  'Voting Closed': { bg: '#f59e0b', color: '#fff' },
  'Tallying': { bg: '#3b82f6', color: '#fff' },
  'Results Announced Soon': { bg: '#7c3aed', color: '#fff' },
  'Race Complete': { bg: '#6366f1', color: '#fff' },
};

// ======================== TV MODE ========================
function TVMode({ election, connected }) {
  const raceCount = election.races.length;
  const gridCols = raceCount <= 1 ? '1fr' : raceCount <= 2 ? 'repeat(2, 1fr)' : raceCount <= 4 ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(400px, 1fr))';

  // Build mobile dashboard URL from current location (same path, no ?mode=tv)
  const mobileUrl = `${window.location.origin}${window.location.pathname}`;

  const [latestOnly, setLatestOnly] = useState(() => {
    try { return localStorage.getItem('publicDashboard.latestOnly') === '1'; } catch { return false; }
  });
  const toggleLatestOnly = (checked) => {
    setLatestOnly(checked);
    try { localStorage.setItem('publicDashboard.latestOnly', checked ? '1' : '0'); } catch { /* ignore */ }
  };

  return (
    <div style={tv.container}>
      {!connected && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#dc2626', color: '#fff', textAlign: 'center', padding: '0.5rem', fontWeight: 700, zIndex: 100 }}>
          Reconnecting...
        </div>
      )}
      <h1 style={tv.title}>{election.name}</h1>

      <div style={{ textAlign: 'center', marginTop: '-1.25rem', marginBottom: '1.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.95rem', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={latestOnly}
            onChange={e => toggleLatestOnly(e.target.checked)}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
          Show only the latest round per race
        </label>
      </div>

      <div style={{ ...tv.grid, gridTemplateColumns: gridCols }}>
        {election.races.map(race => {
          const cr = race.current_round;
          const statusStyle = STATUS_BADGE_STYLES[race.status_label] || STATUS_BADGE_STYLES['Awaiting Vote'];
          const isVotingOpen = race.status_label === 'Voting Open';

          return (
            <div key={race.id} style={{ ...tv.raceCard, borderColor: isVotingOpen ? '#16a34a' : '#334155', borderWidth: isVotingOpen ? 2 : 1 }}>
              <div style={tv.raceHeader}>
                <h2 style={tv.raceName}>{race.name}</h2>
                <span style={{ ...tv.statusLabel, background: statusStyle.bg, color: statusStyle.color }}>
                  {race.status_label}
                </span>
              </div>

              {(race.race_date || race.race_time || race.location) && (
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
                  {formatRaceSchedule(race.race_date, race.race_time, race.location)}
                </p>
              )}

              {/* Voting Open banner */}
              {isVotingOpen && cr && (
                <div style={tv.votingBanner}>
                  VOTING OPEN — Round {cr.round_number}
                </div>
              )}

              {/* Voting Closed banner */}
              {race.status_label === 'Voting Closed' && (
                <div style={{ ...tv.votingBanner, background: '#f59e0b' }}>
                  VOTING CLOSED
                </div>
              )}

              {/* Tallying banner */}
              {(race.status_label === 'Tallying') && cr && (
                <div style={{ ...tv.votingBanner, background: '#3b82f6' }}>
                  TALLYING — Round {cr.round_number}
                </div>
              )}

              {/* Candidate list (shown when no published results yet) */}
              {race.rounds.length === 0 && race.candidates && race.candidates.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  {race.candidates.filter(c => c.status === 'active').map(c => (
                    <div key={c.id} style={{ padding: '0.3rem 0', color: '#cbd5e1', fontSize: '1rem' }}>
                      {c.name}
                    </div>
                  ))}
                </div>
              )}

              {/* Published results */}
              {(latestOnly && race.rounds.length > 0 ? [race.rounds[race.rounds.length - 1]] : race.rounds).map((round, ri, arr) => {
                const isLastPublished = ri === arr.length - 1;
                const isFinalRound = isLastPublished && race.status === 'results_finalized';
                const advancingCandidates = round.results?.filter(r => r.outcome === 'advance' || r.outcome === 'convention_winner' || r.outcome === 'winner' || r.outcome === 'advance_to_primary') || [];

                return (
                  <div key={round.id} style={tv.roundSection}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <h3 style={{ ...tv.roundTitle, margin: 0 }}>Round {round.round_number}</h3>
                      {isFinalRound ? (
                        <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.85rem' }}>FINAL RESULTS</span>
                      ) : isLastPublished && !isFinalRound ? (
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Round Complete</span>
                      ) : null}
                    </div>
                    {round.results.map(r => {
                      const pct = Number(r.percentage);
                      const outcome = OUTCOME_BADGES[r.outcome];
                      return (
                        <div key={r.candidate_id} style={{ ...tv.resultRow, opacity: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 0.5 : 1 }}>
                          <span style={{ ...tv.candidateName, textDecoration: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 'line-through' : 'none' }}>
                            {r.candidate_name}
                          </span>
                          {outcome && (
                            <span style={{ background: outcome.bg, color: outcome.color, padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, marginRight: '0.5rem' }}>
                              {outcome.label}
                            </span>
                          )}
                          <div style={tv.barContainer}>
                            <div style={{ ...tv.bar, width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span style={tv.voteCount}>{r.vote_count}</span>
                          <span style={tv.pct}>{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Next round — show advancing candidates */}
              {!latestOnly && race.next_round && race.status !== 'results_finalized' && race.rounds.length > 0 && (() => {
                const lastRound = race.rounds[race.rounds.length - 1];
                const advancing = lastRound.results?.filter(r => r.outcome && r.outcome !== 'eliminated' && r.outcome !== 'withdrew') || [];
                return (
                  <div style={{ ...tv.roundSection, borderTop: '1px solid #334155', paddingTop: '0.75rem' }}>
                    <h3 style={{ ...tv.roundTitle, margin: '0 0 0.5rem' }}>
                      Round {race.next_round.round_number}
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                        {race.next_round.status === 'voting_open' ? 'Voting Open' : 'Pending'}
                      </span>
                    </h3>
                    {advancing.length > 0 ? (
                      advancing.map(r => (
                        <div key={r.candidate_id} style={{ padding: '0.2rem 0', color: '#cbd5e1', fontSize: '0.95rem' }}>
                          {r.candidate_name}
                        </div>
                      ))
                    ) : (
                      race.candidates?.filter(c => c.status === 'active').map(c => (
                        <div key={c.id} style={{ padding: '0.2rem 0', color: '#cbd5e1', fontSize: '0.95rem' }}>
                          {c.name}
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* QR code for mobile access */}
      <div style={tv.qrCorner}>
        <div style={tv.qrBox}>
          <QRCodeSVG value={mobileUrl} size={120} bgColor="#1e293b" fgColor="#e2e8f0" level="M" />
          <p style={tv.qrLabel}>Scan to view results</p>
          <p style={tv.qrLabel}>on your phone</p>
        </div>
      </div>
    </div>
  );
}

const MOB_STATUS_COLORS = {
  'Awaiting Vote': { bg: '#e5e7eb', color: '#6b7280' },
  'Voting Open': { bg: '#dcfce7', color: '#166534' },
  'Voting Closed': { bg: '#fef3c7', color: '#92400e' },
  'Tallying': { bg: '#dbeafe', color: '#1e40af' },
  'Results Announced Soon': { bg: '#ede9fe', color: '#6d28d9' },
  'Race Complete': { bg: '#e0e7ff', color: '#3730a3' },
};

// ======================== MOBILE MODE ========================
function MobileMode({ election, electionId, searchSN, setSearchSN, searchResult, handleSearch, expandedRace, setExpandedRace }) {
  const [snResults, setSnResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Instant SN search as user types
  const handleInstantSearch = async (val) => {
    setSearchSN(val.toUpperCase());
    if (val.length >= 4) {
      setSearching(true);
      try {
        const { data } = await api.get(`/public/${electionId}/search?sn=${val.toUpperCase()}`);
        setSnResults(data.found ? [data] : []);
      } catch {
        setSnResults([]);
      } finally {
        setSearching(false);
      }
    } else {
      setSnResults([]);
    }
  };

  return (
    <div style={mob.container}>
      <h1 style={mob.title}>{election.name}</h1>

      {/* Instant SN Search — controlled at election level */}
      {election.public_search_enabled === true && (
        <div style={{ marginBottom: '1rem' }}>
          <input
            style={mob.searchInput}
            placeholder="Search ballot serial number..."
            value={searchSN}
            onChange={e => handleInstantSearch(e.target.value)}
            maxLength={64}
          />
          {searching && <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: '0.25rem 0' }}>Searching...</p>}
          {snResults.length > 0 && snResults.map(r => (
            <Link key={r.serial_number} to={`/public/${electionId}/ballots/${r.serial_number}`}
              style={{ ...mob.snResultCard, ...(r.ballot_status === 'spoiled' ? { background: '#f3f4f6', borderColor: '#d1d5db' } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.serial_number}</span>
                {r.ballot_status === 'spoiled' && (
                  <span style={{ background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700 }}>
                    SPOILED — NOT COUNTED
                  </span>
                )}
              </div>
              <span style={{ color: '#666', fontSize: '0.8rem' }}>{r.race_name} — Round {r.round_number}</span>
            </Link>
          ))}
          {searchSN.length >= 4 && snResults.length === 0 && !searching && (
            <p style={{ color: '#9ca3af', fontSize: '0.82rem', margin: '0.25rem 0' }}>Ballot not found or results not yet released</p>
          )}
        </div>
      )}

      {/* Browse All link — controlled at election level */}
      {election.public_browse_enabled === true && (
        <Link to={`/public/${electionId}/browse`} style={mob.browseLink}>Browse All Ballots</Link>
      )}

      {/* Race Cards */}
      {election.races.map(race => {
        const isExpanded = expandedRace === race.id;
        const statusStyle = MOB_STATUS_COLORS[race.status_label] || MOB_STATUS_COLORS['Awaiting Vote'];

        return (
          <div key={race.id} style={mob.raceCard}>
            <div style={mob.raceHeader} onClick={() => setExpandedRace(isExpanded ? null : race.id)}>
              <div>
                <h2 style={mob.raceName}>{race.name}</h2>
                {(race.race_date || race.race_time || race.location) && (
                  <span style={{ color: '#666', fontSize: '0.75rem', display: 'block', marginBottom: '0.15rem' }}>
                    {formatRaceSchedule(race.race_date, race.race_time, race.location)}
                  </span>
                )}
                <span style={{ ...mob.statusLabel, background: statusStyle.bg, color: statusStyle.color }}>
                  {race.status_label}
                </span>
              </div>
              <span style={mob.chevron}>{isExpanded ? '▼' : '▶'}</span>
            </div>

            {isExpanded && (
              <div style={mob.raceBody}>
                {/* Candidate list when no results yet */}
                {race.rounds.length === 0 && race.candidates && (
                  <div>
                    <p style={{ ...mob.muted, fontWeight: 600, marginBottom: '0.25rem' }}>Candidates</p>
                    {race.candidates.filter(c => c.status === 'active').map(c => (
                      <div key={c.id} style={{ padding: '0.2rem 0', fontSize: '0.9rem' }}>{c.name}</div>
                    ))}
                  </div>
                )}

                {/* Published rounds */}
                {race.rounds.map((round, ri) => {
                  const isLastPublished = ri === race.rounds.length - 1;
                  const isFinalRound = isLastPublished && race.status === 'results_finalized';

                  return (
                    <div key={round.id} style={mob.roundCard}>
                      <Link to={`/public/${electionId}/rounds/${round.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 700 }}>Round {round.round_number}</span>
                          {isFinalRound && <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.75rem' }}>FINAL RESULTS</span>}
                          {isLastPublished && !isFinalRound && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>Round Complete</span>}
                        </div>
                        {round.results.map(r => {
                          const pct = Number(r.percentage);
                          const outcome = OUTCOME_BADGES[r.outcome];
                          return (
                            <div key={r.candidate_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0', fontSize: '0.85rem', opacity: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 0.5 : 1 }}>
                              <span style={{ fontWeight: 600, textDecoration: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 'line-through' : 'none' }}>
                                {r.candidate_name}
                                {outcome && <span style={{ color: outcome.color, fontSize: '0.7rem', marginLeft: '0.35rem' }}>{outcome.label}</span>}
                              </span>
                              <span style={{ color: '#666' }}>{r.vote_count} ({pct.toFixed(1)}%)</span>
                            </div>
                          );
                        })}
                      </Link>
                    </div>
                  );
                })}

                {/* Next round with advancing candidates */}
                {race.next_round && race.status !== 'results_finalized' && race.rounds.length > 0 && (() => {
                  const lastRound = race.rounds[race.rounds.length - 1];
                  const advancing = lastRound.results?.filter(r => r.outcome && r.outcome !== 'eliminated' && r.outcome !== 'withdrew') || [];
                  return (
                    <div style={{ ...mob.roundCard, borderColor: '#93c5fd', background: '#eff6ff' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                        Round {race.next_round.round_number}
                        <span style={{ color: '#6b7280', fontSize: '0.75rem', marginLeft: '0.5rem', fontWeight: 400 }}>
                          {race.next_round.status === 'voting_open' ? 'Voting Open' : 'Pending'}
                        </span>
                      </div>
                      {advancing.length > 0 ? (
                        advancing.map(r => (
                          <div key={r.candidate_id} style={{ padding: '0.15rem 0', fontSize: '0.85rem' }}>{r.candidate_name}</div>
                        ))
                      ) : (
                        race.candidates?.filter(c => c.status === 'active').map(c => (
                          <div key={c.id} style={{ padding: '0.15rem 0', fontSize: '0.85rem' }}>{c.name}</div>
                        ))
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ======================== TV STYLES ========================
const tv = {
  container: { minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', padding: '2rem', fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: '2.5rem', textAlign: 'center', marginBottom: '2rem', color: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' },
  raceCard: { background: '#1e293b', borderRadius: 12, padding: '1.5rem', border: '1px solid #334155' },
  raceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  raceName: { margin: 0, fontSize: '1.5rem', color: '#fff' },
  statusLabel: { background: '#334155', color: '#94a3b8', padding: '4px 12px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 600 },
  votingBanner: { background: '#16a34a', color: '#fff', padding: '0.75rem', borderRadius: 8, fontWeight: 700, fontSize: '1.2rem', textAlign: 'center', marginBottom: '0.75rem' },
  roundSection: { marginTop: '1rem' },
  roundTitle: { fontSize: '0.9rem', color: '#64748b', marginBottom: '0.5rem' },
  resultRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' },
  candidateName: { width: 140, fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' },
  barContainer: { flex: 1, height: 20, background: '#334155', borderRadius: 10, overflow: 'hidden' },
  bar: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 10, transition: 'width 0.8s ease' },
  voteCount: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#fff' },
  pct: { width: 60, textAlign: 'right', color: '#94a3b8', fontSize: '0.9rem' },
  qrCorner: { position: 'fixed', bottom: 20, right: 20, textAlign: 'center', zIndex: 50 },
  qrBox: { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '0.75rem' },
  qrLabel: { color: '#94a3b8', fontSize: '0.75rem', margin: '0.25rem 0 0' },
  muted: { color: '#475569', fontStyle: 'italic' },
};

// ======================== MOBILE STYLES ========================
const mob = {
  container: { maxWidth: 600, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: '1.5rem', marginBottom: '0.75rem' },
  searchForm: { display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' },
  searchInput: { flex: 1, padding: '0.6rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '1rem', fontFamily: 'monospace', textTransform: 'uppercase' },
  searchBtn: { padding: '0.6rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem' },
  searchError: { color: '#dc2626', fontSize: '0.9rem', marginBottom: '0.5rem' },
  raceCard: { border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: '0.75rem', overflow: 'hidden' },
  raceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', cursor: 'pointer', background: '#f9fafb' },
  raceName: { margin: 0, fontSize: '1.1rem' },
  statusLabel: { padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, marginTop: '0.25rem', display: 'inline-block' },
  chevron: { color: '#9ca3af', fontSize: '0.9rem' },
  raceBody: { padding: '0.5rem 1rem 1rem' },
  roundCard: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.6rem', marginBottom: '0.5rem', background: '#fff' },
  snResultCard: { display: 'block', padding: '0.6rem', border: '1px solid #93c5fd', borderRadius: 6, marginTop: '0.35rem', textDecoration: 'none', color: 'inherit', background: '#eff6ff' },
  browseLink: { display: 'block', textAlign: 'center', padding: '0.6rem', background: '#f3f4f6', borderRadius: 6, color: '#2563eb', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem' },
  muted: { color: '#666', fontStyle: 'italic', fontSize: '0.9rem' },
};
