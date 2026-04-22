import { useState, useEffect } from 'react';
import api from '../api/client';

/**
 * Confirmation modal for destructive admin actions. Accepts any super admin's PIN.
 *
 * Props:
 *   open             — boolean
 *   title            — headline
 *   description      — explanation body
 *   confirmLabel     — primary button label (default: "Confirm")
 *   confirmStyle     — 'danger' | 'normal' (default: 'danger')
 *   requireNotes     — if true, prompts for a notes/reason field
 *   notesLabel       — label for notes input
 *   notesPlaceholder — placeholder for notes input
 *   onCancel         — called when user closes
 *   onConfirm        — called with { pin, adminName, adminId, notes } after successful PIN verify
 */
export default function SuperAdminPinModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmStyle = 'danger',
  requireNotes = false,
  notesLabel = 'Reason (required)',
  notesPlaceholder = '',
  onCancel,
  onConfirm,
}) {
  const [pin, setPin] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setNotes('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (!pin) { setError('Super Admin PIN is required'); return; }
    if (requireNotes && !notes.trim()) { setError('Reason is required'); return; }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/verify-super-admin-pin', { pin });
      await onConfirm({ pin, adminName: data.admin_name, adminId: data.admin_id, notes: notes.trim() });
    } catch (err) {
      setError(err.response?.data?.error || 'PIN verification failed');
      setBusy(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') onCancel();
  };

  const confirmBg = confirmStyle === 'danger' ? '#dc2626' : '#2563eb';

  return (
    <div style={s.overlay} onClick={onCancel}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.5rem', color: confirmBg }}>{title}</h3>
        {description && <p style={s.description}>{description}</p>}

        {requireNotes && (
          <>
            <label style={s.label}>{notesLabel}</label>
            <textarea
              style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
              placeholder={notesPlaceholder}
              value={notes}
              onChange={e => { setNotes(e.target.value); setError(null); }}
              onKeyDown={handleKey}
              autoFocus
            />
          </>
        )}

        <label style={s.label}>Super Admin PIN</label>
        <input
          style={s.input}
          type="password"
          placeholder="Any super admin's PIN"
          value={pin}
          onChange={e => { setPin(e.target.value); setError(null); }}
          onKeyDown={handleKey}
          autoFocus={!requireNotes}
        />
        {error && <p style={s.errorText}>{error}</p>}

        <div style={s.buttons}>
          <button style={{ ...s.btnConfirm, background: confirmBg, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
            {busy ? 'Verifying…' : confirmLabel}
          </button>
          <button style={s.btnCancel} onClick={onCancel} disabled={busy}>Cancel</button>
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
    background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 440,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  description: { margin: '0 0 1rem', color: '#374151', lineHeight: 1.5, fontSize: '0.92rem' },
  label: { fontWeight: 600, fontSize: '0.82rem', display: 'block', margin: '0.5rem 0 0.25rem', color: '#374151' },
  input: { width: '100%', padding: '0.6rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.95rem', boxSizing: 'border-box' },
  errorText: { color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  buttons: { display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' },
  btnConfirm: { padding: '0.6rem 1.2rem', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, flex: 1, minWidth: 120 },
  btnCancel: { padding: '0.6rem 1.2rem', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem' },
};
