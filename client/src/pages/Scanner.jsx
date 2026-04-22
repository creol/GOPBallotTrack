import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api/client';
import AppHeader from '../components/AppHeader';
import { APP_VERSION } from '../version';
import { useAuth } from '../context/AuthContext';

export default function Scanner() {
  const { roundId } = useParams();
  const { auth } = useAuth();
  const isSuperAdmin = auth?.role === 'super_admin';
  const [round, setRound] = useState(null);
  const [passes, setPasses] = useState([]);
  const [activePass, setActivePass] = useState(null);
  const [totalUploads, setTotalUploads] = useState(0);
  const [localUploads, setLocalUploads] = useState(0);

  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', message }
  const [agentAlive, setAgentAlive] = useState(null); // null = checking, true/false
  const [agentVersion, setAgentVersion] = useState(null);
  const [agentCountdown, setAgentCountdown] = useState(10); // seconds to wait before showing warning

  const fetchRoundData = useCallback(async () => {
    try {
      // Use non-admin endpoints for scanner data (tally operators have no auth)
      const { data: roundData } = await api.get(`/rounds/${roundId}/detail`);
      setRound(roundData);
    } catch (err) {
      console.error('Failed to fetch round data:', err);
    }

    try {
      const { data: passData } = await api.get(`/rounds/${roundId}/passes`);
      const passList = Array.isArray(passData) ? passData : [];
      setPasses(passList);
      const active = passList.find(p => p.status === 'active');
      setActivePass(active || null);
    } catch (err) {
      console.error('Failed to fetch passes:', err);
    }

    // Station-scoped upload counts — "anything the agent uploaded" regardless of outcome.
    // Bucket by the displayed pass (active if any, else latest) for the Total/Local pills.
    try {
      const { data: counts } = await api.get(`/rounds/${roundId}/station-counts`);
      const rows = Array.isArray(counts) ? counts : [];
      const displayedPass = rows.reduce((acc, r) => {
        if (r.pass_status === 'active') return r.pass_id;
        if (acc == null) return r.pass_id;
        return acc;
      }, null);
      const stationId = sessionStorage.getItem('stationId');
      let total = 0;
      let local = 0;
      rows.forEach(r => {
        if (r.pass_id !== displayedPass) return;
        total += r.uploads || 0;
        if (stationId && r.station_id === stationId) local += r.uploads || 0;
      });
      setTotalUploads(total);
      setLocalUploads(local);
    } catch (err) {
      console.error('Failed to fetch station counts:', err);
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

  // Poll agent heartbeat — initial countdown grace period, then periodic checks
  useEffect(() => {
    const stationId = sessionStorage.getItem('stationId');
    if (!stationId) { setAgentAlive(false); setAgentCountdown(0); return; }

    let countdownTimer = null;
    let pollTimer = null;
    let resolved = false;

    const checkHeartbeat = async () => {
      try {
        const { data } = await api.get(`/stations/${stationId}/heartbeat`);
        setAgentAlive(data.alive);
        if (data.agentVersion) setAgentVersion(data.agentVersion);
        if (data.alive) { resolved = true; setAgentCountdown(0); }
        return data.alive;
      } catch {
        setAgentAlive(false);
        return false;
      }
    };

    // Check immediately
    checkHeartbeat();

    // Countdown timer — ticks every second during initial grace period
    countdownTimer = setInterval(() => {
      setAgentCountdown(prev => {
        if (prev <= 1 || resolved) {
          clearInterval(countdownTimer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll every 5 seconds during countdown, then every 10 seconds after
    pollTimer = setInterval(checkHeartbeat, 5000);

    return () => {
      clearInterval(countdownTimer);
      clearInterval(pollTimer);
    };
  }, []);

  const handleCreatePass = async () => {
    try {
      const { data } = await api.post(`/rounds/${roundId}/passes`);
      setActivePass(data);
      setScanCount(0);
      fetchRoundData();
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to create pass' });
    }
  };

  const handleCompletePass = async () => {
    if (!activePass) return;
    if (!confirm(`Complete Pass ${activePass.pass_number}? You can reopen it later if needed.`)) return;
    try {
      await api.put(`/passes/${activePass.id}/complete`);
      setActivePass(null);
      fetchRoundData();
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to complete pass' });
    }
  };

  const handleReopenPass = async (passId, passNumber) => {
    const reason = prompt(`Why are you reopening Pass ${passNumber}?`);
    if (!reason || !reason.trim()) return;
    try {
      await api.put(`/passes/${passId}/reopen`, { reason });
      fetchRoundData();
      setFeedback({ type: 'success', message: `Pass ${passNumber} reopened` });
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to reopen pass' });
    }
  };

  const handleDeletePass = async (passId, passNumber) => {
    const reason = prompt(`Why are you deleting Pass ${passNumber}? This will reset all scanned ballots to unused.`);
    if (!reason || !reason.trim()) return;
    const pin = prompt('Enter your PIN to confirm deletion:');
    if (!pin) return;
    try {
      await api.delete(`/passes/${passId}`, { data: { deleted_reason: reason, confirm_pin: pin } });
      fetchRoundData();
      setFeedback({ type: 'success', message: `Pass ${passNumber} deleted` });
    } catch (err) {
      setFeedback({ type: 'error', message: err.response?.data?.error || 'Failed to delete pass' });
    }
  };

  const clearFeedback = () => {
    setFeedback(null);
  };

  if (!round) return <div style={styles.container}><p>Loading...</p></div>;

  return (
    <div style={styles.container}>
      <AppHeader title="Scanner" />

      {/* Large centered race/round header */}
      <div style={{
        background: '#1e3a5f', color: '#fff', borderRadius: 8,
        padding: '1.1rem 1.5rem', marginBottom: '0.5rem',
        textAlign: 'center', fontSize: '1.5rem', fontWeight: 800,
        letterSpacing: '0.02em', lineHeight: 1.3,
      }}>
        Scanning for: {round.race?.name || 'Race'} — Round {round.round_number} ({round.paper_color})
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center', marginBottom: '0.5rem' }}>
        <Link to="/station-setup" style={styles.backLink}>Round Selection</Link>
        {agentAlive === true && (
          <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
            ● Agent Connected{agentVersion ? ` (v${agentVersion})` : ''}
          </span>
        )}
      </div>

      {/* Agent status: countdown → connected → warning */}
      {agentCountdown > 0 && agentAlive !== true && (
        <div style={{
          background: '#eff6ff', color: '#1e40af', borderRadius: 8,
          padding: '0.75rem 1.25rem', marginBottom: '0.75rem',
          border: '1px solid #93c5fd', textAlign: 'center',
          fontSize: '0.95rem', fontWeight: 600,
        }}>
          Checking scan agent status... ({agentCountdown}s)
        </div>
      )}

      {agentAlive === true && agentCountdown === 0 && (() => {
        const versionMismatch = agentVersion && agentVersion !== APP_VERSION;
        return (
          <div style={{
            background: versionMismatch ? '#fef3c7' : '#f0fdf4',
            color: versionMismatch ? '#92400e' : '#166534',
            borderRadius: 8,
            padding: '0.6rem 1.25rem', marginBottom: '0.75rem',
            border: `1px solid ${versionMismatch ? '#f59e0b' : '#86efac'}`,
            textAlign: 'center',
            fontSize: '0.95rem', fontWeight: 600,
          }}>
            {versionMismatch
              ? `Agent Connected (v${agentVersion}) — updating to v${APP_VERSION}, will restart automatically...`
              : `Scan Agent Connected — v${agentVersion || APP_VERSION}`
            }
          </div>
        );
      })()}

      {agentAlive === false && agentCountdown === 0 && (
        <div style={{
          background: '#dc2626', color: '#fff', borderRadius: 8,
          padding: '1rem 1.25rem', marginBottom: '0.75rem',
          border: '2px solid #991b1b',
        }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            WARNING: Scan Agent Not Detected
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
            The scanning agent is not running on this station. Ballots placed in the scanner will NOT be processed.
          </p>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
            To start: <strong>Double-click the "BallotTrack Scanner" shortcut on the Desktop.</strong>
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.9 }}>
            No shortcut?{' '}
            <Link to="/station-setup" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 600 }}>
              Go to Scanning Station
            </Link>{' '}
            to download and install the agent.
          </p>
        </div>
      )}

      {/* Pass Controls — only Super Admin can manage passes */}
      <div style={styles.passBar}>
        {activePass ? (
          <>
            <span style={styles.passLabel}>Pass {activePass.pass_number} — Active</span>
            <span style={styles.scanCount} title="Total uploads across all stations for this pass">
              Total: {totalUploads}
            </span>
            <span style={styles.localCount} title="Uploads from this station for this pass">
              Local: {localUploads}
            </span>
            {isSuperAdmin && (
              <button style={styles.btnComplete} onClick={handleCompletePass}>Complete Pass</button>
            )}
          </>
        ) : (
          <>
            <span style={styles.muted}>No active pass</span>
            {isSuperAdmin ? (
              <button style={styles.btnPrimary} onClick={handleCreatePass}>
                Start Pass {passes.length + 1}
              </button>
            ) : (
              <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Waiting for admin to start a pass...</span>
            )}
          </>
        )}
        <button style={styles.btnSmall} onClick={fetchRoundData} title="Refresh">↻</button>
      </div>

      {/* Completed passes summary with reopen/delete for super admin */}
      {passes.filter(p => p.status === 'complete').length > 0 && (
        <div style={styles.passHistory}>
          {passes.filter(p => p.status === 'complete').map(p => (
            <span key={p.id} style={{ ...styles.passPill, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              Pass {p.pass_number}: {p.upload_count ?? p.scan_count} scans
              {isSuperAdmin && (
                <>
                  <button
                    style={{ ...styles.btnSmall, padding: '1px 5px', fontSize: '0.7rem', background: '#dbeafe', color: '#1e40af' }}
                    onClick={() => handleReopenPass(p.id, p.pass_number)}
                    title="Reopen this pass for additional scanning"
                  >Reopen</button>
                  <button
                    style={{ ...styles.btnSmall, padding: '1px 5px', fontSize: '0.7rem', background: '#fee2e2', color: '#dc2626' }}
                    onClick={() => handleDeletePass(p.id, p.pass_number)}
                    title="Delete this pass and reset ballots"
                  >Delete</button>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div style={{ ...styles.feedback, background: feedback.type === 'success' ? '#dcfce7' : '#fee2e2', color: feedback.type === 'success' ? '#166534' : '#dc2626' }} onClick={clearFeedback}>
          {feedback.message}
        </div>
      )}

    </div>
  );
}

const styles = {
  container: { maxWidth: 500, margin: '0 auto', padding: '0.75rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', fontSize: '0.85rem', textDecoration: 'none' },
  passBar: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#f3f4f6', borderRadius: 8, marginBottom: '0.75rem' },
  passLabel: { fontWeight: 700, color: '#16a34a' },
  scanCount: { background: '#dbeafe', color: '#1e40af', padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.85rem' },
  localCount: { background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.85rem' },
  passHistory: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
  passPill: { background: '#e5e7eb', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' },
  feedback: { padding: '0.75rem', borderRadius: 6, marginBottom: '0.75rem', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  btnPrimary: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem' },
  btnComplete: { padding: '0.4rem 0.8rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', marginLeft: 'auto' },
  btnSmall: { padding: '0.3rem 0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
