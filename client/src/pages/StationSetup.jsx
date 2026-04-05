import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function StationSetup() {
  const [step, setStep] = useState(1);
  const [stationId, setStationId] = useState(sessionStorage.getItem('stationId') || '');
  const [connected, setConnected] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activeRounds, setActiveRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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

  const handleNext = async () => {
    if (step === 1) {
      if (!stationId.trim()) { setError('Enter a station ID'); return; }
      sessionStorage.setItem('stationId', stationId);
      // Fetch active rounds
      try {
        const { data } = await api.get('/stations/active-rounds');
        setActiveRounds(data);
      } catch {
        setActiveRounds([]);
      }
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

        {/* Step 1: Connection + Station ID */}
        {step === 1 && (
          <div>
            <p style={s.subtitle}>Configure this scanning station</p>

            <div style={s.field}>
              <label style={s.label}>Station ID</label>
              <input style={s.input} placeholder="e.g. station-1"
                value={stationId} onChange={e => setStationId(e.target.value)} />
            </div>

            <div style={s.field}>
              <label style={s.label}>Server Connection</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button style={s.btnSecondary} onClick={handleTestConnection} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                {connected && <span style={s.successDot}>Connected</span>}
              </div>
            </div>

            {error && <p style={s.error}>{error}</p>}

            <button style={{ ...s.btnPrimary, marginTop: '1rem', opacity: !connected || !stationId.trim() ? 0.5 : 1 }}
              onClick={handleNext} disabled={!connected || !stationId.trim()}>
              Next
            </button>

            {/* Agent download */}
            <div style={s.downloadSection}>
              <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>Station Agent</h3>
              <p style={s.muted}>
                Download the scanning agent for this station. It watches a local folder and uploads ballot images to the server automatically.
              </p>
              <a
                href={`/api/stations/download-agent?stationId=${encodeURIComponent(stationId || 'station-1')}`}
                style={s.downloadBtn}
                download
              >
                Download Agent ZIP
              </a>
              <p style={{ ...s.muted, marginTop: '0.35rem', fontSize: '0.75rem' }}>
                The ZIP includes a pre-filled config.json with this server's address and station ID.
                Extract, run <code>npm install</code>, then <code>node station-agent.js</code>.
                Or run <code>node setup.js</code> for interactive setup.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Select Round */}
        {step === 2 && (
          <div>
            <p style={s.subtitle}>Select the race and round for this station</p>

            {activeRounds.length === 0 && (
              <div style={s.emptyState}>
                <p>No rounds are currently open for tallying.</p>
                <p style={s.muted}>A round must be moved to "tallying" status in the Control Center before it appears here.</p>
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
                  <span style={s.muted}> ({round.paper_color})</span>
                </div>
                <span style={s.muted}>{round.election_name}</span>
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
            <p style={s.muted}>{selectedRound.election_name}</p>

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
  card: { background: '#fff', borderRadius: 12, padding: '2.5rem', width: '100%', maxWidth: 480, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { margin: '0 0 0.25rem', textAlign: 'center', fontSize: '1.75rem' },
  subtitle: { color: '#666', textAlign: 'center', margin: '0 0 1.5rem', fontSize: '0.9rem' },
  field: { marginBottom: '1rem' },
  label: { fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' },
  input: { width: '100%', padding: '0.6rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '1rem', boxSizing: 'border-box' },
  btnPrimary: { width: '100%', padding: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnSecondary: { padding: '0.5rem 1rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnBack: { padding: '0.5rem 1rem', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.9rem', marginTop: '0.5rem' },
  successDot: { color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' },
  error: { color: '#dc2626', fontSize: '0.9rem', margin: '0.5rem 0' },
  muted: { color: '#666', fontSize: '0.85rem' },
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
  downloadSection: {
    marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb',
  },
  downloadBtn: {
    display: 'inline-block', padding: '0.5rem 1rem', background: '#16a34a', color: '#fff',
    borderRadius: 4, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600,
  },
};
