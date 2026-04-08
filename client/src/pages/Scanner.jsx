import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { io } from 'socket.io-client';
import api from '../api/client';
import AppHeader from '../components/AppHeader';

export default function Scanner() {
  const { roundId } = useParams();
  const [round, setRound] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [ballotBoxes, setBallotBoxes] = useState([]);
  const [passes, setPasses] = useState([]);
  const [activePass, setActivePass] = useState(null);
  const [scanCount, setScanCount] = useState(0);

  // Scan workflow state
  const [scannedSN, setScannedSN] = useState(null);
  const [manualSN, setManualSN] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [selectedBox, setSelectedBox] = useState('');
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', message }
  const [submitting, setSubmitting] = useState(false);

  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const fetchRoundData = useCallback(async () => {
    try {
      // Use non-admin endpoints for scanner data (tally operators have no auth)
      const { data: roundData } = await api.get(`/rounds/${roundId}/detail`);
      setRound(roundData);
      setCandidates((roundData.candidates || []).filter(c => c.status === 'active'));
      setBallotBoxes(roundData.ballot_boxes || []);
    } catch (err) {
      console.error('Failed to fetch round data:', err);
    }

    try {
      const { data: passData } = await api.get(`/rounds/${roundId}/passes`);
      const passList = Array.isArray(passData) ? passData : [];
      setPasses(passList);
      const active = passList.find(p => p.status === 'active');
      if (active) {
        setActivePass(active);
        setScanCount(parseInt(active.scan_count) || 0);
      } else {
        setActivePass(null);
        // If no active pass but there are passes, show the latest scan count
        const latest = passList[passList.length - 1];
        if (latest) setScanCount(parseInt(latest.scan_count) || 0);
      }
    } catch (err) {
      console.error('Failed to fetch passes:', err);
    }
  }, [roundId]);

  useEffect(() => {
    fetchRoundData();
    // Auto-refresh when ADF scanner records ballots
    const socket = io();
    socket.on('scan:recorded', () => fetchRoundData());
    socket.on('scan:flagged', () => fetchRoundData());
    socket.on('pass:complete', () => fetchRoundData());
    return () => socket.disconnect();
  }, [fetchRoundData]);

  // Start QR camera
  const startScanner = async () => {
    if (html5QrRef.current) return;
    try {
      const scanner = new Html5Qrcode('qr-reader');
      html5QrRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleQRScan(decodedText),
        () => {} // ignore errors during scanning
      );
    } catch (err) {
      console.error('Camera start error:', err);
      setFeedback({ type: 'error', message: 'Could not start camera. Use Manual Entry.' });
    }
  };

  const stopScanner = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
      setScanning(false);
    }
  };

  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  const handleQRScan = (decodedText) => {
    // QR encodes plain serial number string
    const sn = decodedText.trim().toUpperCase();
    if (sn.length >= 8) {
      setScannedSN(sn);
      stopScanner();
      setFeedback(null);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualSN.length >= 8) {
      setScannedSN(manualSN.toUpperCase());
      setShowManual(false);
      setManualSN('');
      setFeedback(null);
    }
  };

  const handleVote = async (candidateId) => {
    if (!activePass || !scannedSN || submitting) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/passes/${activePass.id}/scans`, {
        serial_number: scannedSN,
        candidate_id: candidateId,
        ballot_box_id: selectedBox || undefined,
      });
      setScanCount(data.count);
      setFeedback({ type: 'success', message: `Ballot ${scannedSN} recorded` });
      setScannedSN(null);
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Scan failed' });
      setScannedSN(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePass = async () => {
    const { data } = await api.post(`/rounds/${roundId}/passes`);
    setActivePass(data);
    setScanCount(0);
    fetchRoundData();
  };

  const handleCompletePass = async () => {
    if (!activePass) return;
    if (!confirm(`Complete Pass ${activePass.pass_number}? This cannot be undone.`)) return;
    await api.put(`/passes/${activePass.id}/complete`);
    setActivePass(null);
    fetchRoundData();
  };

  const clearFeedback = () => {
    setFeedback(null);
    setScannedSN(null);
  };

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  return (
    <div style={styles.container}>
      <AppHeader title="Scanner" />
      <div style={styles.topBar}>
        <div>
          <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '0.4rem 0.75rem', marginBottom: '0.35rem', fontSize: '0.82rem', color: '#1e40af', fontWeight: 600 }}>
            Scanning for: {round.race?.name || 'Race'} — Round {round.round_number} ({round.paper_color})
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/station-setup" style={styles.backLink}>Change</Link>
          {round.race?.election_id && (
            <Link to={`/admin/elections/${round.race.election_id}/races/${round.race_id}/rounds/${roundId}`} style={styles.backLink}>
              Back to Round
            </Link>
          )}
        </div>
      </div>

      {/* Pass Controls */}
      <div style={styles.passBar}>
        {activePass ? (
          <>
            <span style={styles.passLabel}>Pass {activePass.pass_number} — Active</span>
            <span style={styles.scanCount}>{scanCount} scans</span>
            <button style={styles.btnComplete} onClick={handleCompletePass}>Complete Pass</button>
          </>
        ) : (
          <>
            <span style={styles.muted}>No active pass</span>
            <button style={styles.btnPrimary} onClick={handleCreatePass}>
              Start Pass {passes.length + 1}
            </button>
          </>
        )}
        <button style={styles.btnSmall} onClick={fetchRoundData} title="Refresh">↻</button>
      </div>

      {/* Completed passes summary */}
      {passes.filter(p => p.status === 'complete').length > 0 && (
        <div style={styles.passHistory}>
          {passes.filter(p => p.status === 'complete').map(p => (
            <span key={p.id} style={styles.passPill}>
              Pass {p.pass_number}: {p.scan_count} scans
            </span>
          ))}
        </div>
      )}

      {/* Scanner → Box Assignment */}
      {round.race?.election_id && (
        <ScannerBoxAssignment electionId={round.race.election_id} />
      )}

      {/* Feedback */}
      {feedback && (
        <div style={{ ...styles.feedback, background: feedback.type === 'success' ? '#dcfce7' : '#fee2e2', color: feedback.type === 'success' ? '#166534' : '#dc2626' }} onClick={clearFeedback}>
          {feedback.message}
        </div>
      )}

      {/* Scan Area — only if pass is active */}
      {activePass && !scannedSN && (
        <div style={styles.scanArea}>
          {/* QR Scanner */}
          <div id="qr-reader" ref={scannerRef} style={styles.qrReader} />
          {!scanning && (
            <button style={styles.btnPrimary} onClick={startScanner}>Start Camera</button>
          )}
          {scanning && (
            <button style={styles.btnSmall} onClick={stopScanner}>Stop Camera</button>
          )}

          <div style={styles.dividerRow}>
            <hr style={{ flex: 1 }} />
            <span style={styles.muted}>or</span>
            <hr style={{ flex: 1 }} />
          </div>

          {/* Manual Entry */}
          <button style={styles.btnManual} onClick={() => setShowManual(!showManual)}>
            {showManual ? 'Cancel' : 'Manual Entry'}
          </button>
          {showManual && (
            <form onSubmit={handleManualSubmit} style={styles.manualForm}>
              <input
                style={styles.input}
                placeholder="Type serial number"
                value={manualSN}
                onChange={e => setManualSN(e.target.value.toUpperCase())}
                autoFocus
                minLength={8}
              />
              <button style={styles.btnPrimary} type="submit">Submit</button>
            </form>
          )}
        </div>
      )}

      {/* Candidate Selection — after SN scanned */}
      {activePass && scannedSN && (
        <div style={styles.voteArea}>
          <p style={styles.snDisplay}>SN: <strong>{scannedSN}</strong></p>
          <p style={styles.muted}>Select the candidate voted for:</p>

          {/* Ballot box selection */}
          {ballotBoxes.length > 0 && (
            <select style={styles.selectBox} value={selectedBox} onChange={e => setSelectedBox(e.target.value)}>
              <option value="">-- Ballot Box (optional) --</option>
              {ballotBoxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          <div style={styles.candidateList}>
            {candidates.map(c => (
              <button
                key={c.id}
                style={styles.candidateBtn}
                onClick={() => handleVote(c.id)}
                disabled={submitting}
              >
                {c.name}
              </button>
            ))}
          </div>

          <button style={styles.btnCancel} onClick={() => setScannedSN(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function ScannerBoxAssignment({ electionId }) {
  const [scanners, setScanners] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const fetchData = async () => {
    try {
      const [scRes, bxRes] = await Promise.all([
        api.get(`/admin/elections/${electionId}/scanners`),
        api.get(`/admin/elections/${electionId}/ballot-boxes`),
      ]);
      setScanners(scRes.data);
      setBoxes(bxRes.data);
    } catch {}
  };

  useEffect(() => { fetchData(); }, [electionId]);

  const handleAssign = async (scannerId, boxId) => {
    await api.put(`/admin/scanners/${scannerId}/assign-box`, { box_id: boxId || null });
    fetchData();
  };

  if (scanners.length === 0) return null;

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <button
        style={{ ...styles.btnSmall, width: '100%', textAlign: 'left', fontWeight: 600 }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾' : '▸'} Scanner → Box Assignment
      </button>
      {expanded && (
        <div style={{ padding: '0.5rem', background: '#f9fafb', borderRadius: '0 0 6px 6px', border: '1px solid #e5e7eb', borderTop: 'none' }}>
          {scanners.map(sc => (
            <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', minWidth: 80 }}>{sc.name}</span>
              <span style={styles.muted}>→</span>
              <select style={{ ...styles.input, flex: 1, padding: '0.35rem', fontSize: '0.85rem' }}
                value={sc.current_box_id || ''}
                onChange={e => handleAssign(sc.id, e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">No box</option>
                {boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 500, margin: '0 auto', padding: '0.75rem', fontFamily: 'system-ui, sans-serif' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  backLink: { color: '#2563eb', fontSize: '0.85rem', textDecoration: 'none' },
  passBar: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#f3f4f6', borderRadius: 8, marginBottom: '0.75rem' },
  passLabel: { fontWeight: 700, color: '#16a34a' },
  scanCount: { background: '#dbeafe', color: '#1e40af', padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.85rem' },
  passHistory: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
  passPill: { background: '#e5e7eb', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' },
  feedback: { padding: '0.75rem', borderRadius: 6, marginBottom: '0.75rem', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  scanArea: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' },
  qrReader: { width: '100%', maxWidth: 350 },
  dividerRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' },
  manualForm: { display: 'flex', gap: '0.5rem', width: '100%' },
  input: { flex: 1, padding: '0.6rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '1rem', fontFamily: 'monospace', textTransform: 'uppercase' },
  voteArea: { textAlign: 'center' },
  snDisplay: { fontSize: '1.2rem', fontFamily: 'monospace', margin: '0.5rem 0' },
  selectBox: { width: '100%', padding: '0.5rem', marginBottom: '0.75rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  candidateList: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' },
  candidateBtn: {
    padding: '1rem', fontSize: '1.1rem', fontWeight: 600,
    background: '#eff6ff', border: '2px solid #3b82f6', borderRadius: 8,
    cursor: 'pointer', transition: 'background 0.1s',
  },
  btnPrimary: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem' },
  btnComplete: { padding: '0.4rem 0.8rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', marginLeft: 'auto' },
  btnManual: { padding: '0.5rem 1rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.3rem 0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnCancel: { padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
