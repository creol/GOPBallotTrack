import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import api from '../api/client';
import { formatRaceSchedule } from '../utils/dateFormat';
import { fmtPct } from '../utils/percent';
import { VersionTag } from '../components/AppHeader';
import { normalizeGroup, sortGroupNames } from '../utils/raceGroups';

// Mirror of DEFAULT_COLORS in ElectionDetail.jsx — keep these in sync.
const DEFAULT_COLORS = {
  page_bg:                '#0f172a',
  card_bg:                '#1e293b',
  card_border:            '#334155',
  header_text:            '#ffffff',
  group_header_text:      '#fbbf24',
  candidate_name:         '#e2e8f0',
  vote_bar:               '#3b82f6',
  vote_count_text:        '#ffffff',
  pct_text:               '#94a3b8',
  convention_winner_bg:   '#fef3c7',
  convention_winner_text: '#b45309',
  winner_bg:              '#fef3c7',
  winner_text:            '#b45309',
  advances_bg:            '#dcfce7',
  advances_text:          '#166534',
  advance_to_primary_bg:  '#dbeafe',
  advance_to_primary_text:'#1e40af',
  eliminated_bg:          '#fee2e2',
  eliminated_text:        '#dc2626',
  withdrew_bg:            '#f3f4f6',
  withdrew_text:          '#6b7280',
};

const DEFAULT_DASHBOARD_SETTINGS = {
  layout_mode: 'all',
  rotation_seconds: 0,
  auto_scroll: true,
  custom_header: '',
  logo_path: '',
  logo_position: 'top_center',
  show_vote_bar: true,
  colors: { ...DEFAULT_COLORS },
};

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
  const latestOnly = searchParams.get('latest') === '1';

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

// Returns the set of candidate_ids who were eliminated or withdrew in any round
// strictly before `roundNumber`. Used to drop those names from later rounds so the
// dashboard only lists candidates still in contention at that point in the race.
function removedBeforeRound(rounds, roundNumber) {
  const removed = new Set();
  for (const round of rounds || []) {
    if (round.round_number >= roundNumber) continue;
    for (const r of round.results || []) {
      if (r.outcome === 'eliminated' || r.outcome === 'withdrew') {
        removed.add(r.candidate_id);
      }
    }
  }
  return removed;
}

// Renders the dashboard's top header per the branding settings: optional logo
// (top center, inline left, inline right, or hidden) and either a custom header
// string or the election name as fallback.
function DashboardHeader({ settings, fallbackName, colors }) {
  const text = (settings.custom_header || '').trim() || fallbackName;
  const pos = settings.logo_position || 'top_center';
  const hasLogo = !!settings.logo_path && pos !== 'none';
  const logoImg = hasLogo ? <img src={settings.logo_path} alt="" style={tv.logo} /> : null;
  const titleStyle = { ...tv.title, color: colors?.header_text || tv.title.color };

  if (hasLogo && pos === 'top_center') {
    return (
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        {logoImg}
        <h1 style={{ ...titleStyle, marginTop: '0.75rem' }}>{text}</h1>
      </div>
    );
  }
  if (hasLogo && (pos === 'inline_left' || pos === 'inline_right')) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', marginBottom: '1.5rem' }}>
        {pos === 'inline_left' && logoImg}
        <h1 style={{ ...titleStyle, margin: 0 }}>{text}</h1>
        {pos === 'inline_right' && logoImg}
      </div>
    );
  }
  return <h1 style={titleStyle}>{text}</h1>;
}

// ======================== TV MODE ========================
// Wide-mode TV layout: shows only the latest published round per race. Honors
// dashboard_settings on the election: layout_mode (all / grouped / rotating),
// rotation_seconds (cycle interval per category), auto_scroll (marquee scroll
// when content overflows the viewport).
function TVMode({ election, connected }) {
  const settings = useMemo(
    () => ({ ...DEFAULT_DASHBOARD_SETTINGS, ...(election.dashboard_settings || {}) }),
    [election.dashboard_settings]
  );
  // Resolved color palette: merge admin overrides on top of the defaults so any
  // missing slot still has a sane value.
  const c = useMemo(
    () => ({ ...DEFAULT_COLORS, ...(election.dashboard_settings?.colors || {}) }),
    [election.dashboard_settings]
  );
  // Per-outcome badge colors are derived from the palette, not from the static
  // OUTCOME_BADGES const, so admin color overrides flow through to badges.
  const outcomeBadge = (outcome) => {
    const map = {
      eliminated: { bg: c.eliminated_bg, color: c.eliminated_text, label: 'Eliminated' },
      withdrew: { bg: c.withdrew_bg, color: c.withdrew_text, label: 'Withdrew' },
      advance: { bg: c.advances_bg, color: c.advances_text, label: 'Advances' },
      convention_winner: { bg: c.convention_winner_bg, color: c.convention_winner_text, label: 'Convention Winner' },
      winner: { bg: c.winner_bg, color: c.winner_text, label: 'Winner' },
      advance_to_primary: { bg: c.advance_to_primary_bg, color: c.advance_to_primary_text, label: 'Advances to Primary' },
    };
    return map[outcome] || null;
  };

  // Group races by race_group; preserves display_order within each group (the API
  // already returns races sorted by display_order).
  const { groups, groupNames } = useMemo(() => {
    const byGroup = {};
    for (const race of election.races) {
      const g = normalizeGroup(race.race_group);
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(race);
    }
    return { groups: byGroup, groupNames: sortGroupNames(Object.keys(byGroup)) };
  }, [election.races]);

  // Rotation: cycle the active category index every N seconds. Disabled when
  // layout_mode != 'rotating' or rotation_seconds <= 0.
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (settings.layout_mode !== 'rotating' || settings.rotation_seconds <= 0 || groupNames.length <= 1) return;
    const ms = settings.rotation_seconds * 1000;
    const t = setInterval(() => setActiveIdx(i => (i + 1) % groupNames.length), ms);
    return () => clearInterval(t);
  }, [settings.layout_mode, settings.rotation_seconds, groupNames.length]);
  // Reset rotation index if the group list shrinks below the current index.
  useEffect(() => {
    if (activeIdx >= groupNames.length) setActiveIdx(0);
  }, [groupNames.length, activeIdx]);

  // Auto-scroll: when the page content overflows the viewport, gently scroll the
  // window down 1px per ~50ms, pause at the bottom, jump back to top, repeat. Pure
  // window scroll keeps existing layout untouched and works regardless of grid mode.
  useEffect(() => {
    if (!settings.auto_scroll) return;
    let raf, paused = false, dir = 1;
    const tick = () => {
      if (!paused) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max <= 4) { raf = requestAnimationFrame(tick); return; }
        const next = window.scrollY + dir;
        if (dir > 0 && next >= max) {
          paused = true;
          setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); paused = false; }, 2500);
        } else {
          window.scrollTo(0, next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    let last = performance.now();
    const loop = (t) => {
      if (t - last >= 40) { last = t; tick(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [settings.auto_scroll, settings.layout_mode, activeIdx]);

  // Decide which group(s) to render this tick.
  const visibleGroupNames = settings.layout_mode === 'rotating' && settings.rotation_seconds > 0
    ? [groupNames[activeIdx] || groupNames[0]].filter(Boolean)
    : groupNames;
  const showGroupHeaders = settings.layout_mode !== 'all' && groupNames.length > 0;

  // Build mobile dashboard URL from current location (same path, no ?mode=tv)
  const mobileUrl = `${window.location.origin}${window.location.pathname}`;

  const renderRaceCard = (race) => {
    const cr = race.current_round;
    const statusStyle = STATUS_BADGE_STYLES[race.status_label] || STATUS_BADGE_STYLES['Awaiting Vote'];
    const isVotingOpen = race.status_label === 'Voting Open';

    return (
      <div key={race.id} style={{ ...tv.raceCard, background: c.card_bg, borderColor: isVotingOpen ? '#16a34a' : c.card_border, borderWidth: isVotingOpen ? 2 : 1 }}>
        <div style={tv.raceHeader}>
          <h2 style={{ ...tv.raceName, color: c.header_text }}>{race.name}</h2>
          <span style={{ ...tv.statusLabel, background: statusStyle.bg, color: statusStyle.color }}>
            {race.status_label}
          </span>
        </div>

        {(race.race_date || race.race_time || race.location) && (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            {formatRaceSchedule(race.race_date, race.race_time, race.location)}
          </p>
        )}

        {isVotingOpen && cr && (
          <div style={tv.votingBanner}>VOTING OPEN — Round {cr.round_number}</div>
        )}
        {race.status_label === 'Voting Closed' && (
          <div style={{ ...tv.votingBanner, background: '#f59e0b' }}>VOTING CLOSED</div>
        )}
        {(race.status_label === 'Tallying') && cr && (
          <div style={{ ...tv.votingBanner, background: '#3b82f6' }}>TALLYING — Round {cr.round_number}</div>
        )}

        {race.rounds.length === 0 && race.candidates && race.candidates.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            {race.candidates.filter(c => c.status === 'active').map(c => (
              <div key={c.id} style={{ padding: '0.3rem 0', color: '#cbd5e1', fontSize: '1rem' }}>{c.name}</div>
            ))}
          </div>
        )}

        {race.rounds.length > 0 && (() => {
          const round = race.rounds[race.rounds.length - 1];
          const isFinalRound = race.status === 'results_finalized';
          const removed = removedBeforeRound(race.rounds, round.round_number);
          const visibleResults = (round.results || []).filter(r => !removed.has(r.candidate_id));
          return (
            <div key={round.id} style={tv.roundSection}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <h3 style={{ ...tv.roundTitle, margin: 0 }}>Round {round.round_number}</h3>
                {isFinalRound
                  ? <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.85rem' }}>FINAL RESULTS</span>
                  : <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Round Complete</span>}
              </div>
              {visibleResults.map(r => {
                const pct = Number(r.percentage);
                const outcome = outcomeBadge(r.outcome);
                return (
                  <div key={r.candidate_id} style={{ ...tv.resultRow, opacity: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 0.5 : 1 }}>
                    <span style={{ ...tv.candidateName, color: c.candidate_name, textDecoration: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 'line-through' : 'none' }}>
                      {r.candidate_name}
                    </span>
                    {outcome && (
                      <span style={{ background: outcome.bg, color: outcome.color, padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700, marginRight: '0.5rem' }}>
                        {outcome.label}
                      </span>
                    )}
                    {settings.show_vote_bar !== false && (
                      <div style={tv.barContainer}>
                        <div style={{ ...tv.bar, width: `${Math.min(pct, 100)}%`, background: c.vote_bar }} />
                      </div>
                    )}
                    <span style={{ ...tv.voteCount, color: c.vote_count_text }}>{r.vote_count}</span>
                    <span style={{ ...tv.pct, color: c.pct_text }}>{fmtPct(r.percentage, election.dashboard_decimals)}%</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  };

  // Build a grid for one set of races. Column layout matches the prior single-grid
  // behavior so a Grouped or Rotating render of 4 races looks the same as the old
  // ungrouped 4-race grid.
  const renderRaceGrid = (races) => {
    const n = races.length;
    const gridCols = n <= 1 ? '1fr' : n <= 4 ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(400px, 1fr))';
    return (
      <div style={{ ...tv.grid, gridTemplateColumns: gridCols }}>
        {races.map(renderRaceCard)}
      </div>
    );
  };

  return (
    <div style={{ ...tv.container, background: c.page_bg }}>
      {!connected && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#dc2626', color: '#fff', textAlign: 'center', padding: '0.5rem', fontWeight: 700, zIndex: 100 }}>
          Reconnecting...
        </div>
      )}
      <DashboardHeader settings={settings} fallbackName={election.name} colors={c} />

      {visibleGroupNames.map(groupName => (
        <div key={groupName} style={{ marginBottom: '1.5rem' }}>
          {showGroupHeaders && (
            <h2 style={{ ...tv.groupHeader, color: c.group_header_text }}>{groupName}</h2>
          )}
          {renderRaceGrid(groups[groupName] || [])}
        </div>
      ))}

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

                {/* Published rounds — hide candidates eliminated/withdrew in earlier rounds */}
                {race.rounds.map((round, ri) => {
                  const isLastPublished = ri === race.rounds.length - 1;
                  const isFinalRound = isLastPublished && race.status === 'results_finalized';
                  const removed = removedBeforeRound(race.rounds, round.round_number);
                  const visibleResults = (round.results || []).filter(r => !removed.has(r.candidate_id));

                  return (
                    <div key={round.id} style={mob.roundCard}>
                      <Link to={`/public/${electionId}/rounds/${round.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 700 }}>Round {round.round_number}</span>
                          {isFinalRound && <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.75rem' }}>FINAL RESULTS</span>}
                          {isLastPublished && !isFinalRound && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>Round Complete</span>}
                        </div>
                        {visibleResults.map(r => {
                          const pct = Number(r.percentage);
                          const outcome = OUTCOME_BADGES[r.outcome];
                          return (
                            <div key={r.candidate_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0', fontSize: '0.85rem', opacity: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 0.5 : 1 }}>
                              <span style={{ fontWeight: 600, textDecoration: (r.outcome === 'eliminated' || r.outcome === 'withdrew') ? 'line-through' : 'none' }}>
                                {r.candidate_name}
                                {outcome && <span style={{ color: outcome.color, fontSize: '0.7rem', marginLeft: '0.35rem' }}>{outcome.label}</span>}
                              </span>
                              <span style={{ color: '#666' }}>{r.vote_count} ({fmtPct(r.percentage, election.dashboard_decimals)}%)</span>
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
  groupHeader: { color: '#fbbf24', fontSize: '1.6rem', margin: '0.25rem 0 0.75rem', borderBottom: '2px solid #334155', paddingBottom: '0.4rem', letterSpacing: '0.05em', textTransform: 'uppercase' },
  logo: { maxHeight: 96, maxWidth: 320, objectFit: 'contain', display: 'inline-block' },
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
