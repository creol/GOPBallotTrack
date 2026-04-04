import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

const NAV_ITEMS = [
  { key: 'races', label: 'Races' },
  { key: 'ballots', label: 'Ballot Generation' },
  { key: 'boxes', label: 'Ballot Boxes' },
  { key: 'scanners', label: 'Scanners' },
  { key: 'export', label: 'Export' },
  { key: 'dashboards', label: 'Dashboards' },
];

export default function ElectionDetail() {
  const { id } = useParams();
  const [election, setElection] = useState(null);
  const [ballotBoxes, setBallotBoxes] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', description: '' });
  const [raceForm, setRaceForm] = useState({ name: '', ballot_count: '', max_rounds: '' });
  const [showRaceForm, setShowRaceForm] = useState(false);
  const [boxCount, setBoxCount] = useState('');
  const [activeSection, setActiveSection] = useState('races');
  const [raceRounds, setRaceRounds] = useState({});
  const navigate = useNavigate();

  const fetchElection = async () => {
    const { data } = await api.get(`/admin/elections/${id}`);
    setElection(data);
    setForm({ name: data.name, date: data.date?.split('T')[0], description: data.description || '' });

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
    });
    setRaceForm({ name: '', ballot_count: '', max_rounds: '' });
    setShowRaceForm(false);
    navigate(`/admin/elections/${id}/races/${newRace.id}`);
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

  if (!election) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending: '#f59e0b', active: '#10b981', complete: '#6366f1' };
  const roundStatusColor = { pending: '#f59e0b', scanning: '#3b82f6', confirmed: '#10b981', pending_release: '#8b5cf6', released: '#6366f1' };

  return (
    <div style={styles.container}>
      <Link to="/admin" style={styles.backLink}>&larr; All Election Events</Link>

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
            <p style={styles.muted}>{new Date(election.date).toLocaleDateString()}</p>
            {election.description && <p>{election.description}</p>}
          </div>
          <button style={styles.btnSmall} onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}

      {/* Sidebar + Content Layout */}
      <div style={styles.layout} data-layout>
        {/* Sidebar — desktop */}
        <nav style={styles.sidebar} data-sidebar>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              style={activeSection === item.key ? styles.navItemActive : styles.navItem}
              onClick={() => setActiveSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Mobile tab bar */}
        <nav style={styles.mobileNav} data-mobilenav>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              style={activeSection === item.key ? styles.mobileTabActive : styles.mobileTab}
              onClick={() => setActiveSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div style={styles.content}>
          {activeSection === 'races' && (
            <div>
              <div style={styles.sectionHeader}>
                <h2>Races</h2>
                <button style={styles.btnPrimary} onClick={() => setShowRaceForm(!showRaceForm)}>
                  {showRaceForm ? 'Cancel' : 'Add Race'}
                </button>
              </div>

              {showRaceForm && (
                <form onSubmit={handleAddRace} style={styles.form}>
                  <input style={styles.input} placeholder="Race Name" value={raceForm.name}
                    onChange={e => setRaceForm({ ...raceForm, name: e.target.value })} required />
                  <input style={{ ...styles.input, width: 130 }} type="number" min="1" placeholder="# of Ballots"
                    value={raceForm.ballot_count} onChange={e => setRaceForm({ ...raceForm, ballot_count: e.target.value })} required />
                  <input style={{ ...styles.input, width: 130 }} type="number" min="1" placeholder="Max Rounds"
                    value={raceForm.max_rounds} onChange={e => setRaceForm({ ...raceForm, max_rounds: e.target.value })} required />
                  <button style={styles.btnPrimary} type="submit">Add Candidates →</button>
                </form>
              )}

              {(!election.races || election.races.length === 0) && <p style={styles.muted}>No races yet.</p>}
              {election.races?.map(race => (
                <div key={race.id} style={{ marginBottom: '1rem' }}>
                  <Link to={`/admin/elections/${id}/races/${race.id}`} style={styles.raceCard}>
                    <span style={styles.raceName}>{race.name}</span>
                    <span style={{ ...styles.statusBadge, background: statusColor[race.status] || '#999' }}>{race.status}</span>
                  </Link>
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
              ))}
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
        </div>
      </div>
    </div>
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

function DashboardsSection({ electionId }) {
  const publicUrl = `${window.location.origin}/public/${electionId}`;
  const tvUrl = `${publicUrl}?mode=tv`;
  const adminUrl = `${window.location.origin}/admin/elections/${electionId}`;

  const dashboards = [
    {
      title: 'Public Dashboard (Mobile)',
      description: 'Touch-friendly view for attendees on phones. Shows race results, ballot SN search, and ballot image viewer.',
      url: publicUrl,
      icon: '📱',
      color: '#2563eb',
    },
    {
      title: 'Public Dashboard (TV)',
      description: 'Full-screen results display for large screens. Dark theme, auto-updates via WebSocket when results are released.',
      url: tvUrl,
      icon: '📺',
      color: '#7c3aed',
    },
    {
      title: 'Admin Dashboard',
      description: 'Election event management — races, ballots, scanning, confirmation, and exports.',
      url: adminUrl,
      icon: '⚙️',
      color: '#16a34a',
    },
  ];

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => alert('URL copied!')).catch(() => {});
  };

  return (
    <div>
      <h2>Dashboards</h2>
      <p style={styles.muted}>Share these links with attendees and operators. All links work on the local network.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        {dashboards.map(d => (
          <div key={d.title} style={{
            border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem',
            borderLeft: `4px solid ${d.color}`, background: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <span style={{ fontSize: '2rem' }}>{d.icon}</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{d.title}</h3>
                <p style={{ color: '#666', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>{d.description}</p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{
                    background: '#f3f4f6', padding: '0.3rem 0.5rem', borderRadius: 4,
                    fontSize: '0.78rem', color: '#374151', wordBreak: 'break-all', flex: 1,
                  }}>{d.url}</code>
                  <button style={styles.btnSmall} onClick={() => copyToClipboard(d.url)}>Copy</button>
                  <a href={d.url} target="_blank" rel="noopener noreferrer"
                    style={{ ...styles.btnPrimary, textDecoration: 'none', fontSize: '0.82rem', padding: '0.3rem 0.7rem' }}>
                    Open
                  </a>
                </div>
              </div>
            </div>

            {/* Thumbnail preview */}
            <div style={{
              marginTop: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 6,
              overflow: 'hidden', height: 180, position: 'relative',
            }}>
              <iframe
                src={d.url}
                title={d.title}
                style={{
                  width: '200%', height: '200%', border: 'none',
                  transform: 'scale(0.5)', transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const BALLOT_SIZES = [
  { value: 'letter', label: 'Letter (1/page)' },
  { value: 'half_letter', label: 'Half Letter (2/page)' },
  { value: 'quarter_letter', label: 'Quarter (4/page)' },
  { value: 'eighth_letter', label: '1/8 Letter (8/page)' },
];

function GenerateAllBallots({ electionId }) {
  const [size, setSize] = useState('letter');
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

  raceCard: {
    display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem',
    border: '1px solid #ddd', borderRadius: 6, marginBottom: '0.5rem',
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
