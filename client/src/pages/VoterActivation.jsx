import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';

// Standalone credentialer page (/credentialing/activate). Activates QR-sticker
// tokens as voters check in. Admin-authenticated; intentionally focused — no
// admin nav chrome — since it is used on a check-in tablet with a 2D scanner.
export default function VoterActivation() {
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [voterType, setVoterType] = useState(
    () => localStorage.getItem('cred.voterType') || 'in_person'
  );
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  const loadEvents = async () => {
    const { data } = await api.get('/admin/credentialing/events');
    setEvents(data);
    return data;
  };

  useEffect(() => {
    loadEvents().then((data) => {
      const open = data.filter((e) => e.credentialing_open);
      const fromUrl = parseInt(searchParams.get('event'), 10);
      const fromStore = parseInt(localStorage.getItem('cred.lastEvent'), 10);
      let chosen = null;
      if (data.some((e) => e.id === fromUrl)) chosen = fromUrl;
      else if (open.some((e) => e.id === fromStore)) chosen = fromStore;
      else if (open.length === 1) chosen = open[0].id;
      if (chosen) setEventId(chosen);
    }).catch(() => setError('Could not load events.'));
  }, []);

  const event = useMemo(() => events.find((e) => e.id === eventId) || null, [events, eventId]);
  const canActivate = event && event.credentialing_open;

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);
  useEffect(() => { if (canActivate && !result) focusInput(); }, [canActivate, result]);

  const pickEvent = (id) => {
    setEventId(id);
    setError('');
    setResult(null);
    if (id) localStorage.setItem('cred.lastEvent', String(id));
  };

  const pickType = (t) => {
    setVoterType(t);
    localStorage.setItem('cred.voterType', t);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!input.trim() || busy || !canActivate) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/admin/credentialing/activate', {
        electionId: eventId, token: input.trim(), voterType,
      });
      setResult(data);
      setInput('');
    } catch (err) {
      setError(err.response?.data?.error || 'Activation failed.');
      setInput('');
      focusInput();
    } finally {
      setBusy(false);
    }
  };

  const nextVoter = () => {
    setResult(null);
    setError('');
    setInput('');
    setCopied(false);
    focusInput();
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

  const openEvents = events.filter((e) => e.credentialing_open);

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <span style={s.brand}>BallotTrack — Voter Credentialing</span>
        <select
          value={eventId || ''}
          onChange={(e) => pickEvent(parseInt(e.target.value, 10) || null)}
          style={s.eventSelect}
        >
          <option value="">Select an event…</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}{e.credentialing_open ? '' : ' (credentialing closed)'}
            </option>
          ))}
        </select>
      </div>

      <div style={s.center}>
        {!event && (
          <div style={s.card}>
            <h1 style={s.h1}>Select an event</h1>
            {openEvents.length === 0
              ? <p style={s.muted}>No events are open for credentialing. An admin must open credentialing first.</p>
              : <p style={s.muted}>Choose the event you are credentialing from the menu above.</p>}
          </div>
        )}

        {event && !canActivate && (
          <div style={s.card}>
            <h1 style={s.h1}>{event.name}</h1>
            <div style={s.warn}>Credentialing is closed for this event. An admin must open it before tokens can be activated.</div>
          </div>
        )}

        {canActivate && !result && (
          <div style={s.card}>
            <div style={s.eventName}>{event.name}</div>

            <div style={s.toggleRow}>
              <button type="button" onClick={() => pickType('in_person')}
                style={{ ...s.toggle, ...(voterType === 'in_person' ? s.toggleOnGreen : {}) }}>
                In-Person Attendee
              </button>
              <button type="button" onClick={() => pickType('remote')}
                style={{ ...s.toggle, ...(voterType === 'remote' ? s.toggleOnYellow : {}) }}>
                Remote Attendee
              </button>
            </div>

            <form onSubmit={submit}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Scan QR or type the token"
                autoFocus
                autoComplete="off"
                spellCheck="false"
                style={s.scanInput}
              />
              <button type="submit" disabled={busy || !input.trim()}
                style={(busy || !input.trim()) ? s.btnDisabled : s.btnPrimary}>
                {busy ? 'Activating…' : 'Activate'}
              </button>
            </form>

            {error && <div style={s.error}>{error}</div>}
          </div>
        )}

        {result && (
          <div style={s.card}>
            <div style={s.okBadge}>✓ Token activated</div>
            <div style={s.bigToken}>{result.token}</div>
            <div style={s.urlLabel}>Voting link</div>
            <div style={s.url}>{result.votingUrl}</div>
            <div style={s.typeChip(result.voterType)}>
              {result.voterType === 'remote' ? 'Remote' : 'In-Person'}
            </div>
            <div style={s.actionRow}>
              <button type="button" onClick={copy} style={s.btnCopy}>
                {copied ? 'Copied!' : 'Copy link + token'}
              </button>
              <button type="button" onClick={nextVoter} style={s.btnPrimary}>Next Voter</button>
            </div>
            {error && <div style={s.error}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' },
  topbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.6rem 1rem', background: '#1f2937', color: '#fff', gap: '1rem', flexWrap: 'wrap',
  },
  brand: { fontWeight: 700, fontSize: '0.95rem' },
  eventSelect: { padding: '0.35rem 0.5rem', borderRadius: 4, border: '1px solid #4b5563', fontSize: '0.85rem' },
  center: { display: 'flex', justifyContent: 'center', padding: '2rem 1rem' },
  card: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: '1.75rem', width: '100%', maxWidth: 520, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  h1: { fontSize: '1.3rem', margin: '0 0 0.5rem' },
  muted: { color: '#6b7280' },
  warn: { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '0.7rem 0.9rem', borderRadius: 8 },
  eventName: { fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', marginBottom: '1rem' },
  toggleRow: { display: 'flex', gap: '0.5rem', marginBottom: '1.1rem' },
  toggle: {
    flex: 1, padding: '0.85rem 0.5rem', fontSize: '0.95rem', fontWeight: 600,
    border: '2px solid #d1d5db', borderRadius: 8, background: '#f9fafb', color: '#6b7280', cursor: 'pointer',
  },
  toggleOnGreen: { borderColor: '#16a34a', background: '#dcfce7', color: '#15803d' },
  toggleOnYellow: { borderColor: '#ca8a04', background: '#fef9c3', color: '#a16207' },
  scanInput: {
    width: '100%', boxSizing: 'border-box', padding: '0.9rem 0.8rem', fontSize: '1.4rem',
    fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.1em',
    border: '2px solid #2563eb', borderRadius: 8, marginBottom: '0.8rem', textTransform: 'uppercase',
  },
  btnPrimary: {
    width: '100%', padding: '0.85rem', fontSize: '1.05rem', fontWeight: 600,
    background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
  },
  btnDisabled: {
    width: '100%', padding: '0.85rem', fontSize: '1.05rem', fontWeight: 600,
    background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 8, cursor: 'not-allowed',
  },
  btnCopy: {
    flex: 1, padding: '0.85rem', fontSize: '1.05rem', fontWeight: 600,
    background: '#fff', color: '#2563eb', border: '2px solid #2563eb', borderRadius: 8, cursor: 'pointer',
  },
  okBadge: { textAlign: 'center', color: '#15803d', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.75rem' },
  bigToken: {
    textAlign: 'center', fontFamily: 'monospace', fontSize: '3rem', fontWeight: 700,
    letterSpacing: '0.15em', margin: '0.25rem 0 1rem',
  },
  urlLabel: { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' },
  url: {
    fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all',
    background: '#f3f4f6', padding: '0.5rem 0.6rem', borderRadius: 6, margin: '0.2rem 0 0.8rem',
  },
  typeChip: (t) => ({
    display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
    marginBottom: '1rem',
    background: t === 'remote' ? '#fef9c3' : '#dcfce7',
    color: t === 'remote' ? '#a16207' : '#15803d',
    border: `1px solid ${t === 'remote' ? '#fde68a' : '#bbf7d0'}`,
  }),
  actionRow: { display: 'flex', gap: '0.6rem' },
  error: {
    marginTop: '0.9rem', background: '#fef2f2', border: '1px solid #fecaca',
    color: '#b91c1c', padding: '0.7rem 0.9rem', borderRadius: 8, fontSize: '0.9rem',
  },
};
