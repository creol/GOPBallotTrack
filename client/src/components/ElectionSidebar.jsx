import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api/client';
import { normalizeGroup, sortGroupNames } from '../utils/raceGroups';

export default function ElectionSidebar({ electionId }) {
  const [election, setElection] = useState(null);
  const [races, setRaces] = useState([]);
  const [raceRounds, setRaceRounds] = useState({});
  const [expandedRace, setExpandedRace] = useState(null);
  const [closedGroups, setClosedGroups] = useState(() => {
    try {
      const saved = localStorage.getItem(`raceGroups.closed.${electionId}`);
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });
  const [docsOpen, setDocsOpen] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await api.get(`/admin/elections/${electionId}`);
        setElection(data);
        setRaces(data.races || []);

        // Fetch rounds for each race
        const roundsByRace = {};
        await Promise.all((data.races || []).map(async (race) => {
          try {
            const { data: rounds } = await api.get(`/admin/races/${race.id}/rounds`);
            roundsByRace[race.id] = rounds;
          } catch { roundsByRace[race.id] = []; }
        }));
        setRaceRounds(roundsByRace);

        // Auto-expand the current race from URL
        const raceMatch = location.pathname.match(/\/races\/(\d+)/);
        if (raceMatch) setExpandedRace(parseInt(raceMatch[1]));
      } catch {}
    };
    fetchData();
  }, [electionId]);

  // Determine active state from URL
  const path = location.pathname;
  const basePath = `/admin/elections/${electionId}`;
  const isActivePrefix = (href) => path.startsWith(href);

  // Group races by race_group, in preconfigured-then-alphabetical order.
  const { groupedRaces, groupOrder, activeGroup } = useMemo(() => {
    const map = {};
    let activeRaceId = null;
    const m = path.match(/\/races\/(\d+)/);
    if (m) activeRaceId = parseInt(m[1]);
    let active = null;
    for (const r of races) {
      const g = normalizeGroup(r.race_group);
      if (!map[g]) map[g] = [];
      map[g].push(r);
      if (r.id === activeRaceId) active = g;
    }
    return { groupedRaces: map, groupOrder: sortGroupNames(Object.keys(map)), activeGroup: active };
  }, [races, path]);

  const toggleGroup = (g) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      try { localStorage.setItem(`raceGroups.closed.${electionId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Group containing the active race auto-expands even if user previously closed it,
  // so that navigating to a race always reveals it in the sidebar.
  const isGroupOpen = (g) => g === activeGroup || !closedGroups.has(g);

  return (
    <nav style={s.sidebar} data-election-sidebar>
      {/* Election name header */}
      <div style={s.sectionHeader}>
        {election?.name || 'Loading...'}
      </div>

      {/* Races, grouped */}
      <Link to={basePath} style={{ ...s.sectionLabel, textDecoration: 'none', color: '#2563eb', cursor: 'pointer' }}>Races</Link>
      {groupOrder.map((groupName) => {
        const groupRaces = groupedRaces[groupName] || [];
        const open = isGroupOpen(groupName);
        return (
          <div key={groupName}>
            <div
              style={{ ...s.groupHeader, cursor: 'pointer' }}
              onClick={() => toggleGroup(groupName)}
            >
              <span style={{ marginRight: '0.35rem', fontSize: '0.7rem', color: '#9ca3af' }}>{open ? '▾' : '▸'}</span>
              <span style={{ flex: 1 }}>{groupName}</span>
              <span style={s.groupCount}>{groupRaces.length}</span>
            </div>

            {open && groupRaces.map((race) => {
              const raceUrl = `${basePath}/races/${race.id}`;
              const isExpanded = expandedRace === race.id;
              const isCurrentRace = isActivePrefix(raceUrl);
              const rounds = raceRounds[race.id] || [];

              return (
                <div key={race.id}>
                  <div
                    style={{ ...s.navItem, ...s.groupedNavItem, ...(isCurrentRace ? s.navItemActive : {}), cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    onClick={() => setExpandedRace(isExpanded ? null : race.id)}
                  >
                    <span style={{ marginRight: '0.35rem', fontSize: '0.7rem', color: '#9ca3af' }}>{isExpanded ? '▾' : '▸'}</span>
                    <Link to={`${raceUrl}?tab=rounds`} style={{ color: 'inherit', textDecoration: 'none', flex: 1 }} onClick={(e) => e.stopPropagation()}>
                      {race.name}
                    </Link>
                  </div>

                  {isExpanded && (
                    <div style={s.nested}>
                      <div style={s.subSectionLabel}>Rounds</div>
                      {rounds.length === 0 && <div style={{ ...s.nestedItem, color: '#9ca3af', fontStyle: 'italic' }}>No rounds</div>}
                      {rounds.map((round) => {
                        const roundUrl = `${raceUrl}/rounds/${round.id}`;
                        return (
                          <Link
                            key={round.id}
                            to={roundUrl}
                            style={{ ...s.nestedItem, paddingLeft: '1rem', ...(isActivePrefix(roundUrl) ? s.nestedItemActive : {}) }}
                          >
                            Round {round.round_number}
                            <span style={s.statusDot(round.status)} />
                          </Link>
                        );
                      })}
                      <div style={s.subSectionLabel}>Candidates</div>
                      <Link
                        to={`${raceUrl}?tab=candidates`}
                        style={{ ...s.nestedItem, paddingLeft: '1rem', ...(path.includes(raceUrl) && path.includes('tab=candidates') ? s.nestedItemActive : {}) }}
                      >
                        Manage
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={s.divider} />

      {/* Other sections as links to ElectionDetail with section param */}
      <Link to={`${basePath}?section=ballots`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Ballot Generation
      </Link>
      <Link to={`${basePath}/stickers`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit', ...(isActivePrefix(`${basePath}/stickers`) ? s.navItemActive : {}) }}>
        QR Voter Stickers
      </Link>
      <Link to={`${basePath}?section=boxes`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Ballot Boxes
      </Link>
      <Link to={`${basePath}?section=export`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Export
      </Link>
      <Link to={`${basePath}?section=dashboards`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Dashboards
      </Link>
      <Link to={`${basePath}/logs`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Scan Logs
      </Link>

      <div
        style={{ ...s.navItem, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        onClick={() => setDocsOpen((o) => !o)}
      >
        <span style={{ marginRight: '0.35rem', fontSize: '0.7rem', color: '#9ca3af' }}>{docsOpen ? '▾' : '▸'}</span>
        <span style={{ flex: 1 }}>Documentation</span>
      </div>
      {docsOpen && (
        <div style={s.nested}>
          <Link to="/admin/guides/admin-quickstart" style={{ ...s.nestedItem, paddingLeft: '0.75rem', ...(path === '/admin/guides/admin-quickstart' ? s.nestedItemActive : {}) }}>
            Admin Quick Start
          </Link>
          <Link to="/admin/guides/scan-station" style={{ ...s.nestedItem, paddingLeft: '0.75rem', ...(path === '/admin/guides/scan-station' ? s.nestedItemActive : {}) }}>
            Scan Station Guide
          </Link>
          <Link to="/admin/guides/faq" style={{ ...s.nestedItem, paddingLeft: '0.75rem', ...(path === '/admin/guides/faq' ? s.nestedItemActive : {}) }}>
            Convention FAQ
          </Link>
        </div>
      )}
    </nav>
  );
}

const STATUS_COLORS = {
  pending_needs_action: '#f59e0b',
  ready: '#10b981',
  voting_open: '#3b82f6',
  voting_closed: '#8b5cf6',
  tallying: '#f59e0b',
  round_finalized: '#6366f1',
  canceled: '#6b7280',
};

const s = {
  sidebar: {
    width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1px',
    borderRight: '1px solid #e5e7eb', paddingRight: '0.75rem', overflowY: 'auto',
  },
  sectionHeader: {
    fontSize: '0.95rem', fontWeight: 700, padding: '0.5rem 0.75rem', marginBottom: '0.25rem',
    display: 'block',
  },
  sectionLabel: {
    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    color: '#9ca3af', padding: '0.5rem 0.75rem 0.25rem',
  },
  navItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.45rem 0.75rem', background: 'none', border: 'none', borderLeft: '3px solid transparent',
    fontSize: '0.85rem', color: '#4b5563', borderRadius: '0 4px 4px 0',
  },
  navItemActive: {
    background: '#eff6ff', borderLeft: '3px solid #2563eb',
    color: '#1d4ed8', fontWeight: 600,
  },
  groupHeader: {
    display: 'flex', alignItems: 'center',
    padding: '0.35rem 0.75rem',
    fontSize: '0.78rem', fontWeight: 600, color: '#374151',
    textTransform: 'uppercase', letterSpacing: '0.03em',
  },
  groupCount: {
    background: '#e5e7eb', color: '#6b7280',
    fontSize: '0.65rem', fontWeight: 700,
    padding: '0.05rem 0.4rem', borderRadius: 8,
    minWidth: 20, textAlign: 'center',
  },
  groupedNavItem: {
    paddingLeft: '1.25rem',
  },
  nested: {
    marginLeft: '1rem', borderLeft: '2px solid #e5e7eb', paddingLeft: '0.5rem',
  },
  nestedItem: {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.3rem 0.5rem', fontSize: '0.8rem', color: '#6b7280',
    textDecoration: 'none', borderRadius: 4,
  },
  nestedItemActive: {
    background: '#eff6ff', color: '#1d4ed8', fontWeight: 600,
  },
  subSectionLabel: {
    fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af', padding: '0.4rem 0.5rem 0.15rem',
    textTransform: 'uppercase', letterSpacing: '0.03em',
  },
  divider: {
    height: 1, background: '#e5e7eb', margin: '0.5rem 0.75rem',
  },
  statusDot: (status) => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginLeft: 'auto',
    background: STATUS_COLORS[status] || '#d1d5db',
  }),
};
