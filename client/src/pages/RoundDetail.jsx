import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

const BALLOT_SIZES = [
  { value: 'letter', label: 'Letter (8.5" x 11")' },
  { value: 'half_letter', label: 'Half Letter (5.5" x 8.5")' },
  { value: 'quarter_letter', label: 'Quarter Letter (4.25" x 5.5")' },
  { value: 'eighth_letter', label: '1/8 Letter (2.75" x 4.25")' },
];

export default function RoundDetail() {
  const { id: electionId, raceId, roundId } = useParams();
  const [round, setRound] = useState(null);
  const [quantity, setQuantity] = useState(50);
  const [size, setSize] = useState('letter');
  const [logo, setLogo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);

  const fetchRound = async () => {
    const { data } = await api.get(`/admin/rounds/${roundId}`);
    setRound(data);
    // Check if ballots already exist by trying preview
    try {
      const resp = await fetch(`/api/admin/rounds/${roundId}/ballot-preview`, { method: 'HEAD' });
      if (resp.ok) setGenerated(true);
    } catch {}
  };

  useEffect(() => { fetchRound(); }, [roundId]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('quantity', quantity);
      formData.append('size', size);
      if (logo) formData.append('logo', logo);

      await api.post(`/admin/rounds/${roundId}/generate-ballots`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setGenerated(true);
      setPreviewUrl(`/api/admin/rounds/${roundId}/ballot-preview?t=${Date.now()}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate ballots');
    } finally {
      setGenerating(false);
    }
  };

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending: '#f59e0b', scanning: '#3b82f6', confirmed: '#10b981', pending_release: '#8b5cf6', released: '#6366f1' };

  return (
    <div style={styles.container}>
      <Link to={`/admin/elections/${electionId}/races/${raceId}`} style={styles.backLink}>
        &larr; Back to {round.race?.name || 'Race'}
      </Link>

      <div style={styles.header}>
        <div>
          <h1>Round {round.round_number}</h1>
          <p style={styles.muted}>Paper color: {round.paper_color}</p>
        </div>
        <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
          {round.status}
        </span>
      </div>

      {/* Action Links */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link to={`/scan/${roundId}`} style={styles.btnLink}>Open Scanner</Link>
        {['scanning', 'pending'].includes(round.status) && (
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/confirm`} style={styles.btnLinkGreen}>
            Confirm Round
          </Link>
        )}
        {['confirmed', 'pending_release', 'released'].includes(round.status) && (
          <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`} style={styles.btnLinkPurple}>
            Chair Decision
          </Link>
        )}
        {['confirmed', 'pending_release', 'released'].includes(round.status) && (
          <a href={`/api/admin/rounds/${roundId}/results-pdf`} style={styles.btnLinkGreen} download>
            Download Results PDF
          </a>
        )}
      </div>

      {/* Passes summary */}
      {round.passes && round.passes.length > 0 && (
        <div style={styles.section}>
          <h2>Passes</h2>
          {round.passes.map(p => (
            <div key={p.id} style={styles.passRow}>
              <span>Pass {p.pass_number}</span>
              <span style={styles.muted}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Results summary */}
      {round.results && round.results.length > 0 && (
        <div style={styles.section}>
          <h2>Results</h2>
          {round.results.map(r => (
            <div key={r.id} style={styles.resultRow}>
              <span style={{ fontWeight: 600 }}>{r.candidate_name}</span>
              <span>{r.vote_count} votes ({Number(r.percentage).toFixed(5)}%)</span>
            </div>
          ))}
        </div>
      )}

      {/* Generate Ballots Section */}
      <div style={styles.section}>
        <h2>Generate Ballots</h2>

        <form onSubmit={handleGenerate} style={styles.genForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Quantity</label>
            <input
              style={styles.input}
              type="number"
              min="1"
              max="5000"
              value={quantity}
              onChange={e => setQuantity(parseInt(e.target.value) || 1)}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Ballot Size</label>
            <select style={styles.input} value={size} onChange={e => setSize(e.target.value)}>
              {BALLOT_SIZES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Logo (optional)</label>
            <input
              style={styles.input}
              type="file"
              accept="image/*"
              onChange={e => setLogo(e.target.files[0] || null)}
            />
          </div>

          <button
            style={{ ...styles.btnPrimary, opacity: generating ? 0.6 : 1 }}
            type="submit"
            disabled={generating}
          >
            {generating ? 'Generating...' : 'Generate Ballots'}
          </button>
        </form>

        {error && <p style={styles.errorMsg}>{error}</p>}

        {generated && (
          <div style={styles.downloadSection}>
            <h3>Downloads</h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                href={`/api/admin/rounds/${roundId}/ballot-pdf`}
                style={styles.btnDownload}
                download
              >
                Download PDF
              </a>
              <a
                href={`/api/admin/rounds/${roundId}/ballot-data`}
                style={styles.btnDownload}
                download
              >
                Download Data ZIP
              </a>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Preview</h3>
            <iframe
              src={previewUrl || `/api/admin/rounds/${roundId}/ballot-preview`}
              style={styles.previewFrame}
              title="Ballot Preview"
            />
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '2rem' },
  passRow: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  resultRow: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eee' },
  genForm: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 400 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontWeight: 600, fontSize: '0.85rem' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  downloadSection: { marginTop: '1.5rem', padding: '1rem', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' },
  previewFrame: { width: '100%', height: 500, border: '1px solid #ddd', borderRadius: 4, marginTop: '0.5rem' },
  statusBadge: { color: '#fff', padding: '4px 12px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 },
  btnPrimary: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem', alignSelf: 'flex-start' },
  btnDownload: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'none', display: 'inline-block' },
  btnLink: { padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  btnLinkGreen: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  btnLinkPurple: { padding: '0.5rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.5rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
