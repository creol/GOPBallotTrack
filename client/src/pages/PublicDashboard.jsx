import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';
import { formatRaceSchedule } from '../utils/dateFormat';

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
  const [searchSN, setSearchSN] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [expandedRace, setExpandedRace] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get(`/public/${electionId}`);
      setElection(data);
    } catch {}
  }, [electionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // WebSocket for live updates
  useEffect(() => {
    const socket = io();
    socket.on('round:released', () => fetchData());
    return () => socket.disconnect();
  }, [fetchData]);

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

  if (!election) return <div style={isTvMode ? tv.container : mob.container}><p>Loading...</p></div>;

  if (isTvMode) return <TVMode election={election} />;
  return (
    <MobileMode
      election={election}
      electionId={electionId}
      searchSN={searchSN}
      setSearchSN={setSearchSN}
      searchResult={searchResult}
      handleSearch={handleSearch}
      expandedRace={expandedRace}
      setExpandedRace={setExpandedRace}
    />
  );
}

// ======================== TV MODE ========================
function TVMode({ election }) {
  return (
    <div style={tv.container}>
      <h1 style={tv.title}>{election.name}</h1>

      <div style={tv.grid}>
        {election.races.map(race => (
          <div key={race.id} style={tv.raceCard}>
            <div style={tv.raceHeader}>
              <h2 style={tv.raceName}>{race.name}</h2>
              <span style={tv.statusLabel}>{race.status_label}</span>
            </div>
            {(race.race_date || race.race_time || race.location) && (
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
                {formatRaceSchedule(race.race_date, race.race_time, race.location)}
              </p>
            )}

            {race.rounds.length === 0 && (
              <p style={tv.muted}>No results released yet</p>
            )}

            {race.rounds.map(round => (
              <div key={round.id} style={tv.roundSection}>
                <h3 style={tv.roundTitle}>Round {round.round_number}</h3>
                {round.results.map(r => {
                  const pct = Number(r.percentage);
                  return (
                    <div key={r.candidate_id} style={tv.resultRow}>
                      <span style={tv.candidateName}>{r.candidate_name}</span>
                      <div style={tv.barContainer}>
                        <div style={{ ...tv.bar, width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span style={tv.voteCount}>{r.vote_count}</span>
                      <span style={tv.pct}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* TV QR Code */}
      {election.tv_qr?.enabled && election.tv_qr?.url && (
        <div style={tv.qrCorner}>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(election.tv_qr.url)}&size=120x120&bgcolor=1e293b&color=f1f5f9`}
            alt="Mobile dashboard QR"
            style={{ width: 120, height: 120 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <p style={tv.qrLabel}>Scan for mobile view</p>
        </div>
      )}
    </div>
  );
}

// ======================== MOBILE MODE ========================
function MobileMode({ election, electionId, searchSN, setSearchSN, searchResult, handleSearch, expandedRace, setExpandedRace }) {
  return (
    <div style={mob.container}>
      <h1 style={mob.title}>{election.name}</h1>

      {/* SN Search */}
      <form onSubmit={handleSearch} style={mob.searchForm}>
        <input
          style={mob.searchInput}
          placeholder="Search ballot SN..."
          value={searchSN}
          onChange={e => setSearchSN(e.target.value.toUpperCase())}
          maxLength={64}
        />
        <button style={mob.searchBtn} type="submit">Search</button>
      </form>
      {searchResult && !searchResult.found && (
        <p style={mob.searchError}>{searchResult.message}</p>
      )}

      {/* Race Cards */}
      {election.races.map(race => {
        const isExpanded = expandedRace === race.id;
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
                <span style={mob.statusLabel}>{race.status_label}</span>
              </div>
              <span style={mob.chevron}>{isExpanded ? '▼' : '▶'}</span>
            </div>

            {isExpanded && (
              <div style={mob.raceBody}>
                {race.rounds.length === 0 && (
                  <p style={mob.muted}>No results released yet</p>
                )}
                {race.rounds.map(round => (
                  <Link
                    key={round.id}
                    to={`/public/${electionId}/rounds/${round.id}`}
                    style={mob.roundLink}
                  >
                    <span style={{ fontWeight: 600 }}>Round {round.round_number}</span>
                    <div style={{ flex: 1 }}>
                      {round.results.slice(0, 3).map(r => (
                        <span key={r.candidate_id} style={mob.miniResult}>
                          {r.candidate_name}: {r.vote_count}
                        </span>
                      ))}
                    </div>
                    <span style={mob.chevron}>▶</span>
                  </Link>
                ))}
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
  roundSection: { marginTop: '1rem' },
  roundTitle: { fontSize: '0.9rem', color: '#64748b', marginBottom: '0.5rem' },
  resultRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' },
  candidateName: { width: 140, fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' },
  barContainer: { flex: 1, height: 20, background: '#334155', borderRadius: 10, overflow: 'hidden' },
  bar: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 10, transition: 'width 0.8s ease' },
  voteCount: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#fff' },
  pct: { width: 60, textAlign: 'right', color: '#94a3b8', fontSize: '0.9rem' },
  qrCorner: { position: 'fixed', bottom: 20, right: 20, textAlign: 'center' },
  qrLabel: { color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' },
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
  statusLabel: { background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, marginTop: '0.25rem', display: 'inline-block' },
  chevron: { color: '#9ca3af', fontSize: '0.9rem' },
  raceBody: { padding: '0.5rem 1rem 1rem' },
  roundLink: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: '0.5rem', textDecoration: 'none', color: 'inherit' },
  miniResult: { display: 'inline-block', marginRight: '0.75rem', fontSize: '0.8rem', color: '#666' },
  muted: { color: '#666', fontStyle: 'italic', fontSize: '0.9rem' },
};
