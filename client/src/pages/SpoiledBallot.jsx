import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../api/client';

export default function SpoiledBallot() {
  const { roundId } = useParams();
  const [round, setRound] = useState(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [spoilType, setSpoilType] = useState('unreadable');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const html5QrRef = useRef(null);

  useEffect(() => {
    api.get(`/rounds/${roundId}/detail`).then(({ data }) => setRound(data));
    return () => { stopScanner(); };
  }, [roundId]);

  const startScanner = async () => {
    try {
      const scanner = new Html5Qrcode('spoiled-qr-reader');
      html5QrRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        (decodedText) => {
          const sn = decodedText.trim().toUpperCase();
          if (sn.length >= 8) setSerialNumber(sn);
          stopScanner();
        },
        () => {}
      );
    } catch (err) {
      setFeedback({ type: 'error', message: 'Could not start camera' });
    }
  };

  const stopScanner = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
      setScanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serialNumber || serialNumber.length < 8) {
      setFeedback({ type: 'error', message: 'Serial number must be at least 8 characters' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('serial_number', serialNumber);
      formData.append('spoil_type', spoilType);
      if (notes) formData.append('notes', notes);
      if (image) formData.append('image', image);

      await api.post(`/rounds/${roundId}/spoiled`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setFeedback({ type: 'success', message: `Ballot ${serialNumber} marked as spoiled` });
      setSerialNumber('');
      setNotes('');
      setImage(null);
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to log spoiled ballot' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  return (
    <div style={styles.container}>
      <Link to={`/scan/${roundId}`} style={styles.backLink}>&larr; Back to Scanner</Link>
      <h2>Report Spoiled Ballot</h2>
      <p style={styles.muted}>{round.race?.name} — Round {round.round_number}</p>

      {feedback && (
        <div style={{
          ...styles.feedback,
          background: feedback.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: feedback.type === 'success' ? '#166534' : '#dc2626',
        }}>
          {feedback.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        {/* Spoil Type */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Spoil Type</label>
          <div style={styles.radioGroup}>
            <label style={styles.radioLabel}>
              <input type="radio" value="unreadable" checked={spoilType === 'unreadable'} onChange={e => setSpoilType(e.target.value)} />
              Unreadable / Jammed
            </label>
            <label style={styles.radioLabel}>
              <input type="radio" value="intent_undermined" checked={spoilType === 'intent_undermined'} onChange={e => setSpoilType(e.target.value)} />
              Intent Undermined
            </label>
          </div>
        </div>

        {/* Serial Number */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Serial Number</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              style={{ ...styles.input, flex: 1, fontFamily: 'monospace', textTransform: 'uppercase' }}
              placeholder="Enter or scan SN"
              value={serialNumber}
              onChange={e => setSerialNumber(e.target.value.toUpperCase())}
              minLength={8}
              required
            />
            <button type="button" style={styles.btnSmall} onClick={scanning ? stopScanner : startScanner}>
              {scanning ? 'Stop' : 'Scan QR'}
            </button>
          </div>
          <div id="spoiled-qr-reader" style={{ width: '100%', maxWidth: 280, marginTop: scanning ? '0.5rem' : 0 }} />
        </div>

        {/* Camera capture for jammed ballots */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Photo (for jammed/unreadable ballots)</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={e => setImage(e.target.files[0] || null)}
            style={styles.input}
          />
        </div>

        {/* Notes */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Notes</label>
          <textarea
            style={{ ...styles.input, minHeight: 80, resize: 'vertical' }}
            placeholder="Describe the issue..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <button style={{ ...styles.btnDanger, opacity: submitting ? 0.6 : 1 }} type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Mark as Spoiled'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { maxWidth: 500, margin: '0 auto', padding: '0.75rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '0.75rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  label: { fontWeight: 600, fontSize: '0.85rem' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  radioLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' },
  feedback: { padding: '0.75rem', borderRadius: 6, marginBottom: '0.75rem', fontWeight: 600, textAlign: 'center' },
  btnSmall: { padding: '0.4rem 0.8rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  btnDanger: { padding: '0.75rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
};
