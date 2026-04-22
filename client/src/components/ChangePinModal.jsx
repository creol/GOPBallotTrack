import { useState, useEffect } from 'react';
import api from '../api/client';

/**
 * Self-serve "Change my PIN" modal. Wired to POST /api/auth/change-pin which
 * validates the current PIN server-side. Session stays valid after a successful change.
 *
 * Props:
 *   open     — boolean
 *   onClose  — called when dismissed or after a successful change
 */
export default function ChangePinModal({ open, onClose }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrentPin(''); setNewPin(''); setConfirmPin('');
      setError(null); setBusy(false); setSuccess(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (!currentPin) { setError('Current PIN is required'); return; }
    if (!newPin || newPin.length < 4) { setError('New PIN must be at least 4 characters'); return; }
    if (newPin !== confirmPin) { setError('New PIN and confirmation do not match'); return; }
    if (newPin === currentPin) { setError('New PIN must differ from current PIN'); return; }

    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-pin', { current_pin: currentPin, new_pin: newPin });
      setSuccess(true);
      setTimeout(() => onClose(), 900);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change PIN');
      setBusy(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.5rem', color: '#1e3a5f' }}>Change Your PIN</h3>
        <p style={s.description}>Pick something you can remember. Minimum 4 characters. Your session stays signed in.</p>

        <label style={s.label}>Current PIN</label>
        <input
          style={s.input}
          type="password"
          value={currentPin}
          onChange={e => { setCurrentPin(e.target.value); setError(null); }}
          onKeyDown={handleKey}
          autoFocus
          disabled={busy || success}
        />

        <label style={s.label}>New PIN</label>
        <input
          style={s.input}
          type="password"
          value={newPin}
          onChange={e => { setNewPin(e.target.value); setError(null); }}
          onKeyDown={handleKey}
          minLength={4}
          disabled={busy || success}
        />

        <label style={s.label}>Confirm New PIN</label>
        <input
          style={s.input}
          type="password"
          value={confirmPin}
          onChange={e => { setConfirmPin(e.target.value); setError(null); }}
          onKeyDown={handleKey}
          minLength={4}
          disabled={busy || success}
        />

        {error && <p style={s.errorText}>{error}</p>}
        {success && <p style={s.successText}>PIN updated.</p>}

        <div style={s.buttons}>
          <button
            style={{ ...s.btnConfirm, opacity: (busy || success) ? 0.6 : 1 }}
            onClick={submit}
            disabled={busy || success}
          >
            {busy ? 'Saving…' : success ? 'Saved' : 'Change PIN'}
          </button>
          <button style={s.btnCancel} onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '1rem',
  },
  card: {
    background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 420,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  description: { margin: '0 0 1rem', color: '#374151', lineHeight: 1.5, fontSize: '0.92rem' },
  label: { fontWeight: 600, fontSize: '0.82rem', display: 'block', margin: '0.5rem 0 0.25rem', color: '#374151' },
  input: { width: '100%', padding: '0.6rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.95rem', boxSizing: 'border-box' },
  errorText: { color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  successText: { color: '#16a34a', fontSize: '0.9rem', margin: '0.5rem 0 0', fontWeight: 600 },
  buttons: { display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' },
  btnConfirm: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, flex: 1, minWidth: 120 },
  btnCancel: { padding: '0.6rem 1.2rem', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem' },
};
