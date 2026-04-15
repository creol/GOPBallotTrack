import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';
import AppHeader from '../components/AppHeader';

let stationCounter = 0;

export default function StationSetup() {
  const [stationId, setStationId] = useState(sessionStorage.getItem('stationId') || '');
  const [editingId, setEditingId] = useState(false);
  const [activeRounds, setActiveRounds] = useState([]);
  const [agentAlive, setAgentAlive] = useState(null); // null = checking, true/false
  const [assigning, setAssigning] = useState(null); // round_id being assigned
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const navigate = useNavigate();
  const idRef = useRef(null);

  // Initialize station ID
  useEffect(() => {
    if (!stationId) {
      stationCounter++;
      const id = `station-${stationCounter}`;
      setStationId(id);
      sessionStorage.setItem('stationId', id);
    }
  }, []);

  const fetchActiveRounds = async () => {
    try {
      const { data } = await api.get('/stations/active-rounds');
      setActiveRounds(data);
    } catch {
      setActiveRounds([]);
    }
  };

  const checkAgent = async () => {
    const id = sessionStorage.getItem('stationId');
    if (!id) { setAgentAlive(false); return; }
    try {
      const { data } = await api.get(`/stations/${id}/heartbeat`);
      setAgentAlive(data.alive);
    } catch {
      setAgentAlive(false);
    }
  };

  const checkConnection = async () => {
    try {
      const { data } = await api.get('/health');
      if (data.status === 'ok') setConnected(true);
    } catch {}
  };

  // Initial load + real-time updates
  useEffect(() => {
    checkConnection();
    fetchActiveRounds();
    checkAgent();

    const socket = io();
    socket.on('status:changed', () => fetchActiveRounds());
    // Instant agent detection via WebSocket — no polling needed
    socket.on('agent:heartbeat', (data) => {
      const id = sessionStorage.getItem('stationId');
      if (data.stationId === id) setAgentAlive(true);
    });

    // Fallback poll every 10s in case agent was already running before page loaded
    const agentTimer = setInterval(checkAgent, 10000);

    return () => {
      clearInterval(agentTimer);
      socket.disconnect();
    };
  }, []);

  const handleSaveId = () => {
    const id = stationId.trim();
    if (!id) return;
    sessionStorage.setItem('stationId', id);
    setEditingId(false);
    // Re-check agent with new ID
    checkAgent();
  };

  const handleSelectRound = async (round) => {
    const id = stationId.trim();
    if (!id) { setError('Set a station ID first'); return; }
    sessionStorage.setItem('stationId', id);
    setAssigning(round.round_id);
    setError(null);
    try {
      await api.post(`/stations/${id}/assign`, { roundId: round.round_id });
      sessionStorage.setItem('assignedRound', JSON.stringify(round));
      navigate(`/scan/${round.round_id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign round');
    } finally {
      setAssigning(null);
    }
  };

  const handleDownloadInstaller = () => {
    const id = stationId.trim() || 'station-1';
    sessionStorage.setItem('stationId', id);
    window.location.href = `/api/stations/download-installer?stationId=${encodeURIComponent(id)}`;
  };

  return (
    <div style={s.outerWrapper}>
      <div style={s.headerBar}><AppHeader title="Station Setup" /></div>
      <div style={s.wrapper}>
        <div style={s.card}>
          <h1 style={s.title}>Station Setup</h1>

          {/* Station ID - compact inline display */}
          <div style={s.idRow}>
            <span style={s.idLabel}>Station:</span>
            {editingId ? (
              <div style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
                <input
                  ref={idRef}
                  style={s.idInput}
                  value={stationId}
                  onChange={e => setStationId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveId()}
                  autoFocus
                />
                <button style={s.btnSmall} onClick={handleSaveId}>Save</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={s.idValue}>{stationId}</span>
                <button style={s.btnLink} onClick={() => setEditingId(true)}>change</button>
              </div>
            )}
          </div>

          {/* Agent Status Banner */}
          {agentAlive === null && (
            <div style={s.bannerChecking}>
              Checking for scanning agent...
            </div>
          )}
          {agentAlive === true && (
            <div style={s.bannerGood}>
              Scanning agent is running
            </div>
          )}
          {agentAlive === false && (
            <div style={s.bannerWarning}>
              <strong>Scanning agent is not running</strong>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
                Double-click the <strong>BallotTrack Station</strong> shortcut on the desktop to start it.
              </p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                If there is no shortcut, <button style={s.btnInlineLink} onClick={handleDownloadInstaller}>download the installer</button> first.
              </p>
            </div>
          )}

          {/* Connection status (only show if disconnected) */}
          {!connected && (
            <div style={s.bannerWarning}>
              Cannot reach server — check your network connection.
            </div>
          )}

          {error && <div style={s.bannerError}>{error}</div>}

          {/* Active Rounds */}
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Select a Round to Scan</h2>

            {activeRounds.length === 0 ? (
              <div style={s.emptyState}>
                <p style={{ margin: 0, fontWeight: 500 }}>No rounds are open for scanning yet.</p>
                <p style={s.hint}>
                  Rounds will appear here automatically when opened in the Control Center.
                </p>
              </div>
            ) : (
              <div style={s.roundList}>
                {activeRounds.map(round => (
                  <button
                    key={round.round_id}
                    style={s.roundCard}
                    onClick={() => handleSelectRound(round)}
                    disabled={assigning === round.round_id}
                  >
                    <div style={s.roundMain}>
                      <span style={s.roundRace}>{round.race_name}</span>
                      <span style={s.roundDetail}>
                        Round {round.round_number} &middot; {round.paper_color}
                      </span>
                    </div>
                    <div style={s.roundElection}>{round.election_name}</div>
                    <div style={s.roundArrow}>
                      {assigning === round.round_id ? 'Assigning...' : 'Start \u2192'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  outerWrapper: { minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' },
  headerBar: { maxWidth: 520, margin: '0 auto', padding: '1rem 1rem 0' },
  wrapper: { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', minHeight: 'calc(100vh - 60px)', paddingTop: '2rem' },
  card: { background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 520, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { margin: '0 0 1rem', textAlign: 'center', fontSize: '1.5rem' },

  // Station ID row
  idRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', padding: '0.6rem 0.75rem', background: '#f9fafb', borderRadius: 8 },
  idLabel: { fontWeight: 600, fontSize: '0.9rem', color: '#374151' },
  idValue: { fontSize: '0.95rem', fontWeight: 500 },
  idInput: { flex: 1, padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.9rem' },
  btnSmall: { padding: '0.35rem 0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 },
  btnLink: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline' },
  btnInlineLink: { background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline', fontWeight: 600 },

  // Banners
  bannerChecking: { padding: '0.6rem 0.75rem', background: '#dbeafe', color: '#1e40af', borderRadius: 8, fontSize: '0.85rem', marginBottom: '0.75rem', fontWeight: 500 },
  bannerGood: { padding: '0.6rem 0.75rem', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: '0.85rem', marginBottom: '0.75rem', fontWeight: 600 },
  bannerWarning: { padding: '0.75rem', background: '#fef3c7', color: '#78350f', borderRadius: 8, fontSize: '0.9rem', marginBottom: '0.75rem', lineHeight: 1.4 },
  bannerError: { padding: '0.6rem 0.75rem', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: '0.85rem', marginBottom: '0.75rem', fontWeight: 600 },

  // Rounds section
  section: { marginTop: '0.5rem' },
  sectionTitle: { margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: 600 },
  hint: { color: '#666', fontSize: '0.8rem', margin: '0.35rem 0 0' },
  emptyState: { textAlign: 'center', padding: '1.5rem', background: '#f9fafb', borderRadius: 8 },
  roundList: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  roundCard: {
    width: '100%', padding: '1rem', border: '2px solid #e5e7eb', borderRadius: 10, background: '#fff',
    cursor: 'pointer', textAlign: 'left', fontSize: '0.95rem', display: 'flex', alignItems: 'center',
    gap: '0.75rem', transition: 'border-color 0.15s, background 0.15s',
  },
  roundMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  roundRace: { fontWeight: 700, fontSize: '1rem' },
  roundDetail: { fontSize: '0.85rem', color: '#666' },
  roundElection: { fontSize: '0.8rem', color: '#9ca3af', maxWidth: '8rem', textAlign: 'right' },
  roundArrow: { fontSize: '0.9rem', fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' },
};
