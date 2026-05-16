import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import { formatDate, toInputDate } from '../utils/dateFormat';
import RaceGroupSelect from '../components/RaceGroupSelect';
import { DEFAULT_GROUP } from '../utils/raceGroups';

const NAV_ITEMS = [
  { key: 'races', label: 'Races' },
  { key: 'ballots', label: 'Ballot Generation' },
  { key: 'boxes', label: 'Ballot Boxes' },
  { key: 'scanners', label: 'Scanners' },
  { key: 'export', label: 'Export' },
  { key: 'dashboards', label: 'Dashboards' },
  { key: 'logs', label: 'Scan Logs' },
];

export default function ElectionDetail() {
  const { id } = useParams();
  const [election, setElection] = useState(null);
  const [ballotBoxes, setBallotBoxes] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', description: '' });
  const [raceForm, setRaceForm] = useState({ name: '', ballot_count: '', max_rounds: '', race_date: '', race_time: '', location: '', race_group: DEFAULT_GROUP });
  const [showRaceForm, setShowRaceForm] = useState(false);
  const [boxCount, setBoxCount] = useState('');
  const [raceRounds, setRaceRounds] = useState({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSection = searchParams.get('section') || 'races';

  const fetchElection = async () => {
    const { data } = await api.get(`/admin/elections/${id}`);
    setElection(data);
    setForm({ name: data.name, date: toInputDate(data.date), description: data.description || '' });

    // Fetch rounds for each race
    if (data.races?.length) {
      const roundsByRace = {};
      await Promise.all(data.races.map(async (race) => {
        try {
          const { data: rounds } = await api.get(`/admin/races/${race.id}/rounds`);
          roundsByRace[race.id] = rounds;
        } catch { roundsByRace[race.id] = []; }
      }));
      setRaceRounds(roundsByRace);
    }
  };

  const fetchBoxes = async () => {
    const { data } = await api.get(`/admin/elections/${id}/ballot-boxes`);
    setBallotBoxes(data);
  };

  useEffect(() => { fetchElection(); fetchBoxes(); }, [id]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    await api.put(`/admin/elections/${id}`, form);
    setEditing(false);
    fetchElection();
  };

  const handleAddRace = async (e) => {
    e.preventDefault();
    const { data: newRace } = await api.post(`/admin/elections/${id}/races`, {
      name: raceForm.name,
      ballot_count: raceForm.ballot_count ? parseInt(raceForm.ballot_count) : null,
      max_rounds: raceForm.max_rounds ? parseInt(raceForm.max_rounds) : null,
      race_date: raceForm.race_date || null,
      race_time: raceForm.race_time || null,
      location: raceForm.location || null,
      race_group: raceForm.race_group || DEFAULT_GROUP,
    });
    setRaceForm({ name: '', ballot_count: '', max_rounds: '', race_date: '', race_time: '', location: '', race_group: DEFAULT_GROUP });
    setShowRaceForm(false);
    navigate(`/admin/elections/${id}/races/${newRace.id}?tab=candidates`);
  };

  const handleAddBoxes = async (e) => {
    e.preventDefault();
    const count = parseInt(boxCount);
    if (!count || count < 1) return;
    const startNum = ballotBoxes.length + 1;
    for (let i = 0; i < count; i++) {
      await api.post(`/admin/elections/${id}/ballot-boxes`, { name: `Box ${startNum + i}` });
    }
    setBoxCount('');
    fetchBoxes();
  };

  const handleDeleteBox = async (boxId) => {
    await api.delete(`/admin/ballot-boxes/${boxId}`);
    fetchBoxes();
  };

  // ─── Race reordering + visibility toggle ────────────────────────────────
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const handleRaceDragStart = (index) => { dragItem.current = index; };
  const handleRaceDragEnter = (index) => { dragOver.current = index; };
  const handleRaceDragEnd = async () => {
    if (dragItem.current == null || dragOver.current == null || dragItem.current === dragOver.current) {
      dragItem.current = null; dragOver.current = null; return;
    }
    const items = [...(election.races || [])];
    const moved = items[dragItem.current];
    items.splice(dragItem.current, 1);
    items.splice(dragOver.current, 0, moved);
    dragItem.current = null;
    dragOver.current = null;
    // Optimistic update
    setElection({ ...election, races: items });
    try {
      await api.put(`/admin/elections/${id}/races/reorder`, { race_ids: items.map(r => r.id) });
    } catch {
      fetchElection(); // rollback on failure
    }
  };

  const toggleRaceVisibility = async (raceId, newValue) => {
    // Optimistic update
    setElection({
      ...election,
      races: (election.races || []).map(r => r.id === raceId ? { ...r, dashboard_visible: newValue } : r),
    });
    try {
      await api.put(`/admin/races/${raceId}`, { dashboard_visible: newValue });
    } catch {
      fetchElection();
    }
  };

  if (!election) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', in_progress: '#3b82f6', results_finalized: '#6366f1' };
  const roundStatusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', voting_open: '#3b82f6', voting_closed: '#8b5cf6', tallying: '#f59e0b', round_finalized: '#6366f1', canceled: '#6b7280' };

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: election.name },
    ]}>
      {/* Election Info — always visible */}
      {editing ? (
        <form onSubmit={handleUpdate} style={styles.form}>
          <input style={styles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input style={styles.input} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
          <input style={styles.input} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" />
          <button style={styles.btnPrimary} type="submit">Save</button>
          <button style={styles.btnSmall} type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <div style={styles.header}>
          <div>
            <h1>{election.name}</h1>
            <p style={styles.muted}>{formatDate(election.date)}</p>
            {election.description && <p>{election.description}</p>}
          </div>
          <button style={styles.btnSmall} onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}

      {/* Public Ballot Visibility Settings */}
      <div style={styles.ballotVisibilitySection}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151' }}>Public Ballot Visibility</span>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={election.public_search_enabled === true}
            onChange={async (e) => {
              await api.put(`/admin/elections/${id}`, { public_search_enabled: e.target.checked });
              fetchElection();
            }}
          />
          Allow search by serial number
        </label>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={election.public_browse_enabled === true}
            onChange={async (e) => {
              await api.put(`/admin/elections/${id}`, { public_browse_enabled: e.target.checked });
              fetchElection();
            }}
          />
          Allow scrolling through all ballots
        </label>
      </div>

          {activeSection === 'races' && (
            <div>
              <div style={styles.sectionHeader}>
                <h2>Races</h2>
                <button style={styles.btnPrimary} onClick={() => setShowRaceForm(!showRaceForm)}>
                  {showRaceForm ? 'Cancel' : 'Add Race'}
                </button>
              </div>

              {showRaceForm && (
                <form onSubmit={handleAddRace} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 500 }}>
                  <input style={styles.input} placeholder="Race Name" value={raceForm.name}
                    onChange={e => setRaceForm({ ...raceForm, name: e.target.value })} required />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input style={{ ...styles.input, flex: 1 }} type="number" min="1" placeholder="# of Ballots"
                      value={raceForm.ballot_count} onChange={e => setRaceForm({ ...raceForm, ballot_count: e.target.value })} required />
                    <input style={{ ...styles.input, flex: 1 }} type="number" min="1" placeholder="Max Rounds"
                      value={raceForm.max_rounds} onChange={e => setRaceForm({ ...raceForm, max_rounds: e.target.value })} required />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input style={{ ...styles.input, flex: 1 }} type="date" value={raceForm.race_date}
                      onChange={e => setRaceForm({ ...raceForm, race_date: e.target.value })} />
                    <input style={{ ...styles.input, flex: 1 }} type="time" value={raceForm.race_time}
                      onChange={e => setRaceForm({ ...raceForm, race_time: e.target.value })} />
                  </div>
                  <input style={styles.input} placeholder="Location (optional)" value={raceForm.location}
                    onChange={e => setRaceForm({ ...raceForm, location: e.target.value })} />
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.85rem', color: '#374151' }}>Group:</label>
                    <RaceGroupSelect
                      value={raceForm.race_group}
                      onChange={(g) => setRaceForm({ ...raceForm, race_group: g })}
                      existing={election.races || []}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <button style={{ ...styles.btnPrimary, alignSelf: 'flex-start' }} type="submit">Add Candidates →</button>
                </form>
              )}

              {(!election.races || election.races.length === 0) && <p style={styles.muted}>No races yet.</p>}
              {election.races && election.races.length > 1 && (
                <p style={styles.muted}>Drag the handle (⠿) to reorder. Toggle the eye icon to hide a race from the public dashboard.</p>
              )}
              {election.races?.map((race, index) => {
                const visible = race.dashboard_visible !== false;
                return (
                <div
                  key={race.id}
                  draggable
                  onDragStart={() => handleRaceDragStart(index)}
                  onDragEnter={() => handleRaceDragEnter(index)}
                  onDragEnd={handleRaceDragEnd}
                  onDragOver={e => e.preventDefault()}
                  style={{ marginBottom: '1rem' }}
                >
                  <div style={styles.raceCardRow}>
                    <span style={styles.dragHandle} title="Drag to reorder">⠿</span>
                    <Link to={`/admin/elections/${id}/races/${race.id}`} style={{ ...styles.raceCard, flex: 1, opacity: visible ? 1 : 0.6 }}>
                      <span style={styles.raceName}>{race.name}</span>
                      <span style={{ ...styles.statusBadge, background: statusColor[race.status] || '#999' }}>{race.status}</span>
                    </Link>
                    <button
                      type="button"
                      style={{
                        ...styles.visibilityBtn,
                        background: visible ? '#dcfce7' : '#fee2e2',
                        color: visible ? '#166534' : '#dc2626',
                        borderColor: visible ? '#86efac' : '#fca5a5',
                      }}
                      onClick={() => toggleRaceVisibility(race.id, !visible)}
                      title={visible ? 'Visible on public dashboard — click to hide' : 'Hidden from public dashboard — click to show'}
                    >
                      {visible ? '👁 Visible' : '⊘ Hidden'}
                    </button>
                  </div>
                  {raceRounds[race.id]?.length > 0 && (
                    <div style={styles.roundsList}>
                      {raceRounds[race.id].map(round => (
                        <Link
                          key={round.id}
                          to={`/admin/elections/${id}/races/${race.id}/rounds/${round.id}`}
                          style={styles.roundRow}
                        >
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Round {round.round_number}</span>
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>{round.paper_color}</span>
                          <span style={{ ...styles.roundStatusBadge, background: roundStatusColor[round.status] || '#999' }}>
                            {round.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}

          {activeSection === 'ballots' && <GenerateAllBallots electionId={id} />}

          {activeSection === 'boxes' && (
            <div>
              <h2>Ballot Boxes</h2>
              <form onSubmit={handleAddBoxes} style={styles.form}>
                <input style={{ ...styles.input, width: 120 }} type="number" min="1" placeholder="How many?"
                  value={boxCount} onChange={e => setBoxCount(e.target.value)} />
                <button style={styles.btnPrimary} type="submit">Add Boxes</button>
              </form>
              {ballotBoxes.length === 0 && <p style={styles.muted}>No ballot boxes.</p>}
              {ballotBoxes.map(box => (
                <div key={box.id} style={styles.boxRow}>
                  <span>{box.name}</span>
                  <button style={styles.btnDanger} onClick={() => handleDeleteBox(box.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {activeSection === 'scanners' && <ScannersSection electionId={id} />}

          {activeSection === 'export' && <ExportSection electionId={id} />}

          {activeSection === 'dashboards' && <DashboardsSection electionId={id} />}

          {activeSection === 'logs' && (
            <div>
              <h2>Scan Logs</h2>
              <p style={{ color: '#6b7280', marginBottom: '1rem' }}>View agent and server scan processing logs for this election.</p>
              <Link to={`/admin/elections/${id}/logs`} style={{ display: 'inline-block', padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: '0.9rem' }}>
                Open Log Viewer
              </Link>
            </div>
          )}
    </ElectionLayout>
  );
}

function ScannersSection({ electionId }) {
  const [scanners, setScanners] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');

  const fetchScanners = async () => {
    try {
      const { data } = await api.get(`/admin/elections/${electionId}/scanners`);
      setScanners(data);
    } catch {}
  };

  useEffect(() => { fetchScanners(); }, [electionId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post(`/admin/elections/${electionId}/scanners`, { name });
    setName('');
    setShowForm(false);
    fetchScanners();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this scanner?')) return;
    await api.delete(`/admin/scanners/${id}`);
    fetchScanners();
  };

  return (
    <div>
      <div style={styles.sectionHeader}>
        <h2>Scanners</h2>
        <button style={styles.btnPrimary} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Scanner'}
        </button>
      </div>

      {showForm && (
        <>
          <form onSubmit={handleAdd} style={styles.form}>
            <input style={styles.input} placeholder="Scanner Name (e.g. ScanSnap1)" value={name}
              onChange={e => setName(e.target.value)} required />
            <button style={styles.btnPrimary} type="submit">Add</button>
          </form>
          <p style={styles.muted}>
            The watch folder will be auto-created at: <code>data/scans/{'{name}'}/incoming/</code>
            — configure your scanner software to save files there.
          </p>
        </>
      )}

      {scanners.length === 0 && <p style={styles.muted}>No scanners registered.</p>}
      {scanners.map(s => (
        <div key={s.id} style={styles.boxRow}>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600 }}>{s.name}</span>
            <span style={styles.muted}> — {s.watch_folder_path.replace('/app/', '')}</span>
          </div>
          <span style={{
            padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600,
            background: s.status === 'active' ? '#dcfce7' : '#fee2e2',
            color: s.status === 'active' ? '#166534' : '#dc2626',
          }}>
            {s.status}
          </span>
          <button style={styles.btnDanger} onClick={() => handleDelete(s.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

// Default settings shape for the public dashboard. Anything missing on the election
// row falls back here at render time, so existing elections without the JSONB
// populated still render the same as before.
// Color palette slots — each slot is independently overridable by the admin and
// applied at render time on the public dashboard. Values are CSS color strings
// (hex or rgb()). Mirror this object in PublicDashboard.jsx — see DEFAULT_COLORS.
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

// Human-friendly labels and grouping for the color picker UI.
const COLOR_GROUPS = [
  { title: 'Page & Cards', slots: [
    ['page_bg', 'Page background'],
    ['card_bg', 'Race card background'],
    ['card_border', 'Race card border'],
  ]},
  { title: 'Text', slots: [
    ['header_text', 'Election header text'],
    ['group_header_text', 'Race group header'],
    ['candidate_name', 'Candidate name'],
    ['vote_count_text', 'Vote count'],
    ['pct_text', 'Percentage'],
  ]},
  { title: 'Vote Bar', slots: [
    ['vote_bar', 'Vote bar fill'],
  ]},
  { title: 'Outcome Badges', slots: [
    ['convention_winner_bg', 'Convention Winner — background'],
    ['convention_winner_text', 'Convention Winner — text'],
    ['winner_bg', 'Winner — background'],
    ['winner_text', 'Winner — text'],
    ['advances_bg', 'Advances — background'],
    ['advances_text', 'Advances — text'],
    ['advance_to_primary_bg', 'Advances to Primary — background'],
    ['advance_to_primary_text', 'Advances to Primary — text'],
    ['eliminated_bg', 'Eliminated — background'],
    ['eliminated_text', 'Eliminated — text'],
    ['withdrew_bg', 'Withdrew — background'],
    ['withdrew_text', 'Withdrew — text'],
  ]},
];

const DEFAULT_DASHBOARD_SETTINGS = {
  layout_mode: 'all',          // 'all' | 'grouped' | 'rotating'
  rotation_seconds: 0,          // 0 = no rotation; ignored unless layout_mode === 'rotating'
  auto_scroll: true,            // marquee-style vertical scroll when content overflows
  auto_scroll_speed: 1,         // 1 (slow, ~25 px/s) – 10 (fast, ~250 px/s); ignored when auto_scroll = false
  auto_scroll_start_delay: 3,   // seconds to wait at the top before scrolling begins (also re-applied after each category rotation)
  custom_header: '',            // empty = use election.name
  logo_path: '',                // public URL to uploaded logo
  logo_position: 'top_center',  // 'top_center' | 'inline_left' | 'inline_right' | 'none'
  qr_position: 'bottom_right',  // 'bottom_right' | 'bottom_left' | 'top_right' | 'top_left' | 'hidden'
  show_vote_bar: true,          // toggle the visual vote-bar in result rows
  show_all_rounds: false,       // false = show only the latest round per race; true = show every completed round
  colors: { ...DEFAULT_COLORS },
};

function DashboardsSection({ electionId }) {
  const [decimals, setDecimals] = useState(null);
  const [savingDecimals, setSavingDecimals] = useState(false);
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    api.get(`/admin/elections/${electionId}`)
      .then(({ data }) => {
        setDecimals(data.dashboard_decimals ?? 3);
        setSettings({ ...DEFAULT_DASHBOARD_SETTINGS, ...(data.dashboard_settings || {}) });
      })
      .catch(() => { setDecimals(3); setSettings({ ...DEFAULT_DASHBOARD_SETTINGS }); });
  }, [electionId]);

  const handleDecimalsChange = async (e) => {
    const next = parseInt(e.target.value, 10);
    setDecimals(next);
    setSavingDecimals(true);
    try {
      await api.put(`/admin/elections/${electionId}`, { dashboard_decimals: next });
    } catch {
      alert('Failed to save decimal places.');
    } finally {
      setSavingDecimals(false);
    }
  };

  // Patch a subset of dashboard_settings; server merges into the JSONB column so
  // siblings (colors, branding, etc.) stay intact across edits.
  const patchSettings = async (patch) => {
    setSettings(prev => ({ ...prev, ...patch }));
    setSavingSettings(true);
    try {
      await api.put(`/admin/elections/${electionId}`, { dashboard_settings: patch });
    } catch {
      alert('Failed to save dashboard settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const publicUrl = `${window.location.origin}/public/${electionId}`;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => alert('URL copied!')).catch(() => {});
  };

  // Sample percentage to demonstrate truncation. 33.33333% — the classic three-way split.
  const sampleRaw = '33.33333';
  const samplePreview = decimals == null ? '…' : (() => {
    const [intPart, decPart = ''] = sampleRaw.split('.');
    const t = decimals > 0 ? decPart.slice(0, decimals).replace(/0+$/, '') : '';
    return t ? `${intPart}.${t}` : intPart;
  })();

  return (
    <div>
      <h2>Dashboards</h2>
      <p style={styles.muted}>Share this link with attendees. It works on any device on the local network.</p>

      <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
          <span><strong>Percentage decimal places:</strong></span>
          <select
            value={decimals ?? 3}
            onChange={handleDecimalsChange}
            disabled={decimals == null || savingDecimals}
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.9rem', borderRadius: 4, border: '1px solid #d1d5db' }}
          >
            {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ ...styles.muted, fontSize: '0.82rem' }}>
            Sample: <code>{sampleRaw}%</code> displays as <code>{samplePreview}%</code>
          </span>
          {savingDecimals && <span style={{ ...styles.muted, fontSize: '0.78rem' }}>Saving…</span>}
        </label>
        <p style={{ ...styles.muted, margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
          Percentages are <strong>always truncated, never rounded</strong> (party rule). Trailing zeros are stripped. Applies to every public and admin dashboard view for this election.
        </p>
      </div>

      {/* Wide-mode (TV) layout controls — applies only to the public dashboard at >1200px width or ?mode=tv. */}
      {settings && (
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Wide-mode Layout</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', alignItems: 'center', fontSize: '0.9rem' }}>
            <label style={{ fontWeight: 600 }}>Display mode:</label>
            <select
              value={settings.layout_mode}
              onChange={(e) => patchSettings({ layout_mode: e.target.value })}
              disabled={savingSettings}
              style={{ padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db', maxWidth: 360 }}
            >
              <option value="all">All races (no grouping)</option>
              <option value="grouped">Grouped by category, all visible</option>
              <option value="rotating">Rotate one category at a time</option>
            </select>

            <label style={{ fontWeight: 600 }}>Rotation interval:</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="number"
                min={0}
                max={600}
                step={1}
                value={settings.rotation_seconds}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(600, parseInt(e.target.value, 10) || 0));
                  patchSettings({ rotation_seconds: n });
                }}
                disabled={savingSettings || settings.layout_mode !== 'rotating'}
                style={{ width: 90, padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db' }}
              />
              <span style={styles.muted}>seconds per category — 0 disables rotation and shows all categories at once.</span>
            </div>

            <label style={{ fontWeight: 600 }}>Rounds shown:</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={!!settings.show_all_rounds}
                onChange={(e) => patchSettings({ show_all_rounds: e.target.checked })}
                disabled={savingSettings}
              />
              <span style={styles.muted}>Show every completed round for each race. When off, only the most recent round is shown.</span>
            </label>

            <label style={{ fontWeight: 600 }}>Auto-scroll:</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={!!settings.auto_scroll}
                onChange={(e) => patchSettings({ auto_scroll: e.target.checked })}
                disabled={savingSettings}
              />
              <span style={styles.muted}>Smoothly scroll the race grid when it overflows the screen.</span>
            </label>

            <label style={{ fontWeight: 600 }}>Scroll speed:</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={settings.auto_scroll_speed ?? 1}
                onChange={(e) => patchSettings({ auto_scroll_speed: parseInt(e.target.value, 10) })}
                disabled={savingSettings || !settings.auto_scroll}
                style={{ width: 200 }}
              />
              <span style={{ fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>{settings.auto_scroll_speed ?? 1}</span>
              <span style={styles.muted}>1 = slowest (~25 px/s), 10 = fastest (~250 px/s).</span>
            </div>

            <label style={{ fontWeight: 600 }}>Scroll start delay:</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={settings.auto_scroll_start_delay ?? 3}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0));
                  patchSettings({ auto_scroll_start_delay: n });
                }}
                disabled={savingSettings || !settings.auto_scroll}
                style={{ width: 80, padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db' }}
              />
              <span style={styles.muted}>seconds to pause at the top before scrolling — applied on first show and after every category rotation, so viewers can read the race names before they slide away.</span>
            </div>
          </div>
          {savingSettings && <p style={{ ...styles.muted, fontSize: '0.78rem', margin: '0.4rem 0 0' }}>Saving…</p>}
          <p style={{ ...styles.muted, margin: '0.4rem 0 0', fontSize: '0.78rem' }}>
            Categories use the <strong>race group</strong> assigned to each race. Mobile mode is unaffected by these settings.
          </p>
        </div>
      )}

      {settings && (
        <DashboardBrandingPanel
          electionId={electionId}
          settings={settings}
          patchSettings={patchSettings}
          savingSettings={savingSettings}
          onUploadComplete={(logoPath) => setSettings(prev => ({ ...prev, logo_path: logoPath }))}
          onLogoRemoved={() => setSettings(prev => ({ ...prev, logo_path: '' }))}
        />
      )}

      {settings && (
        <DashboardColorsPanel
          settings={settings}
          patchSettings={patchSettings}
          savingSettings={savingSettings}
        />
      )}

      {settings && (
        <DashboardTemplatesPanel
          settings={settings}
          electionId={electionId}
          onApplyTemplate={(tplSettings) => {
            // Replace the settings entirely with the template (after merging defaults
            // for any slots the template doesn't carry).
            const next = { ...DEFAULT_DASHBOARD_SETTINGS, ...tplSettings, colors: { ...DEFAULT_COLORS, ...(tplSettings.colors || {}) } };
            setSettings(next);
            patchSettings(next);
          }}
        />
      )}

      <div style={{
        marginTop: '1rem',
        border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem',
        borderLeft: '4px solid #2563eb', background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <span style={{ fontSize: '2rem' }}>📱</span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Public Dashboard</h3>
            <p style={{ color: '#666', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>Auto-detects mobile vs. TV based on screen width. Shows race results, ballot SN search, and ballot image viewer.</p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{
                background: '#f3f4f6', padding: '0.3rem 0.5rem', borderRadius: 4,
                fontSize: '0.78rem', color: '#374151', wordBreak: 'break-all', flex: 1,
              }}>{publicUrl}</code>
              <button style={styles.btnSmall} onClick={() => copyToClipboard(publicUrl)}>Copy</button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...styles.btnPrimary, textDecoration: 'none', fontSize: '0.82rem', padding: '0.3rem 0.7rem' }}>
                Open
              </a>
            </div>
          </div>
        </div>

        <div style={{
          marginTop: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 6,
          overflow: 'hidden', height: 180, position: 'relative',
        }}>
          <iframe
            src={publicUrl}
            title="Public Dashboard"
            style={{
              width: '200%', height: '200%', border: 'none',
              transform: 'scale(0.5)', transformOrigin: 'top left',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Branding controls for the public dashboard. Logo file upload + position selector
// + custom header text override + vote-bar visibility toggle.
function DashboardBrandingPanel({ electionId, settings, patchSettings, savingSettings, onUploadComplete, onLogoRemoved }) {
  const [uploading, setUploading] = useState(false);
  const [headerDraft, setHeaderDraft] = useState(settings.custom_header || '');
  useEffect(() => { setHeaderDraft(settings.custom_header || ''); }, [settings.custom_header]);

  const handleLogoFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const { data } = await api.post(`/admin/elections/${electionId}/dashboard-logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploadComplete(data.logo_path);
    } catch (err) {
      alert('Logo upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm('Remove the dashboard logo?')) return;
    try {
      await api.delete(`/admin/elections/${electionId}/dashboard-logo`);
      onLogoRemoved();
    } catch (err) {
      alert('Failed to remove logo: ' + (err.response?.data?.error || err.message));
    }
  };

  // Cache-bust the preview when the logo changes since the URL is the same path.
  const logoPreview = settings.logo_path
    ? `${settings.logo_path}${settings.logo_path.includes('?') ? '&' : '?'}t=${Date.now()}`
    : null;

  return (
    <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Branding</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', alignItems: 'center', fontSize: '0.9rem' }}>
        <label style={{ fontWeight: 600 }}>Custom header:</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={headerDraft}
            onChange={(e) => setHeaderDraft(e.target.value)}
            onBlur={() => { if (headerDraft !== (settings.custom_header || '')) patchSettings({ custom_header: headerDraft }); }}
            placeholder="(blank = use Election Event Name)"
            disabled={savingSettings}
            style={{ flex: 1, maxWidth: 480, padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db' }}
          />
        </div>

        <label style={{ fontWeight: 600 }}>Logo:</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {logoPreview && (
            <img src={logoPreview} alt="Logo preview"
              style={{ height: 56, maxWidth: 180, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, padding: 4, objectFit: 'contain' }} />
          )}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
            onChange={(e) => handleLogoFile(e.target.files?.[0])}
            disabled={uploading} />
          {settings.logo_path && (
            <button onClick={handleRemoveLogo} disabled={uploading}
              style={{ padding: '0.3rem 0.6rem', background: '#fff', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
              Remove
            </button>
          )}
          {uploading && <span style={styles.muted}>Uploading…</span>}
        </div>

        <label style={{ fontWeight: 600 }}>Logo position:</label>
        <select
          value={settings.logo_position || 'top_center'}
          onChange={(e) => patchSettings({ logo_position: e.target.value })}
          disabled={savingSettings}
          style={{ padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db', maxWidth: 280 }}
        >
          <option value="top_center">Top center (above the header)</option>
          <option value="inline_left">Inline left of the header</option>
          <option value="inline_right">Inline right of the header</option>
          <option value="none">Hidden</option>
        </select>

        <label style={{ fontWeight: 600 }}>QR code position:</label>
        <select
          value={settings.qr_position || 'bottom_right'}
          onChange={(e) => patchSettings({ qr_position: e.target.value })}
          disabled={savingSettings}
          style={{ padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db', maxWidth: 280 }}
        >
          <option value="bottom_right">Bottom right</option>
          <option value="bottom_left">Bottom left</option>
          <option value="top_right">Top right</option>
          <option value="top_left">Top left</option>
          <option value="hidden">Hidden</option>
        </select>

        <label style={{ fontWeight: 600 }}>Vote bar:</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={settings.show_vote_bar !== false}
            onChange={(e) => patchSettings({ show_vote_bar: e.target.checked })}
            disabled={savingSettings}
          />
          <span style={styles.muted}>Show the visual percentage bar next to each candidate.</span>
        </label>
      </div>
    </div>
  );
}

// Color customization panel. Each slot has a native color picker plus a hex/rgb
// text input — both update the same setting so the operator can paste a brand hex
// or pick visually. Reset-to-default per slot and Reset-all keep escape hatches.
function DashboardColorsPanel({ settings, patchSettings, savingSettings }) {
  const colors = { ...DEFAULT_COLORS, ...(settings.colors || {}) };

  const setColor = (key, value) => {
    const next = { ...colors, [key]: value };
    patchSettings({ colors: next });
  };

  // Convert any CSS color string (rgb(), named) to a #RRGGBB the color picker
  // can preview. Falls back to the default for that slot if parsing fails.
  const toHex = (val, fallback) => {
    if (typeof val !== 'string') return fallback;
    const t = val.trim();
    if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(t)) {
      return '#' + t.slice(1).split('').map(c => c + c).join('').toLowerCase();
    }
    const m = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      const h = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
      return '#' + h(m[1]) + h(m[2]) + h(m[3]);
    }
    return fallback;
  };

  return (
    <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Colors</h3>
        <button onClick={() => patchSettings({ colors: { ...DEFAULT_COLORS } })} disabled={savingSettings}
          style={{ padding: '0.3rem 0.7rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' }}>
          Reset all to defaults
        </button>
      </div>
      {COLOR_GROUPS.map(group => (
        <div key={group.title} style={{ marginTop: '0.6rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{group.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.4rem 1rem' }}>
            {group.slots.map(([key, label]) => {
              const value = colors[key] ?? DEFAULT_COLORS[key];
              const hex = toHex(value, DEFAULT_COLORS[key]);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input type="color" value={hex} onChange={(e) => setColor(key, e.target.value)}
                    disabled={savingSettings}
                    style={{ width: 36, height: 28, padding: 0, border: '1px solid #d1d5db', borderRadius: 4, background: 'none', cursor: 'pointer' }} />
                  <input type="text" value={value} onChange={(e) => setColor(key, e.target.value)}
                    disabled={savingSettings} placeholder="#RRGGBB or rgb(r,g,b)"
                    style={{ width: 130, padding: '0.25rem 0.4rem', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.8rem' }} />
                  <span style={{ fontSize: '0.82rem', flex: 1 }}>{label}</span>
                  {value !== DEFAULT_COLORS[key] && (
                    <button onClick={() => setColor(key, DEFAULT_COLORS[key])} disabled={savingSettings}
                      title="Reset to default"
                      style={{ padding: '0.15rem 0.4rem', background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.72rem' }}>↺</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Template management: save current settings as a named template, load a saved
// template into this election, delete templates. Plus client-side download/import
// of settings as a JSON file so the operator can carry a brand kit between systems.
function DashboardTemplatesPanel({ settings, electionId, onApplyTemplate }) {
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get('/admin/dashboard-templates');
      setTemplates(data || []);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return alert('Enter a template name first.');
    setBusy(true);
    try {
      await api.post('/admin/dashboard-templates', { name: trimmed, settings });
      setName('');
      await load();
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const handleApply = async (tpl) => {
    if (!confirm(`Apply template "${tpl.name}" to this election? Current settings will be overwritten.`)) return;
    onApplyTemplate(tpl.settings);
  };

  const handleDelete = async (tpl) => {
    if (!confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      await api.delete(`/admin/dashboard-templates/${tpl.id}`);
      await load();
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-settings-${electionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON shape');
      if (!confirm('Apply imported settings to this election? Current settings will be overwritten.')) return;
      onApplyTemplate(parsed);
    } catch (err) {
      alert('Import failed: ' + (err.message || 'Could not parse JSON'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Templates</h3>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New template name"
          style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, minWidth: 220 }} />
        <button onClick={handleSave} disabled={busy || !name.trim()}
          style={{ padding: '0.35rem 0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Save current settings
        </button>
        <button onClick={handleDownload}
          style={{ padding: '0.35rem 0.8rem', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer' }}>
          Download as JSON
        </button>
        <input type="file" accept="application/json" ref={fileRef} style={{ display: 'none' }}
          onChange={(e) => handleImportFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}
          style={{ padding: '0.35rem 0.8rem', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer' }}>
          Import from JSON
        </button>
      </div>

      {templates.length === 0 ? (
        <p style={{ ...styles.muted, margin: 0, fontSize: '0.82rem' }}>No saved templates yet. Save the current settings as a template to reuse them across elections.</p>
      ) : (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.4rem' }}>
          {templates.map(tpl => (
            <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ flex: 1, fontSize: '0.9rem' }}>{tpl.name}</span>
              <button onClick={() => handleApply(tpl)}
                style={{ padding: '0.25rem 0.6rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' }}>
                Apply
              </button>
              <button onClick={() => {
                const blob = new Blob([JSON.stringify(tpl.settings, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `${tpl.name}.json`; a.click();
                URL.revokeObjectURL(url);
              }} style={{ padding: '0.25rem 0.6rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' }}>
                Download
              </button>
              <button onClick={() => handleDelete(tpl)}
                style={{ padding: '0.25rem 0.6rem', background: '#fff', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BALLOT_SIZES = [
  { value: 'quarter_letter', label: 'Quarter (4/page)' },
];

function GenerateAllBallots({ electionId }) {
  const [size, setSize] = useState('quarter_letter');
  const [generating, setGenerating] = useState(false);
  const [ballotList, setBallotList] = useState([]);
  const [error, setError] = useState(null);

  const fetchBallotList = async () => {
    try {
      const { data } = await api.get(`/admin/elections/${electionId}/ballot-list`);
      setBallotList(data);
    } catch {}
  };

  const fetchLastSize = async () => {
    try {
      const { data } = await api.get(`/admin/elections/${electionId}/ballot-design`);
      if (data.config?.lastBallotSize) setSize(data.config.lastBallotSize);
    } catch {}
  };

  useEffect(() => { fetchBallotList(); fetchLastSize(); }, [electionId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.post(`/admin/elections/${electionId}/generate-all-ballots`, { size });
      fetchBallotList();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const hasAnyPdf = ballotList.some(b => b.pdf_exists);
  const hasAnySerials = ballotList.some(b => b.serial_count > 0);
  const allHavePdf = ballotList.length > 0 && ballotList.every(b => !b.serial_count || b.pdf_exists);

  return (
    <div>
      <h2>Ballot Generation</h2>

      <Link to={`/admin/elections/${electionId}/ballot-design`} style={{ ...styles.btnPrimary, display: 'inline-block', textDecoration: 'none', marginBottom: '0.75rem' }}>
        Design Ballots
      </Link>

      {/* Generate controls */}
      <p style={styles.muted}>
        {hasAnySerials
          ? 'Generate or regenerate printable PDFs for all rounds. Serial numbers are preserved.'
          : 'Set ballot count when creating races to generate serial numbers first.'}
      </p>
      {hasAnySerials && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <select style={styles.input} value={size} onChange={e => setSize(e.target.value)}>
            {BALLOT_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            style={{ ...styles.btnPrimary, opacity: generating ? 0.6 : 1 }}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating...' : hasAnyPdf ? 'Regenerate All PDFs' : 'Generate All PDFs'}
          </button>
          {hasAnyPdf && (
            <a href={`/api/admin/elections/${electionId}/ballot-pdfs-zip`} style={styles.btnDownload} download>
              Download All PDFs (ZIP)
            </a>
          )}
        </div>
      )}

      {error && <p style={{ color: '#dc2626', marginTop: '0.5rem' }}>{error}</p>}

      {/* Ballot list — always shown when ballots exist */}
      {ballotList.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {ballotList.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
              <span style={{ flex: 1 }}>
                <strong>{b.race_name}</strong> — Round {b.round_number}
                <span style={styles.muted}> ({b.paper_color})</span>
                <span style={styles.muted}> — {b.serial_count} ballots</span>
              </span>
              {b.pdf_exists ? (
                <a href={b.pdf_url} style={styles.btnDownload} download>Download PDF</a>
              ) : (
                <span style={{ color: '#9ca3af', fontSize: '0.82rem' }}>No PDF yet</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportSection({ electionId }) {
  const [imageStatus, setImageStatus] = useState(null);
  const [fullStatus, setFullStatus] = useState(null);

  const startImageExport = async () => {
    setImageStatus('processing');
    await api.post(`/admin/elections/${electionId}/export-images`);
    pollStatus('images');
  };

  const startFullExport = async () => {
    setFullStatus('processing');
    await api.post(`/admin/elections/${electionId}/export-full`);
    pollStatus('full');
  };

  const pollStatus = (type) => {
    const setter = type === 'images' ? setImageStatus : setFullStatus;
    const url = `/admin/elections/${electionId}/export-${type}/status`;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(url);
        if (data.status === 'ready') {
          setter('ready');
          clearInterval(interval);
        } else if (data.status === 'error') {
          setter('error');
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
        setter('error');
      }
    }, 1000);
  };

  return (
    <div>
      <h2>Export</h2>

      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Results PDFs</h3>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <a href={`/api/admin/elections/${electionId}/results-summary-pdf`} style={styles.btnDownload} download>
          Event Summary PDF
        </a>
        <a href={`/api/admin/elections/${electionId}/results-detail-pdf`} style={styles.btnDownload} download>
          Event Detail PDF
        </a>
        <a href={`/api/admin/elections/${electionId}/results-zip`} style={styles.btnDownload} download>
          All Results PDFs (ZIP)
        </a>
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Data Export</h3>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {imageStatus === 'ready' ? (
          <a href={`/api/admin/elections/${electionId}/export-images/download`} style={styles.btnDownload} download>
            Download Ballot Images ZIP
          </a>
        ) : (
          <button
            style={{ ...styles.btnPrimary, opacity: imageStatus === 'processing' ? 0.6 : 1 }}
            onClick={startImageExport}
            disabled={imageStatus === 'processing'}
          >
            {imageStatus === 'processing' ? 'Exporting Images...' : 'Export All Ballot Images'}
          </button>
        )}

        {fullStatus === 'ready' ? (
          <a href={`/api/admin/elections/${electionId}/export-full/download`} style={styles.btnDownload} download>
            Download Full Export ZIP
          </a>
        ) : (
          <button
            style={{ ...styles.btnPrimary, opacity: fullStatus === 'processing' ? 0.6 : 1 }}
            onClick={startFullExport}
            disabled={fullStatus === 'processing'}
          >
            {fullStatus === 'processing' ? 'Exporting...' : 'Export Full Election Event Data'}
          </button>
        )}

        <a href={`/api/admin/elections/${electionId}/export-excel`} style={styles.btnDownload} download>
          Export Results Workbook (Excel)
        </a>

        <a href={`/api/admin/elections/${electionId}/export-json`} style={styles.btnDownload} download>
          Export as JSON (reimportable)
        </a>

        <a
          href={`/api/admin/elections/${electionId}/export-json?include_ballots=1`}
          style={styles.btnDownload}
          download
          title="Bundles election structure + ballot files (PDFs, ballot-spec.json) so the duplicate keeps the same scan zones without regenerating"
        >
          Export Clone (with ballot files)
        </a>
      </div>
      {(imageStatus === 'error' || fullStatus === 'error') && (
        <p style={{ color: '#dc2626', marginTop: '0.5rem' }}>Export failed. Please try again.</p>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },

  // Sidebar layout
  layout: { display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1.5rem' },
  sidebar: {
    width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px',
    borderRight: '1px solid #e5e7eb', paddingRight: '1rem',
  },
  navItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.6rem 0.75rem', background: 'none', border: 'none', borderLeft: '3px solid transparent',
    cursor: 'pointer', fontSize: '0.9rem', color: '#4b5563', borderRadius: '0 4px 4px 0',
  },
  navItemActive: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.6rem 0.75rem', background: '#eff6ff', border: 'none', borderLeft: '3px solid #2563eb',
    cursor: 'pointer', fontSize: '0.9rem', color: '#1d4ed8', fontWeight: 600, borderRadius: '0 4px 4px 0',
  },
  content: { flex: 1, minWidth: 0 },

  // Mobile nav — hidden on desktop via media query workaround
  mobileNav: {
    display: 'none', overflowX: 'auto', gap: '0.25rem', padding: '0.25rem 0',
    borderBottom: '1px solid #e5e7eb', marginBottom: '1rem',
  },
  mobileTab: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid transparent',
    cursor: 'pointer', fontSize: '0.82rem', color: '#6b7280', whiteSpace: 'nowrap',
  },
  mobileTabActive: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid #2563eb',
    cursor: 'pointer', fontSize: '0.82rem', color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap',
  },

  raceCardRow: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem',
  },
  dragHandle: {
    color: '#9ca3af', fontSize: '1.3rem', cursor: 'grab', padding: '0 0.25rem',
    userSelect: 'none',
  },
  visibilityBtn: {
    padding: '0.4rem 0.75rem', border: '1px solid', borderRadius: 6,
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap',
  },
  raceCard: {
    display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem',
    border: '1px solid #ddd', borderRadius: 6,
    textDecoration: 'none', color: 'inherit', background: '#fafafa',
  },
  raceName: { fontWeight: 600, flex: 1 },
  statusBadge: { color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  roundsList: {
    marginLeft: '1.25rem', borderLeft: '2px solid #e5e7eb', paddingLeft: '0.75rem', marginTop: '0.25rem',
  },
  roundRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem',
    textDecoration: 'none', color: 'inherit', borderRadius: 4,
    transition: 'background 0.1s',
  },
  roundStatusBadge: { color: '#fff', padding: '1px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 },
  boxRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDownload: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-block' },
  muted: { color: '#666', fontSize: '0.9rem' },
  ballotVisibilitySection: {
    display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap',
    padding: '0.5rem 0.75rem', background: '#f9fafb', border: '1px solid #e5e7eb',
    borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem',
  },
  toggleLabel: {
    display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
    fontSize: '0.85rem', color: '#4b5563',
  },
};

// Inject a <style> tag for responsive sidebar/mobile nav toggle
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @media (max-width: 768px) {
      [data-sidebar] { display: none !important; }
      [data-mobilenav] { display: flex !important; }
      [data-layout] { flex-direction: column !important; }
    }
    @media (min-width: 769px) {
      [data-mobilenav] { display: none !important; }
    }
  `;
  document.head.appendChild(styleEl);
}
