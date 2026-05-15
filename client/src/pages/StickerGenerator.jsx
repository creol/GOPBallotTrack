import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

const SIZE_OPTIONS = [
  { value: 'avery_5160', label: 'Avery 5160 — 1" × 2-5/8" (30 / sheet)' },
  { value: 'avery_8460', label: 'Avery 8460 — 1" × 2-5/8" (30 / sheet)' },
  { value: 'avery_5163', label: 'Avery 5163 — 2" × 4" (10 / sheet)' },
  { value: '1x1', label: '1" × 1" square' },
  { value: '1.5x1.5', label: '1.5" × 1.5" square' },
  { value: '2x2', label: '2" × 2" square' },
  { value: 'custom', label: 'Custom size…' },
];

function formatDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleString();
}

export default function StickerGenerator() {
  const { id } = useParams();
  const [election, setElection] = useState(null);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState({
    count: 250,
    sizePreset: 'avery_5160',
    customWidth: 2,
    customHeight: 1,
    pageSize: 'letter',
    errorCorrection: 'M',
    batchName: '',
    notes: '',
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadElection = async () => {
    const { data } = await api.get(`/admin/elections/${id}`);
    setElection(data);
  };
  const loadBatches = async () => {
    const { data } = await api.get(`/admin/elections/${id}/sticker-batches`);
    setBatches(data);
  };

  useEffect(() => {
    loadElection().catch(() => setError('Could not load election'));
    loadBatches().catch(() => {});
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const downloadPdf = (batchId) => {
    // Authenticated download — browser navigation carries the session cookie.
    window.open(`/api/admin/sticker-batches/${batchId}/pdf`, '_blank');
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const count = parseInt(form.count, 10);
    if (!Number.isInteger(count) || count < 1 || count > 50000) {
      setError('Sticker count must be a whole number between 1 and 50000.');
      return;
    }
    setGenerating(true);
    try {
      const payload = {
        count,
        sizePreset: form.sizePreset,
        pageSize: form.pageSize,
        errorCorrection: form.errorCorrection,
        batchName: form.batchName.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (form.sizePreset === 'custom') {
        payload.customWidth = parseFloat(form.customWidth);
        payload.customHeight = parseFloat(form.customHeight);
      }
      const { data: batch } = await api.post(`/admin/elections/${id}/sticker-batches`, payload);
      setNotice(`Generated ${batch.count} stickers. The PDF is opening in a new tab.`);
      setForm((f) => ({ ...f, batchName: '', notes: '' }));
      await loadBatches();
      downloadPdf(batch.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Sticker generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const isCustom = form.sizePreset === 'custom';

  return (
    <ElectionLayout electionId={id}>
      <div style={s.header}>
        <h1 style={s.h1}>QR Token Sticker Generator</h1>
        {election && (
          <div style={s.eventMeta}>
            <strong>{election.name}</strong>
            {election.event_code && (
              <span style={s.code}>event code: {election.event_code}</span>
            )}
          </div>
        )}
      </div>

      <p style={s.intro}>
        Each sticker carries a unique QR token that a credentialer activates at check-in.
        Tokens are inert until activated. A batch cannot be deleted once generated, since
        its stickers may already be in physical circulation.
      </p>

      {error && <div style={s.error}>{error}</div>}
      {notice && <div style={s.notice}>{notice}</div>}

      <form onSubmit={handleGenerate} style={s.card}>
        <h2 style={s.h2}>Generate a Batch</h2>
        <div style={s.grid}>
          <label style={s.field}>
            <span style={s.label}>Number of stickers</span>
            <input type="number" min="1" max="50000" value={form.count}
              onChange={set('count')} style={s.input} required />
          </label>

          <label style={s.field}>
            <span style={s.label}>Sticker size</span>
            <select value={form.sizePreset} onChange={set('sizePreset')} style={s.input}>
              {SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          {isCustom && (
            <>
              <label style={s.field}>
                <span style={s.label}>Custom width (inches)</span>
                <input type="number" step="0.05" min="0.5" max="8"
                  value={form.customWidth} onChange={set('customWidth')} style={s.input} />
              </label>
              <label style={s.field}>
                <span style={s.label}>Custom height (inches)</span>
                <input type="number" step="0.05" min="0.5" max="11"
                  value={form.customHeight} onChange={set('customHeight')} style={s.input} />
              </label>
            </>
          )}

          <label style={s.field}>
            <span style={s.label}>Page size</span>
            <select value={form.pageSize} onChange={set('pageSize')} style={s.input}>
              <option value="letter">Letter (8.5" × 11")</option>
              <option value="a4">A4</option>
            </select>
            <span style={s.hint}>Avery presets always print on Letter stock.</span>
          </label>

          <label style={s.field}>
            <span style={s.label}>QR error correction</span>
            <select value={form.errorCorrection} onChange={set('errorCorrection')} style={s.input}>
              <option value="M">M — recommended for handheld scanners</option>
              <option value="H">H — recommended for damaged stickers</option>
            </select>
          </label>

          <label style={s.field}>
            <span style={s.label}>Batch name (optional)</span>
            <input type="text" value={form.batchName} onChange={set('batchName')}
              style={s.input} placeholder="e.g. Front desk — Saturday" />
          </label>

          <label style={{ ...s.field, gridColumn: '1 / -1' }}>
            <span style={s.label}>Notes (optional)</span>
            <textarea value={form.notes} onChange={set('notes')} style={{ ...s.input, minHeight: 56 }} />
          </label>
        </div>

        <button type="submit" disabled={generating} style={generating ? s.btnDisabled : s.btn}>
          {generating ? 'Generating…' : 'Generate Stickers'}
        </button>
        {generating && <span style={s.hint}> Large batches can take a minute.</span>}
      </form>

      <div style={s.card}>
        <h2 style={s.h2}>Existing Batches</h2>
        {batches.length === 0 ? (
          <p style={s.muted}>No batches generated yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Batch</th>
                <th style={s.th}>Count</th>
                <th style={s.th}>Size</th>
                <th style={s.th}>Generated</th>
                <th style={s.th}>By</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td style={s.td}>{b.batch_name || <span style={s.muted}>#{b.id}</span>}</td>
                  <td style={s.td}>{b.count}</td>
                  <td style={s.td}>{b.size_preset}</td>
                  <td style={s.td}>{formatDateTime(b.generated_at)}</td>
                  <td style={s.td}>{b.generated_by || <span style={s.muted}>—</span>}</td>
                  <td style={s.td}>
                    {b.pdf_available
                      ? <button type="button" onClick={() => downloadPdf(b.id)} style={s.linkBtn}>Download PDF</button>
                      : <span style={s.muted}>PDF unavailable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ElectionLayout>
  );
}

const s = {
  header: { marginBottom: '0.5rem' },
  h1: { fontSize: '1.4rem', margin: 0 },
  h2: { fontSize: '1.05rem', margin: '0 0 0.75rem' },
  eventMeta: { display: 'flex', gap: '0.75rem', alignItems: 'baseline', marginTop: '0.25rem', color: '#4b5563' },
  code: { fontFamily: 'monospace', fontSize: '0.85rem', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: 4 },
  intro: { color: '#6b7280', fontSize: '0.9rem', maxWidth: 680 },
  card: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontSize: '0.8rem', fontWeight: 600, color: '#374151' },
  hint: { fontSize: '0.72rem', color: '#9ca3af' },
  input: { padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.88rem' },
  btn: { marginTop: '0.9rem', padding: '0.5rem 1.1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.9rem', cursor: 'pointer' },
  btnDisabled: { marginTop: '0.9rem', padding: '0.5rem 1.1rem', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.9rem', cursor: 'not-allowed' },
  linkBtn: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.85rem', padding: 0, textDecoration: 'underline' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { textAlign: 'left', padding: '0.4rem 0.5rem', borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '0.4rem 0.5rem', borderBottom: '1px solid #f3f4f6' },
  muted: { color: '#9ca3af' },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.6rem 0.8rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.88rem' },
  notice: { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '0.6rem 0.8rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.88rem' },
};
