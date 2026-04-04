import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Login({ onLogin }) {
  const [role, setRole] = useState('admin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/login', { role, pin });
      onLogin(data.role, data.token);
      // Judge doesn't have admin access — send to role-appropriate page
      if (data.role === 'judge') {
        navigate('/judge');
      } else {
        navigate('/admin');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>BallotTrack</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Role</label>
            <select style={styles.input} value={role} onChange={e => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="judge">Election Event Judge</option>
              <option value="chair">Chair</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>PIN</label>
            <input
              style={styles.input}
              type="password"
              placeholder="Enter PIN"
              value={pin}
              onChange={e => setPin(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={styles.hint}>
          Tally operators and public viewers do not need to sign in.
        </p>
      </div>
    </div>
  );
}

const styles = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', borderRadius: 12, padding: '2.5rem', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { margin: '0 0 0.25rem', textAlign: 'center', fontSize: '1.75rem' },
  subtitle: { color: '#666', textAlign: 'center', margin: '0 0 1.5rem', fontSize: '0.9rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontWeight: 600, fontSize: '0.85rem' },
  input: { padding: '0.6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '1rem' },
  btn: { padding: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600, marginTop: '0.5rem' },
  error: { color: '#dc2626', fontSize: '0.9rem', margin: 0 },
  hint: { color: '#9ca3af', fontSize: '0.8rem', textAlign: 'center', marginTop: '1.5rem' },
};
