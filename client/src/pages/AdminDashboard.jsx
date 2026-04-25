import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { formatDate } from '../utils/dateFormat';
import AppHeader from '../components/AppHeader';

export default function AdminDashboard({ auth }) {
  const [elections, setElections] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchParams] = useSearchParams();
  const activeSection = searchParams.get('section') || 'events';

  const fetchElections = async () => {
    const { data } = await api.get('/admin/elections');
    setElections(data);
    setLoading(false);
  };

  useEffect(() => { fetchElections(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.post('/admin/elections', form);
    setForm({ name: '', date: '', description: '' });
    setShowForm(false);
    fetchElections();
  };

  const handleArchive = async (id) => {
    await api.put(`/admin/elections/${id}/archive`);
    fetchElections();
  };

  const handleDelete = async (id, hard = false) => {
    const msg = hard
      ? 'PERMANENTLY delete this election event and ALL its data (races, rounds, ballots, scans)? This cannot be undone.'
      : 'Are you sure you want to delete this election event?';
    if (!confirm(msg)) return;
    try {
      await api.delete(`/admin/elections/${id}${hard ? '?hard=true' : ''}`);
      fetchElections();
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
      let result;
      if (isZip) {
        const fd = new FormData();
        fd.append('file', file);
        result = await api.post('/admin/import-election', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        const text = await file.text();
        const data = JSON.parse(text);
        result = await api.post('/admin/import-election', data);
      }
      fetchElections();
      const filesNote = result?.data?.files_copied_total
        ? ` (${result.data.files_copied_total} ballot file${result.data.files_copied_total === 1 ? '' : 's'} restored)`
        : '';
      alert('Election event imported successfully!' + filesNote);
    } catch (err) {
      alert('Import failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const active = elections.filter(e => e.status === 'active');
  const archived = elections.filter(e => e.status === 'archived');

  if (loading) return <div style={s.container}><p>Loading...</p></div>;

  return (
    <div style={s.container}>
      <AppHeader title="BallotTrack" />

      <div style={s.layout} data-admin-layout>
        {/* Sidebar */}
        <nav style={s.sidebar} data-admin-sidebar>
          {auth?.role === 'super_admin' && (
            <>
              <Link to="/admin/users" style={{ ...s.navItem, textDecoration: 'none', color: 'inherit' }}>
                Manage Users
              </Link>
              <div style={s.divider} />
            </>
          )}

          <Link to="/admin" style={{ ...s.navItem, ...(activeSection === 'events' ? s.navItemActive : {}), textDecoration: 'none', color: 'inherit' }}>
            Election Events
          </Link>
          <Link to="/admin?section=scanners" style={{ ...s.navItem, ...(activeSection === 'scanners' ? s.navItemActive : {}), textDecoration: 'none', color: 'inherit' }}>
            Scanners
          </Link>

          <div style={s.divider} />

          <label style={{ ...s.navItem, cursor: 'pointer', display: 'block' }}>
            {importing ? 'Importing...' : 'Import JSON or ZIP'}
            <input type="file" accept=".json,.zip" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </nav>

        {/* Mobile nav — visible only on small screens */}
        <nav style={s.mobileNav} data-admin-mobilenav>
          {auth?.role === 'super_admin' && (
            <Link to="/admin/users" style={{ ...s.mobileTab, textDecoration: 'none' }}>Users</Link>
          )}
          <Link to="/admin" style={{ ...s.mobileTab, ...(activeSection === 'events' ? s.mobileTabActive : {}), textDecoration: 'none' }}>Events</Link>
          <Link to="/admin?section=scanners" style={{ ...s.mobileTab, ...(activeSection === 'scanners' ? s.mobileTabActive : {}), textDecoration: 'none' }}>Scanners</Link>
          <label style={{ ...s.mobileTab, cursor: 'pointer' }}>
            {importing ? 'Importing...' : 'Import'}
            <input type="file" accept=".json,.zip" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </nav>

        {/* Content */}
        <div style={s.content}>
          {activeSection === 'scanners' && <ScannersPanel />}

          {activeSection === 'events' && (<>
          <div style={s.sectionHeader}>
            <h2 style={{ margin: 0 }}>Active Election Events</h2>
            <button style={s.btnPrimary} onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancel' : '+ Create'}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} style={s.form}>
              <input style={s.input} placeholder="Election Event Name" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} required />
              <input style={s.input} type="date" value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })} required />
              <input style={s.input} placeholder="Description (optional)" value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
              <button style={s.btnPrimary} type="submit">Create</button>
            </form>
          )}

          {active.length === 0 && <p style={s.muted}>No active election events.</p>}
          <div style={s.grid}>
            {active.map(el => (
              <div key={el.id} style={s.card}>
                <Link to={`/admin/elections/${el.id}`} style={s.cardLink}>
                  <h3 style={{ margin: '0 0 0.25rem' }}>{el.name}</h3>
                  <p style={s.muted}>{formatDate(el.date)}</p>
                  {el.description && <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>{el.description}</p>}
                </Link>
                <div style={s.cardActions}>
                  {el.is_sample && <span style={s.badge}>Sample</span>}
                  <button style={s.btnSmall} onClick={() => handleArchive(el.id)}>Archive</button>
                  <button style={s.btnDanger} onClick={() => handleDelete(el.id)}>Delete</button>
                  <button style={s.btnDanger} onClick={() => handleDelete(el.id, true)}>Permanently Delete</button>
                </div>
              </div>
            ))}
          </div>

          {archived.length > 0 && (
            <>
              <h3 style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowArchived(!showArchived)}>
                Archived ({archived.length}) {showArchived ? '▼' : '▶'}
              </h3>
              {showArchived && (
                <div style={s.grid}>
                  {archived.map(el => (
                    <div key={el.id} style={{ ...s.card, opacity: 0.7 }}>
                      <Link to={`/admin/elections/${el.id}`} style={s.cardLink}>
                        <h3 style={{ margin: '0 0 0.25rem' }}>{el.name}</h3>
                        <p style={s.muted}>{formatDate(el.date)}</p>
                      </Link>
                      <div style={s.cardActions}>
                        <button style={s.btnDanger} onClick={() => handleDelete(el.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}

function ScannersPanel() {
  const [scanners, setScanners] = useState([]);

  useEffect(() => {
    api.get('/admin/scanners-global').then(({ data }) => setScanners(data)).catch(() => {});
  }, []);

  return (
    <div>
      <h2 style={{ margin: '0 0 1rem' }}>Scanners</h2>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
        10 scanners are pre-configured and always active. Each scanner watches its own folder for incoming ballot images.
      </p>
      {scanners.length === 0 && <p style={{ color: '#666' }}>Loading scanners...</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {scanners.map(sc => (
          <div key={sc.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', background: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{sc.name}</strong>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: sc.status === 'active' ? '#16a34a' : '#dc2626',
              }} />
            </div>
            <p style={{ color: '#666', fontSize: '0.8rem', margin: '0.25rem 0 0', fontFamily: 'monospace' }}>
              {sc.watch_folder_path}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  container: { maxWidth: 1200, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e5e7eb' },
  userInfo: { fontSize: '0.85rem', fontWeight: 600, color: '#374151' },
  roleBadge: { background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600 },
  layout: { display: 'flex', gap: '1.5rem', alignItems: 'flex-start' },
  sidebar: {
    width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1px',
    borderRight: '1px solid #e5e7eb', paddingRight: '0.75rem',
  },
  navItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderLeft: '3px solid transparent',
    fontSize: '0.85rem', color: '#4b5563', borderRadius: '0 4px 4px 0', cursor: 'pointer',
  },
  navItemActive: {
    background: '#eff6ff', borderLeft: '3px solid #2563eb',
    color: '#1d4ed8', fontWeight: 600,
  },
  divider: { height: 1, background: '#e5e7eb', margin: '0.5rem 0.75rem' },
  mobileNav: {
    display: 'none', overflowX: 'auto', gap: '0.25rem', padding: '0.25rem 0',
    borderBottom: '1px solid #e5e7eb', marginBottom: '1rem',
  },
  mobileTab: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid transparent',
    fontSize: '0.82rem', color: '#6b7280', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  mobileTabActive: {
    borderBottom: '2px solid #2563eb', color: '#2563eb', fontWeight: 600,
  },
  content: { flex: 1, minWidth: 0 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  card: { border: '1px solid #ddd', borderRadius: 8, padding: '1rem', background: '#fafafa' },
  cardLink: { textDecoration: 'none', color: 'inherit' },
  cardActions: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' },
  badge: { background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  muted: { color: '#666', fontSize: '0.85rem', margin: 0 },
};

// Responsive CSS
if (typeof document !== 'undefined') {
  const id = 'admin-dashboard-responsive';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = `
      @media (max-width: 768px) {
        [data-admin-sidebar] { display: none !important; }
        [data-admin-mobilenav] { display: flex !important; }
        [data-admin-layout] { flex-direction: column !important; }
      }
      @media (min-width: 769px) {
        [data-admin-mobilenav] { display: none !important; }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
