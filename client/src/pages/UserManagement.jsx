import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [races, setRaces] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'race_admin', pin: '' });
  const [error, setError] = useState(null);

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(data);
    } catch {}
  };

  const fetchRaces = async () => {
    try {
      const { data } = await api.get('/admin/elections');
      const allRaces = [];
      for (const el of data) {
        const { data: election } = await api.get(`/admin/elections/${el.id}`);
        if (election.races) {
          for (const r of election.races) {
            allRaces.push({ ...r, election_name: el.name });
          }
        }
      }
      setRaces(allRaces);
    } catch {}
  };

  useEffect(() => { fetchUsers(); fetchRaces(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/admin/users', form);
      setForm({ name: '', role: 'race_admin', pin: '' });
      setShowForm(false);
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleResetPin = async (userId, userName) => {
    if (!confirm(`Reset PIN for ${userName} to 0000?`)) return;
    try {
      await api.post(`/admin/users/${userId}/reset-pin`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset PIN');
    }
  };

  const handleDelete = async (userId, userName) => {
    if (!confirm(`Delete user ${userName}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/users/${userId}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleAssignRace = async (userId, raceId) => {
    try {
      await api.post(`/admin/users/${userId}/assign-race`, { race_id: parseInt(raceId) });
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to assign race');
    }
  };

  const handleUnassignRace = async (userId, raceId) => {
    try {
      await api.delete(`/admin/users/${userId}/unassign-race/${raceId}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unassign race');
    }
  };

  return (
    <div style={s.container}>
      <Link to="/admin" style={s.backLink}>&larr; Back to Dashboard</Link>

      <div style={s.header}>
        <h1>User Management</h1>
        <button style={s.btnPrimary} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={s.form}>
          <input style={s.input} placeholder="Name" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} required />
          <select style={s.input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="race_admin">Race Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <input style={s.input} type="password" placeholder="PIN (default: 0000)" value={form.pin}
            onChange={e => setForm({ ...form, pin: e.target.value })} />
          <button style={s.btnPrimary} type="submit">Create User</button>
          {error && <p style={s.error}>{error}</p>}
        </form>
      )}

      {users.length === 0 && <p style={s.muted}>No users yet.</p>}

      {users.map(user => (
        <div key={user.id} style={s.card}>
          <div style={s.cardHeader}>
            <div>
              <strong style={{ fontSize: '1.05rem' }}>{user.name}</strong>
              <span style={{ ...s.roleBadge, background: user.role === 'super_admin' ? '#dbeafe' : '#dcfce7', color: user.role === 'super_admin' ? '#1e40af' : '#166534' }}>
                {user.role === 'super_admin' ? 'Super Admin' : 'Race Admin'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {user.must_change_pin && <span style={s.pinWarning}>Must change PIN</span>}
              <button style={s.btnSmall} onClick={() => handleResetPin(user.id, user.name)}>Reset PIN</button>
              <button style={s.btnDanger} onClick={() => handleDelete(user.id, user.name)}>Delete</button>
            </div>
          </div>

          {/* Race assignments for race_admins */}
          {user.role === 'race_admin' && (
            <div style={s.assignments}>
              <p style={{ ...s.muted, margin: '0 0 0.5rem', fontWeight: 600 }}>Assigned Races:</p>
              {user.assigned_races?.length === 0 && (
                <p style={s.muted}>No races assigned yet.</p>
              )}
              {user.assigned_races?.map(a => (
                <div key={a.race_id} style={s.assignmentRow}>
                  <span>{a.race_name}</span>
                  <button style={s.btnDangerSmall} onClick={() => handleUnassignRace(user.id, a.race_id)}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <select style={s.input} id={`assign-${user.id}`} defaultValue="">
                  <option value="" disabled>Assign a race...</option>
                  {races.filter(r => !user.assigned_races?.some(a => a.race_id === r.id)).map(r => (
                    <option key={r.id} value={r.id}>{r.election_name} — {r.name}</option>
                  ))}
                </select>
                <button style={s.btnSmall} onClick={() => {
                  const sel = document.getElementById(`assign-${user.id}`);
                  if (sel.value) handleAssignRace(user.id, sel.value);
                }}>Assign</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const s = {
  container: { maxWidth: 800, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  form: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#fff' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' },
  roleBadge: { marginLeft: '0.5rem', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  pinWarning: { background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  assignments: { marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb' },
  assignmentRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', fontSize: '0.9rem' },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDangerSmall: { padding: '2px 6px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' },
  error: { color: '#dc2626', fontSize: '0.9rem' },
  muted: { color: '#666', fontSize: '0.85rem' },
};
