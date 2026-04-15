import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import { toInputDate, formatDate, formatTime12 } from '../utils/dateFormat';

const NAV_ITEMS = [
  { key: 'rounds', label: 'Rounds' },
  { key: 'candidates', label: 'Candidates' },
];

export default function RaceDetail() {
  const { id: electionId, raceId } = useParams();
  const [electionName, setElectionName] = useState('');
  const [race, setRace] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [candidateName, setCandidateName] = useState('');
  const [paperColor, setPaperColor] = useState('');
  const [editing, setEditing] = useState(false);
  const [raceForm, setRaceForm] = useState({ name: '', race_date: '', race_time: '', location: '' });
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [editCandidateName, setEditCandidateName] = useState('');
  const [showRegenWarning, setShowRegenWarning] = useState(false);
  const [editingRoundColor, setEditingRoundColor] = useState(null); // round id being edited
  const [editRoundColorValue, setEditRoundColorValue] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState(null);
  const [withdrawPin, setWithdrawPin] = useState('');
  const [withdrawError, setWithdrawError] = useState(null);
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState(searchParams.get('tab') || 'rounds');
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const fetchAll = async () => {
    const { data: election } = await api.get(`/admin/elections/${electionId}`);
    setElectionName(election.name || '');
    const found = election.races?.find(r => r.id === parseInt(raceId));
    if (found) {
      setRace(found);
      setRaceForm({
        name: found.name,
        race_date: toInputDate(found.race_date),
        race_time: found.race_time || '',
        location: found.location || '',
      });
    }

    try {
      const { data } = await api.get(`/admin/races/${raceId}/candidates`);
      setCandidates(data);
    } catch {
      setCandidates([]);
    }

    try {
      const { data } = await api.get(`/admin/races/${raceId}/rounds`);
      setRounds(data);
    } catch {
      setRounds([]);
    }
  };

  useEffect(() => { fetchAll(); }, [electionId, raceId]);

  const handleAddCandidate = async (e) => {
    e.preventDefault();
    if (!candidateName.trim()) return;
    await api.post(`/admin/races/${raceId}/candidates`, { name: candidateName });
    setCandidateName('');
    fetchAll();
  };

  const handleRenameCandidate = async (candidateId) => {
    if (!editCandidateName.trim()) return;
    await api.put(`/admin/candidates/${candidateId}`, { name: editCandidateName.trim() });
    setEditingCandidate(null);
    setEditCandidateName('');
    setShowRegenWarning(true);
    fetchAll();
  };

  const handleWithdraw = async () => {
    if (!withdrawPin) { setWithdrawError('PIN is required'); return; }
    try {
      // Verify PIN first
      await api.post('/auth/login', { role: 'admin', pin: withdrawPin });
      await api.put(`/admin/candidates/${withdrawTarget.id}/withdraw`);
      setWithdrawTarget(null);
      setWithdrawPin('');
      setWithdrawError(null);
      fetchAll();
    } catch (err) {
      setWithdrawError(err.response?.data?.error || 'Invalid PIN');
    }
  };

  const handleCreateRound = async (e) => {
    e.preventDefault();
    if (!paperColor.trim()) return;
    await api.post(`/admin/races/${raceId}/rounds`, { paper_color: paperColor });
    setPaperColor('');
    fetchAll();
  };

  const handleUpdateRoundColor = async (roundId) => {
    if (!editRoundColorValue.trim()) return;
    await api.put(`/admin/rounds/${roundId}`, { paper_color: editRoundColorValue.trim() });
    setEditingRoundColor(null);
    fetchAll();
  };

  const handleUpdateRace = async (e) => {
    e.preventDefault();
    await api.put(`/admin/races/${raceId}`, {
      name: raceForm.name,
      race_date: raceForm.race_date || null,
      race_time: raceForm.race_time || null,
      location: raceForm.location || null,
    });
    setEditing(false);
    fetchAll();
  };

  const handleDragStart = (index) => { dragItem.current = index; };
  const handleDragEnter = (index) => { dragOver.current = index; };

  const handleDragEnd = async () => {
    const items = [...candidates];
    const draggedItem = items[dragItem.current];
    items.splice(dragItem.current, 1);
    items.splice(dragOver.current, 0, draggedItem);
    dragItem.current = null;
    dragOver.current = null;
    setCandidates(items);

    await api.put(`/admin/races/${raceId}/candidates/reorder`, {
      candidate_ids: items.map(c => c.id),
    });
  };

  if (!race) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', voting_open: '#3b82f6', voting_closed: '#8b5cf6', tallying: '#f59e0b', round_finalized: '#6366f1', canceled: '#6b7280' };
  const statusLabel = { ready: 'Ready', voting_open: 'Voting Open', voting_closed: 'Voting Closed', tallying: 'Tallying', round_finalized: 'Finalized', canceled: 'Canceled' };

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: electionName || 'Election', to: `/admin/elections/${electionId}` },
      { label: race.name },
    ]}>
      {editing ? (
        <form onSubmit={handleUpdateRace} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 400 }}>
          <input style={styles.input} placeholder="Race Name" value={raceForm.name} onChange={e => setRaceForm({ ...raceForm, name: e.target.value })} required />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input style={{ ...styles.input, flex: 1 }} type="date" value={raceForm.race_date} onChange={e => setRaceForm({ ...raceForm, race_date: e.target.value })} />
            <input style={{ ...styles.input, flex: 1 }} type="time" value={raceForm.race_time} onChange={e => setRaceForm({ ...raceForm, race_time: e.target.value })} />
          </div>
          <input style={styles.input} placeholder="Location (optional)" value={raceForm.location} onChange={e => setRaceForm({ ...raceForm, location: e.target.value })} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button style={styles.btnPrimary} type="submit">Save</button>
            <button style={styles.btnSmall} type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div style={styles.header}>
          <div>
            <h1>{race.name}</h1>
            <p style={styles.muted}>
              {race.ballot_count && <>{race.ballot_count} ballots per round</>}
              {race.ballot_count && race.max_rounds && <> &nbsp;|&nbsp; </>}
              {race.max_rounds && <>{race.max_rounds} max rounds</>}
            </p>
            {(race.race_date || race.race_time || race.location) && (
              <p style={styles.muted}>
                {race.race_date && formatDate(race.race_date)}
                {race.race_time && <> at {formatTime12(race.race_time)}</>}
                {race.location && <> — {race.location}</>}
              </p>
            )}
          </div>
          <button style={styles.btnSmall} onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}

      {/* Public Ballot Visibility Settings */}
      <div style={styles.ballotVisibilitySection}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151' }}>Public Ballot Visibility</span>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={race.public_search_enabled !== false}
            onChange={async (e) => {
              await api.put(`/admin/races/${raceId}`, { public_search_enabled: e.target.checked });
              fetchAll();
            }}
          />
          Allow search by serial number
        </label>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={race.public_browse_enabled === true}
            onChange={async (e) => {
              await api.put(`/admin/races/${raceId}`, { public_browse_enabled: e.target.checked });
              fetchAll();
            }}
          />
          Allow scrolling through all ballots
        </label>
      </div>

      {/* Tab switching for Rounds/Candidates */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            style={{
              padding: '0.4rem 0.75rem', border: 'none', borderBottom: activeSection === item.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: activeSection === item.key ? 600 : 400,
              color: activeSection === item.key ? '#2563eb' : '#6b7280',
            }}
            onClick={() => setActiveSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div>
          {activeSection === 'candidates' && (
            <div>
              <h2>Candidates</h2>
              <p style={styles.muted}>Drag to reorder</p>

              {showRegenWarning && (
                <div style={styles.regenWarning}>
                  Candidate name updated. Please regenerate ballot PDFs for any rounds that have already been generated.
                  <button style={{ ...styles.btnSmall, marginLeft: '0.5rem' }} onClick={() => setShowRegenWarning(false)}>Dismiss</button>
                </div>
              )}

              {candidates.map((c, index) => (
                <div
                  key={c.id}
                  draggable={editingCandidate !== c.id}
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => e.preventDefault()}
                  style={styles.candidateRow}
                >
                  <span style={styles.dragHandle}>⠿</span>
                  {editingCandidate === c.id ? (
                    <form onSubmit={e => { e.preventDefault(); handleRenameCandidate(c.id); }} style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                      <input
                        style={{ ...styles.input, flex: 1 }}
                        value={editCandidateName}
                        onChange={e => setEditCandidateName(e.target.value)}
                        autoFocus
                      />
                      <button style={styles.btnPrimary} type="submit">Save</button>
                      <button style={styles.btnSmall} type="button" onClick={() => setEditingCandidate(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span style={{ flex: 1, textDecoration: c.status === 'withdrawn' ? 'line-through' : 'none' }}>
                        {c.name}
                      </span>
                      <button style={styles.btnSmall} onClick={() => { setEditingCandidate(c.id); setEditCandidateName(c.name); }}>Edit</button>
                      {c.status === 'withdrawn' ? (
                        <span style={styles.withdrawnBadge}>Withdrawn</span>
                      ) : (
                        <button style={styles.btnDanger} onClick={() => { setWithdrawTarget(c); setWithdrawPin(''); setWithdrawError(null); }}>Withdraw</button>
                      )}
                    </>
                  )}
                </div>
              ))}

              <form onSubmit={handleAddCandidate} style={{ ...styles.form, marginTop: '0.5rem' }}>
                <input
                  style={styles.input}
                  placeholder="Candidate Name"
                  value={candidateName}
                  onChange={e => setCandidateName(e.target.value)}
                />
                <button style={styles.btnPrimary} type="submit">Add Candidate</button>
              </form>
            </div>
          )}

          {activeSection === 'rounds' && (
            <div>
              <h2>Rounds</h2>
              {race.ballot_count && (
                <p style={styles.muted}>
                  {race.ballot_count} ballots per round — serial numbers are generated automatically when rounds are created.
                </p>
              )}

              {rounds.length === 0 && <p style={styles.muted}>No rounds yet.</p>}
              {rounds.map(round => (
                <div key={round.id} style={styles.roundCard}>
                  <Link
                    to={`/admin/elections/${electionId}/races/${raceId}/rounds/${round.id}`}
                    style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}
                  >
                    Round {round.round_number}
                  </Link>
                  {editingRoundColor === round.id ? (
                    <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }} onClick={e => e.preventDefault()}>
                      <input
                        style={{ ...styles.input, width: 120, padding: '0.25rem 0.4rem', fontSize: '0.82rem' }}
                        value={editRoundColorValue}
                        onChange={e => setEditRoundColorValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleUpdateRoundColor(round.id);
                          if (e.key === 'Escape') setEditingRoundColor(null);
                        }}
                        autoFocus
                      />
                      <button style={styles.btnSmall} onClick={() => handleUpdateRoundColor(round.id)}>Save</button>
                      <button style={styles.btnSmall} onClick={() => setEditingRoundColor(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span
                      style={{ ...styles.muted, cursor: 'pointer', borderBottom: '1px dashed #999' }}
                      title="Click to edit paper color"
                      onClick={e => {
                        e.preventDefault();
                        setEditingRoundColor(round.id);
                        setEditRoundColorValue(round.paper_color || '');
                      }}
                    >
                      Paper: {round.paper_color || '(none)'}
                    </span>
                  )}
                  {statusLabel[round.status] && (
                    <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
                      {statusLabel[round.status]}
                    </span>
                  )}
                  {!round.ballot_pdf_generated_at && round.status !== 'canceled' && (
                    <span style={styles.noBallotsBadge}>Ballots not generated</span>
                  )}
                </div>
              ))}

              <h3 style={{ marginTop: '1rem', fontSize: '0.95rem' }}>Add Additional Round</h3>
              <p style={styles.muted}>
                {race.ballot_count
                  ? `${race.ballot_count} serial numbers will be generated automatically.`
                  : 'Set ballot count on the race to auto-generate serial numbers.'}
              </p>
              <form onSubmit={handleCreateRound} style={{ ...styles.form, marginTop: '0.25rem' }}>
                <input
                  style={styles.input}
                  placeholder="Paper Color (e.g. White, Blue)"
                  value={paperColor}
                  onChange={e => setPaperColor(e.target.value)}
                />
                <button style={styles.btnPrimary} type="submit">Add Round</button>
              </form>
            </div>
          )}
      </div>

      {/* Withdraw Confirmation Modal */}
      {withdrawTarget && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3 style={{ margin: '0 0 0.5rem', color: '#dc2626' }}>Withdraw Candidate</h3>
            <p style={{ margin: '0 0 1rem', color: '#374151', lineHeight: 1.5 }}>
              You are about to withdraw <strong>{withdrawTarget.name}</strong>.
              This action <strong>cannot be undone</strong>. The candidate will be
              marked as withdrawn and will not appear on future ballots.
            </p>
            <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
              Enter your Admin PIN to confirm
            </label>
            <input
              style={styles.input}
              type="password"
              placeholder="Admin PIN"
              value={withdrawPin}
              onChange={e => { setWithdrawPin(e.target.value); setWithdrawError(null); }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleWithdraw(); }}
            />
            {withdrawError && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{withdrawError}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button style={styles.btnDanger} onClick={handleWithdraw}>Withdraw Candidate</button>
              <button style={styles.btnSmall} onClick={() => setWithdrawTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </ElectionLayout>
  );
}

const styles = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },

  // Sidebar layout
  layout: { display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1.5rem' },
  sidebar: {
    width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px',
    borderRight: '1px solid #e5e7eb', paddingRight: '1rem',
  },
  navItem: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.6rem 0.75rem', background: 'none', border: 'none', borderLeft: '3px solid transparent',
    cursor: 'pointer', fontSize: '0.9rem', color: '#4b5563', borderRadius: '0 4px 4px 0',
  },
  navItemActive: {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.6rem 0.75rem', background: '#eff6ff', border: 'none', borderLeft: '3px solid #2563eb',
    cursor: 'pointer', fontSize: '0.9rem', color: '#1d4ed8', fontWeight: 600, borderRadius: '0 4px 4px 0',
  },
  content: { flex: 1, minWidth: 0 },

  // Mobile nav
  mobileNav: {
    display: 'none', overflowX: 'auto', gap: '0.25rem', padding: '0.25rem 0',
    borderBottom: '1px solid #e5e7eb', marginBottom: '1rem',
  },
  mobileTab: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid transparent',
    cursor: 'pointer', fontSize: '0.82rem', color: '#6b7280', whiteSpace: 'nowrap',
  },
  mobileTabActive: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid #2563eb',
    cursor: 'pointer', fontSize: '0.82rem', color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap',
  },

  candidateRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
    border: '1px solid #ddd', borderRadius: 6, marginBottom: '0.25rem',
    background: '#fafafa', cursor: 'grab',
  },
  dragHandle: { color: '#999', fontSize: '1.2rem', cursor: 'grab' },
  withdrawnBadge: { background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  regenWarning: {
    background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6, padding: '0.75rem',
    marginBottom: '0.75rem', color: '#92400e', fontSize: '0.9rem', fontWeight: 600,
    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
  },
  roundCard: {
    display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem',
    border: '1px solid #ddd', borderRadius: 6, marginBottom: '0.5rem', background: '#fafafa',
    textDecoration: 'none', color: 'inherit',
  },
  statusBadge: { color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  noBallotsBadge: { background: '#fef3c7', color: '#92400e', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
  ballotVisibilitySection: {
    display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap',
    padding: '0.5rem 0.75rem', background: '#f9fafb', border: '1px solid #e5e7eb',
    borderRadius: 6, marginBottom: '1rem', fontSize: '0.85rem',
  },
  toggleLabel: {
    display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
    fontSize: '0.85rem', color: '#4b5563',
  },
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modalCard: {
    background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 420,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
};

// Inject responsive CSS for race detail sidebar
if (typeof document !== 'undefined') {
  const id = 'race-detail-responsive';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = `
      @media (max-width: 768px) {
        [data-race-sidebar] { display: none !important; }
        [data-race-mobilenav] { display: flex !important; }
        [data-race-layout] { flex-direction: column !important; }
      }
      @media (min-width: 769px) {
        [data-race-mobilenav] { display: none !important; }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
