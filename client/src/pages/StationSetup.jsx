import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';

let stationCounter = 0;

export default function StationSetup() {
  const [step, setStep] = useState(1);
  const [stationId, setStationId] = useState(sessionStorage.getItem('stationId') || '');
  const [connected, setConnected] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activeRounds, setActiveRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const navigate = useNavigate();

  const fetchActiveRounds = async () => {
    try {
      const { data } = await api.get('/stations/active-rounds');
      setActiveRounds(data);
    } catch {
      setActiveRounds([]);
    }
  };

  // Auto-generate station ID on first visit
  useEffect(() => {
    if (!stationId) {
      stationCounter++;
      setStationId(`station-${stationCounter}`);
    }
    // Auto-test connection on load
    handleTestConnection();
    // Fetch rounds immediately so step 2 is ready
    fetchActiveRounds();
  }, []);

  // Listen for round status changes via WebSocket
  useEffect(() => {
    const socket = io();
    socket.on('status:changed', () => fetchActiveRounds());
    return () => socket.disconnect();
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setError(null);
    try {
      const { data } = await api.get('/health');
      if (data.status === 'ok') {
        setConnected(true);
      } else {
        setError('Server returned unexpected status');
      }
    } catch (err) {
      setError('Cannot reach server: ' + err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleDownloadInstaller = () => {
    const id = stationId.trim() || 'station-1';
    sessionStorage.setItem('stationId', id);
    window.location.href = `/api/stations/download-installer?stationId=${encodeURIComponent(id)}`;
    setDownloaded(true);
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!stationId.trim()) { setError('Enter a station ID'); return; }
      sessionStorage.setItem('stationId', stationId);
      await fetchActiveRounds();
      setStep(2);
    }
  };

  const handleSelectRound = async (round) => {
    setAssigning(true);
    setError(null);
    try {
      await api.post(`/stations/${stationId}/assign`, { roundId: round.round_id });
      setSelectedRound(round);
      sessionStorage.setItem('assignedRound', JSON.stringify(round));
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  const handleStartScanning = () => {
    navigate(`/scan/${selectedRound.round_id}`);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <h1 style={s.title}>Station Setup</h1>

        {/* Step 1: Download installer + Station ID */}
        {step === 1 && (
          <div>
            <p style={s.subtitle}>Set up this scanning station</p>

            {/* Station ID */}
            <div style={s.field}>
              <label style={s.label}>Station ID</label>
              <input style={s.input} placeholder="e.g. station-1"
                value={stationId} onChange={e => setStationId(e.target.value)} />
              <p style={s.hint}>A unique name for this scanning laptop</p>
            </div>

            {/* Connection status */}
            <div style={s.field}>
              <label style={s.label}>Server Connection</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {connected
                  ? <span style={s.successDot}>Connected</span>
                  : <button style={s.btnSecondary} onClick={handleTestConnection} disabled={testing}>
                      {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                }
              </div>
            </div>

            {error && <p style={s.error}>{error}</p>}

            {/* Big download section */}
            <div style={s.installerSection}>
              <h3 style={s.installerTitle}>1. Install the Station Agent</h3>
              <p style={s.installerDesc}>
                Download and run this file. It installs everything automatically —
                no other software needed.
              </p>
              <button
                style={{ ...s.downloadBtn, opacity: !stationId.trim() ? 0.5 : 1 }}
                onClick={handleDownloadInstaller}
                disabled={!stationId.trim()}
              >
                Download Station Installer
              </button>

              {downloaded && (
                <div style={s.downloadedSteps}>
                  <p style={s.stepsTitle}>After downloading:</p>
                  <ol style={s.stepsList}>
                    <li>Open your <strong>Downloads</strong> folder</li>
                    <li>Double-click <strong>BallotTrack-Station-Setup.bat</strong></li>
                    <li>Click <strong>Yes</strong> when asked for permission</li>
                    <li>Wait for it to finish — it will start automatically</li>
                  </ol>
                  <p style={s.hint}>
                    A desktop shortcut called "BallotTrack Station" will be created for future use.
                  </p>
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={s.divider}>
              <span style={s.dividerText}>or assign a round manually</span>
            </div>

            {/* Manual flow: assign to round via browser */}
            <h3 style={{ ...s.installerTitle, fontSize: '0.9rem' }}>2. Assign to a Round (optional)</h3>
            <p style={s.hint}>
              The station agent auto-assigns when there's one active round.
              Use this if you need to pick a specific round.
            </p>

            <button style={{ ...s.btnPrimary, marginTop: '0.75rem', opacity: !connected || !stationId.trim() ? 0.5 : 1 }}
              onClick={handleNext} disabled={!connected || !stationId.trim()}>
              Select Round Manually
            </button>
          </div>
        )}

        {/* Step 2: Select Round */}
        {step === 2 && (
          <div>
            <p style={s.subtitle}>Select the race and round for this station</p>

            {activeRounds.length === 0 && (
              <div style={s.emptyState}>
                <p>No rounds are currently open for tallying.</p>
                <p style={s.hint}>A round must be moved to "tallying" status in the Control Center before it appears here.</p>
              </div>
            )}

            {activeRounds.map(round => (
              <button
                key={round.round_id}
                style={s.roundOption}
                onClick={() => handleSelectRound(round)}
                disabled={assigning}
              >
                <div>
                  <strong>{round.race_name}</strong> — Round {round.round_number}
                  <span style={s.hint}> ({round.paper_color})</span>
                </div>
                <span style={s.hint}>{round.election_name}</span>
              </button>
            ))}

            {error && <p style={s.error}>{error}</p>}

            <button style={s.btnBack} onClick={() => setStep(1)}>&larr; Back</button>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && selectedRound && (
          <div style={{ textAlign: 'center' }}>
            <div style={s.checkmark}>&#10003;</div>
            <h2 style={{ margin: '0.5rem 0' }}>Station Ready</h2>
            <p style={s.assignmentText}>
              <strong>{selectedRound.race_name}</strong> — Round {selectedRound.round_number}
            </p>
            <p style={s.hint}>{selectedRound.election_name}</p>

            <button style={{ ...s.btnPrimary, marginTop: '1.5rem', fontSize: '1.1rem', padding: '0.75rem 2rem' }}
              onClick={handleStartScanning}>
              Start Scanning
            </button>

            <div style={{ marginTop: '1rem' }}>
              <button style={s.btnBack} onClick={() => setStep(2)}>Change Round</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', borderRadius: 12, padding: '2.5rem', width: '100%', maxWidth: 520, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { margin: '0 0 0.25rem', textAlign: 'center', fontSize: '1.75rem' },
  subtitle: { color: '#666', textAlign: 'center', margin: '0 0 1.5rem', fontSize: '0.9rem' },
  field: { marginBottom: '1rem' },
  label: { fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' },
  input: { width: '100%', padding: '0.6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '1rem', boxSizing: 'border-box' },
  hint: { color: '#666', fontSize: '0.8rem', margin: '0.25rem 0 0' },
  btnPrimary: { width: '100%', padding: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnSecondary: { padding: '0.5rem 1rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnBack: { padding: '0.5rem 1rem', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.9rem', marginTop: '0.5rem' },
  successDot: { color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' },
  error: { color: '#dc2626', fontSize: '0.9rem', margin: '0.5rem 0' },
  emptyState: { textAlign: 'center', padding: '2rem', background: '#f9fafb', borderRadius: 8, marginBottom: '1rem' },
  roundOption: {
    width: '100%', padding: '1rem', border: '2px solid #e5e7eb', borderRadius: 8, background: '#fff',
    cursor: 'pointer', textAlign: 'left', marginBottom: '0.5rem', fontSize: '0.95rem',
    transition: 'border-color 0.1s',
  },
  checkmark: {
    width: 80, height: 80, borderRadius: '50%', background: '#dcfce7', color: '#16a34a',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
    fontSize: '2.5rem', fontWeight: 700,
  },
  assignmentText: { fontSize: '1.2rem', margin: '0.5rem 0' },
  installerSection: {
    marginTop: '1.5rem', padding: '1.25rem', background: '#f0fdf4', border: '2px solid #bbf7d0',
    borderRadius: 10,
  },
  installerTitle: { margin: '0 0 0.35rem', fontSize: '1rem' },
  installerDesc: { color: '#444', fontSize: '0.85rem', margin: '0 0 0.75rem', lineHeight: 1.4 },
  downloadBtn: {
    display: 'block', width: '100%', padding: '0.85rem', background: '#16a34a', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
    textAlign: 'center',
  },
  downloadedSteps: {
    marginTop: '1rem', padding: '0.75rem', background: '#fff', borderRadius: 6,
    border: '1px solid #d1d5db',
  },
  stepsTitle: { margin: '0 0 0.35rem', fontWeight: 600, fontSize: '0.85rem' },
  stepsList: { margin: '0', paddingLeft: '1.25rem', fontSize: '0.85rem', lineHeight: 1.8, color: '#333' },
  divider: {
    display: 'flex', alignItems: 'center', margin: '1.5rem 0', gap: '0.75rem',
  },
  dividerText: {
    flex: '0 0 auto', color: '#999', fontSize: '0.8rem', whiteSpace: 'nowrap',
    background: '#fff', padding: '0 0.5rem',
  },
};

