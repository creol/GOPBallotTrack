import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

function formatDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CredentialingAdmin() {
  const { id } = useParams();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/credentialing/${id}/status`);
      setStatus(data);
    } catch {
      setError('Could not load credentialing status.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Live updates — activations and window changes broadcast credentialing:changed.
  useEffect(() => {
    const socket = socketIO();
    socket.on('credentialing:changed', (p) => {
      if (!p || p.election_id === parseInt(id, 10)) load();
    });
    return () => socket.disconnect();
  }, [id, load]);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    setError('');
    const action = status.credentialing_open ? 'close' : 'open';
    try {
      await api.post(`/admin/credentialing/${id}/${action}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || `Could not ${action} credentialing.`);
    } finally {
      setBusy(false);
    }
  };

  const c = status?.counts;
  const open = status?.credentialing_open;

  return (
    <ElectionLayout electionId={id}>
      <h1 style={s.h1}>Credentialing</h1>
      {status?.election && <div style={s.eventMeta}>{status.election.name}</div>}

      {error && <div style={s.error}>{error}</div>}

      <div style={s.card}>
        <div style={s.windowRow}>
          <div>
            <div style={s.windowLabel}>Credentialing window</div>
            <div style={{ ...s.windowState, color: open ? '#15803d' : '#6b7280' }}>
              {open ? 'OPEN' : 'CLOSED'}
            </div>
          </div>
          <button type="button" onClick={toggle} disabled={busy}
            style={busy ? s.btnDisabled : (open ? s.btnClose : s.btnOpen)}>
            {busy ? 'Working…' : (open ? 'Close Credentialing' : 'Open Credentialing')}
          </button>
        </div>
        {status?.vote_open && (
          <div style={s.warn}>
            An electronic vote is currently open. Credentialing cannot be opened until the vote is closed.
          </div>
        )}
        <div style={s.linkRow}>
          <a href={`/credentialing/activate?event=${id}`} target="_blank" rel="noreferrer" style={s.linkBtn}>
            Open Voter Activation Page ↗
          </a>
          <Link to={`/admin/elections/${id}/replacement-token`} style={s.linkBtn}>
            Replacement Token →
          </Link>
        </div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Token Status</h2>
        {c ? (
          <div style={s.statGrid}>
            <Stat label="Total generated" value={c.total} />
            <Stat label="Activated — in-person" value={c.activated_in_person} color="#15803d" />
            <Stat label="Activated — remote" value={c.activated_remote} color="#a16207" />
            <Stat label="Revoked" value={c.revoked} color="#b91c1c" />
            <Stat label="Available (unactivated)" value={c.available} color="#2563eb" />
          </div>
        ) : <p style={s.muted}>Loading…</p>}
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Recent Activations</h2>
        {status?.recent?.length ? (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Token</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Activated</th>
                <th style={s.th}>By</th>
              </tr>
            </thead>
            <tbody>
              {status.recent.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>••••{r.token_last2 || '??'}</td>
                  <td style={s.td}>{r.voter_type === 'remote' ? 'Remote' : 'In-Person'}</td>
                  <td style={s.td}>{formatDateTime(r.activated_at)}</td>
                  <td style={s.td}>{r.activated_by || <span style={s.muted}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={s.muted}>No activations yet.</p>}
      </div>
    </ElectionLayout>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={s.stat}>
      <div style={{ ...s.statValue, color: color || '#111827' }}>{value ?? '—'}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

const s = {
  h1: { fontSize: '1.4rem', margin: 0 },
  h2: { fontSize: '1.05rem', margin: '0 0 0.75rem' },
  eventMeta: { color: '#4b5563', marginTop: '0.25rem', marginBottom: '0.75rem', fontWeight: 600 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' },
  windowRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  windowLabel: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' },
  windowState: { fontSize: '1.5rem', fontWeight: 700 },
  btnOpen: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.95rem', cursor: 'pointer' },
  btnClose: { padding: '0.6rem 1.2rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.95rem', cursor: 'pointer' },
  btnDisabled: { padding: '0.6rem 1.2rem', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.95rem', cursor: 'not-allowed' },
  warn: { marginTop: '0.8rem', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '0.6rem 0.8rem', borderRadius: 6, fontSize: '0.88rem' },
  linkRow: { display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' },
  linkBtn: { padding: '0.5rem 0.9rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: '0.88rem', textDecoration: 'none' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' },
  stat: { border: '1px solid #f3f4f6', borderRadius: 8, padding: '0.75rem', textAlign: 'center', background: '#fafafa' },
  statValue: { fontSize: '1.8rem', fontWeight: 700 },
  statLabel: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { textAlign: 'left', padding: '0.4rem 0.5rem', borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '0.4rem 0.5rem', borderBottom: '1px solid #f3f4f6' },
  muted: { color: '#9ca3af' },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.6rem 0.8rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.88rem' },
};
