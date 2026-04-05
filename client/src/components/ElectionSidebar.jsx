import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api/client';

export default function ElectionSidebar({ electionId }) {
  const [election, setElection] = useState(null);
  const [races, setRaces] = useState([]);
  const [raceRounds, setRaceRounds] = useState({});
  const [expandedRace, setExpandedRace] = useState(null);
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
  const isActive = (href) => path === href;
  const isActivePrefix = (href) => path.startsWith(href);

  const basePath = `/admin/elections/${electionId}`;

  return (
    <nav style={s.sidebar} data-election-sidebar>
      {/* Election name header */}
      <div style={s.sectionHeader}>
        {election?.name || 'Loading...'}
      </div>

      {/* Races with nested rounds/candidates */}
      <Link to={basePath} style={{ ...s.sectionLabel, textDecoration: 'none', color: '#2563eb', cursor: 'pointer' }}>Races</Link>
      {races.map(race => {
        const raceUrl = `${basePath}/races/${race.id}`;
        const isExpanded = expandedRace === race.id;
        const isCurrentRace = isActivePrefix(raceUrl);
        const rounds = raceRounds[race.id] || [];

        return (
          <div key={race.id}>
            <div
              style={{ ...s.navItem, ...(isCurrentRace ? s.navItemActive : {}), cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              onClick={() => setExpandedRace(isExpanded ? null : race.id)}
            >
              <span style={{ marginRight: '0.35rem', fontSize: '0.7rem', color: '#9ca3af' }}>{isExpanded ? '▾' : '▸'}</span>
              <Link to={`${raceUrl}?tab=rounds`} style={{ color: 'inherit', textDecoration: 'none', flex: 1 }} onClick={e => e.stopPropagation()}>
                {race.name}
              </Link>
            </div>

            {isExpanded && (
              <div style={s.nested}>
                {/* Rounds section */}
                <div style={s.subSectionLabel}>Rounds</div>
                {rounds.length === 0 && <div style={{ ...s.nestedItem, color: '#9ca3af', fontStyle: 'italic' }}>No rounds</div>}
                {rounds.map(round => {
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
                {/* Candidates section */}
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

      <div style={s.divider} />

      {/* Other sections as links to ElectionDetail with section param */}
      <Link to={`${basePath}?section=ballots`} style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
        Ballot Generation
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
