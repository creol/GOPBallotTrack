import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [changePinMode, setChangePinMode] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/login', { name, pin });
      if (data.must_change_pin) {
        // Force PIN change before proceeding
        onLogin(data.role, data.token, data.user_id, data.name);
        setChangePinMode(true);
        setLoading(false);
        return;
      }
      onLogin(data.role, data.token, data.user_id, data.name);
      if (data.name && data.name.match(/^scan\d/i)) {
        navigate('/station-setup');
      } else {
        navigate('/admin');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePin = async (e) => {
    e.preventDefault();
    if (newPin.length < 4) { setError('PIN must be at least 4 characters'); return; }
    if (newPin !== confirmPin) { setError('PINs do not match'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/change-pin', { new_pin: newPin });
      navigate('/admin');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change PIN');
    } finally {
      setLoading(false);
    }
  };

  if (changePinMode) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <h1 style={styles.title}>Change PIN</h1>
          <p style={styles.subtitle}>You must set a new PIN before continuing.</p>

          <form onSubmit={handleChangePin} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>New PIN</label>
              <input style={styles.input} type="password" placeholder="New PIN (min 4 characters)"
                value={newPin} onChange={e => setNewPin(e.target.value)} required autoFocus minLength={4} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Confirm PIN</label>
              <input style={styles.input} type="password" placeholder="Confirm PIN"
                value={confirmPin} onChange={e => setConfirmPin(e.target.value)} required minLength={4} />
            </div>

            {error && <p style={styles.error}>{error}</p>}

            <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Set PIN & Continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>BallotTrack</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name</label>
            <input
              style={styles.input}
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
            />
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
          Public viewers do not need to sign in.
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
