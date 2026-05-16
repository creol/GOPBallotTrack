import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

// Chair-only replacement-token flow. Issues a fresh activated token to a voter
// whose original sticker was lost or spoiled, optionally revoking the original.
export default function ReplacementToken() {
  const { id } = useParams();
  const [form, setForm] = useState({
    originalToken: '', reason: '', voterType: 'in_person', confirmed: false,
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.reason.trim()) { setError('A reason is required.'); return; }
    if (!form.confirmed) { setError('You must confirm the body authorized this replacement.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/credentialing/${id}/replacement-token`, {
        originalToken: form.originalToken.trim() || null,
        reason: form.reason.trim(),
        voterType: form.voterType,
        confirmed: true,
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not issue a replacement token.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setForm({ originalToken: '', reason: '', voterType: 'in_person', confirmed: false });
    setResult(null);
    setError('');
    setCopied(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${result.votingUrl}\n${result.token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Copy failed — select and copy the text manually.');
    }
  };

  return (
    <ElectionLayout electionId={id}>
      <h1 style={s.h1}>Replacement Token</h1>
      <p style={s.intro}>
        Issues a new activated token to a voter whose sticker was lost or spoiled.
        Every replacement is logged. This action is restricted to the chair.
      </p>

      {error && <div style={s.error}>{error}</div>}

      {result ? (
        <div style={s.card}>
          <div style={s.okBadge}>✓ Replacement token issued</div>
          <div style={s.bigToken}>{result.token}</div>
          <div style={s.urlLabel}>Voting link</div>
          <div style={s.url}>{result.votingUrl}</div>
          <p style={s.muted}>
            Voter type: {result.voterType === 'remote' ? 'Remote' : 'In-Person'}
            {result.original_revoked
              ? ' · the original token was revoked.'
              : ' · no original token was revoked.'}
          </p>
          <div style={s.actionRow}>
            <button type="button" onClick={copy} style={s.btnCopy}>
              {copied ? 'Copied!' : 'Copy link + token'}
            </button>
            <button type="button" onClick={reset} style={s.btnPrimary}>Issue Another</button>
          </div>
          <Link to={`/admin/elections/${id}/credentialing`} style={s.backLink}>← Back to Credentialing</Link>
        </div>
      ) : (
        <form onSubmit={submit} style={s.card}>
          <label style={s.field}>
            <span style={s.label}>Original token (optional)</span>
            <input type="text" value={form.originalToken}
              onChange={(e) => set('originalToken', e.target.value)}
              placeholder="If known, it will be revoked"
              style={s.input} autoComplete="off" spellCheck="false" />
          </label>

          <label style={s.field}>
            <span style={s.label}>Reason (required)</span>
            <textarea value={form.reason} onChange={(e) => set('reason', e.target.value)}
              style={{ ...s.input, minHeight: 64 }} placeholder="e.g. Voter lost their sticker" />
          </label>

          <div style={s.field}>
            <span style={s.label}>Voter type</span>
            <div style={s.toggleRow}>
              <button type="button" onClick={() => set('voterType', 'in_person')}
                style={{ ...s.toggle, ...(form.voterType === 'in_person' ? s.toggleOnGreen : {}) }}>
                In-Person
              </button>
              <button type="button" onClick={() => set('voterType', 'remote')}
                style={{ ...s.toggle, ...(form.voterType === 'remote' ? s.toggleOnYellow : {}) }}>
                Remote
              </button>
            </div>
          </div>

          <label style={s.checkRow}>
            <input type="checkbox" checked={form.confirmed}
              onChange={(e) => set('confirmed', e.target.checked)} />
            <span>The body has authorized this replacement.</span>
          </label>

          <button type="submit" disabled={busy} style={busy ? s.btnDisabled : s.btnPrimary}>
            {busy ? 'Issuing…' : 'Issue Replacement Token'}
          </button>
        </form>
      )}
    </ElectionLayout>
  );
}

const s = {
  h1: { fontSize: '1.4rem', margin: 0 },
  intro: { color: '#6b7280', fontSize: '0.9rem', maxWidth: 620 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', maxWidth: 560, marginBottom: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.85rem' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: '#374151' },
  input: { padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' },
  toggleRow: { display: 'flex', gap: '0.5rem' },
  toggle: {
    flex: 1, padding: '0.6rem', fontSize: '0.9rem', fontWeight: 600,
    border: '2px solid #d1d5db', borderRadius: 6, background: '#f9fafb', color: '#6b7280', cursor: 'pointer',
  },
  toggleOnGreen: { borderColor: '#16a34a', background: '#dcfce7', color: '#15803d' },
  toggleOnYellow: { borderColor: '#ca8a04', background: '#fef9c3', color: '#a16207' },
  checkRow: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start', margin: '0.25rem 0 1rem', fontSize: '0.9rem' },
  btnPrimary: { padding: '0.6rem 1.1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.92rem', cursor: 'pointer' },
  btnDisabled: { padding: '0.6rem 1.1rem', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.92rem', cursor: 'not-allowed' },
  btnCopy: { flex: 1, padding: '0.6rem 1.1rem', background: '#fff', color: '#2563eb', border: '2px solid #2563eb', borderRadius: 6, fontSize: '0.92rem', cursor: 'pointer' },
  okBadge: { color: '#15803d', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.5rem' },
  bigToken: { fontFamily: 'monospace', fontSize: '2.6rem', fontWeight: 700, letterSpacing: '0.15em', textAlign: 'center', margin: '0.25rem 0 1rem' },
  urlLabel: { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' },
  url: { fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all', background: '#f3f4f6', padding: '0.5rem 0.6rem', borderRadius: 6, margin: '0.2rem 0 0.6rem' },
  actionRow: { display: 'flex', gap: '0.6rem', marginTop: '0.5rem' },
  backLink: { display: 'inline-block', marginTop: '0.9rem', color: '#2563eb', fontSize: '0.85rem' },
  muted: { color: '#6b7280', fontSize: '0.85rem' },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.6rem 0.8rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.88rem', maxWidth: 560 },
};
