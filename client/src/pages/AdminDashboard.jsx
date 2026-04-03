import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function AdminDashboard({ onLogout, auth }) {
  const [elections, setElections] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', description: '' });
  const [loading, setLoading] = useState(true);

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

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this election?')) return;
    await api.delete(`/admin/elections/${id}`);
    fetchElections();
  };

  const active = elections.filter(e => e.status === 'active');
  const archived = elections.filter(e => e.status === 'archived');

  if (loading) return <div style={styles.container}><p>Loading...</p></div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>BallotTrack Admin</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {auth?.role && <span style={styles.badge}>{auth.role}</span>}
          <button style={styles.btnPrimary} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Create Election'}
          </button>
          {onLogout && <button style={styles.btnSmall} onClick={onLogout}>Logout</button>}
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={styles.form}>
          <input
            style={styles.input}
            placeholder="Election Name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            style={styles.input}
            type="date"
            value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            required
          />
          <input
            style={styles.input}
            placeholder="Description (optional)"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
          <button style={styles.btnPrimary} type="submit">Create</button>
        </form>
      )}

      <h2>Active Elections</h2>
      {active.length === 0 && <p style={styles.muted}>No active elections.</p>}
      <div style={styles.grid}>
        {active.map(el => (
          <div key={el.id} style={styles.card}>
            <Link to={`/admin/elections/${el.id}`} style={styles.cardLink}>
              <h3>{el.name}</h3>
              <p style={styles.muted}>{new Date(el.date).toLocaleDateString()}</p>
              {el.description && <p>{el.description}</p>}
            </Link>
            <div style={styles.cardActions}>
              {el.is_sample && <span style={styles.badge}>Sample</span>}
              <button style={styles.btnSmall} onClick={() => handleArchive(el.id)}>Archive</button>
              <button style={styles.btnDanger} onClick={() => handleDelete(el.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <h2
            style={{ cursor: 'pointer' }}
            onClick={() => setShowArchived(!showArchived)}
          >
            Archived ({archived.length}) {showArchived ? '▼' : '▶'}
          </h2>
          {showArchived && (
            <div style={styles.grid}>
              {archived.map(el => (
                <div key={el.id} style={{ ...styles.card, opacity: 0.7 }}>
                  <Link to={`/admin/elections/${el.id}`} style={styles.cardLink}>
                    <h3>{el.name}</h3>
                    <p style={styles.muted}>{new Date(el.date).toLocaleDateString()}</p>
                  </Link>
                  <div style={styles.cardActions}>
                    <button style={styles.btnDanger} onClick={() => handleDelete(el.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
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
  muted: { color: '#666', fontSize: '0.9rem' },
};
