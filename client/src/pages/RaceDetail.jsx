import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import SuperAdminPinModal from '../components/SuperAdminPinModal';
import { useAuth } from '../context/AuthContext';
import { toInputDate, formatDate, formatTime12 } from '../utils/dateFormat';

const NAV_ITEMS = [
  { key: 'rounds', label: 'Rounds' },
  { key: 'candidates', label: 'Candidates' },
];

export default function RaceDetail() {
  const { id: electionId, raceId } = useParams();
  const { auth } = useAuth();
  const isSuperAdmin = auth?.role === 'super_admin';
  const [electionName, setElectionName] = useState('');
  const [race, setRace] = useState(null);
  const [raceActionBusy, setRaceActionBusy] = useState(false);
  const [racePinModal, setRacePinModal] = useState(null);
  const [raceActionError, setRaceActionError] = useState(null);
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
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDesignations, setSummaryDesignations] = useState({});
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryDecidingTotals, setSummaryDecidingTotals] = useState({});
  // Ballot-spec recovery modal state ("Fix scan zones from PDF")
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryFile, setRecoveryFile] = useState(null);
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [recoveryOverride, setRecoveryOverride] = useState('');
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

  const openSummaryModal = async () => {
    const designations = {};
    candidates.forEach(c => { designations[c.id] = c.final_designation || ''; });
    setSummaryDesignations(designations);
    setSummaryError(null);

    // Fetch the deciding round's vote totals to display next to each candidate.
    let totals = {};
    try {
      const finalized = rounds.filter(r => r.status === 'round_finalized');
      const target = finalized.length > 0
        ? finalized[finalized.length - 1]
        : (rounds.length > 0 ? rounds[rounds.length - 1] : null);
      if (target) {
        const { data } = await api.get(`/admin/rounds/${target.id}`);
        const results = data?.results || data?.round_results || [];
        results.forEach(r => { totals[r.candidate_id] = r.vote_count; });
      }
    } catch {
      // No totals — modal still works without them.
    }
    setSummaryDecidingTotals(totals);
    setSummaryOpen(true);
  };

  const handleGenerateSummary = async () => {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const designations = candidates.map(c => ({
        candidate_id: c.id,
        designation: summaryDesignations[c.id] || null,
      }));
      await api.put(`/admin/races/${raceId}/final-designations`, { designations });
      window.open(`/api/admin/races/${raceId}/summary-pdf`, '_blank');
      await fetchAll();
      setSummaryOpen(false);
    } catch (err) {
      setSummaryError(err.response?.data?.error || err.message || 'Failed to generate PDF');
    } finally {
      setSummaryBusy(false);
    }
  };

  const openFinalizeRace = () => setRacePinModal({
    title: `Finalize Race — ${race?.name || ''}`,
    description: 'This marks the race as finalized and cancels any remaining pending/ready rounds. No more rounds can be added. Requires Super Admin approval.',
    confirmLabel: 'Finalize Race',
    confirmStyle: 'danger',
    requireNotes: false,
    onConfirm: async ({ pin }) => {
      setRacePinModal(null);
      setRaceActionBusy(true);
      setRaceActionError(null);
      try {
        await api.post(`/admin/control-center/race/${raceId}/finalize`, { pin });
        await fetchAll();
      } catch (err) {
        setRaceActionError(err.response?.data?.error || 'Finalize failed');
      } finally {
        setRaceActionBusy(false);
      }
    },
  });

  const openReverseFinalizeRace = () => setRacePinModal({
    title: `Reverse Race Finalization — ${race?.name || ''}`,
    description: 'This re-opens the race, clears its outcome, and restores any canceled rounds to Ready. Any unpublished rounds remain in their previous state.',
    confirmLabel: 'Reverse Finalization',
    confirmStyle: 'danger',
    requireNotes: true,
    notesLabel: 'Reason for reversing race finalization',
    onConfirm: async ({ pin, notes }) => {
      setRacePinModal(null);
      setRaceActionBusy(true);
      setRaceActionError(null);
      try {
        await api.post(`/admin/control-center/race/${raceId}/reverse-finalize`, { pin, notes });
        await fetchAll();
      } catch (err) {
        setRaceActionError(err.response?.data?.error || 'Reverse failed');
      } finally {
        setRaceActionBusy(false);
      }
    },
  });

  if (!race) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending_needs_action: '#f59e0b', ready: '#10b981', voting_open: '#3b82f6', voting_closed: '#8b5cf6', tallying: '#f59e0b', round_finalized: '#6366f1', canceled: '#6b7280' };
  const statusLabel = { ready: 'Ready', voting_open: 'Voting Open', voting_closed: 'Voting Closed', tallying: 'Tallying', round_finalized: 'Finalized', canceled: 'Canceled' };
  const raceIsFinalized = race.status === 'results_finalized';
  const raceStatusMeta = {
    pending_needs_action: { bg: '#fef3c7', color: '#92400e', label: 'Needs Action' },
    ready: { bg: '#dcfce7', color: '#166534', label: 'Ready' },
    in_progress: { bg: '#dbeafe', color: '#1e40af', label: 'In Progress' },
    results_finalized: { bg: '#f3e8ff', color: '#6b21a8', label: 'Finalized' },
  }[race.status] || null;

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

      {/* Race Controls — Finalize / Reverse Finalization. Super admin only. */}
      {isSuperAdmin && (
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '0.85rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>Race status:</span>
            {raceStatusMeta ? (
              <span style={{
                ...styles.statusBadge,
                background: raceStatusMeta.bg,
                color: raceStatusMeta.color,
                borderRadius: 12,
              }}>{raceStatusMeta.label}</span>
            ) : (
              <span style={styles.muted}>{race.status || 'unknown'}</span>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!raceIsFinalized && (
              <button
                style={{ ...styles.btnDanger, padding: '0.5rem 1rem', fontSize: '0.88rem', opacity: raceActionBusy ? 0.6 : 1 }}
                onClick={openFinalizeRace}
                disabled={raceActionBusy}
              >
                Finalize Race
              </button>
            )}
            {raceIsFinalized && (
              <button
                style={{ ...styles.btnSmall, padding: '0.5rem 1rem', fontSize: '0.88rem', opacity: raceActionBusy ? 0.6 : 1 }}
                onClick={openReverseFinalizeRace}
                disabled={raceActionBusy}
              >
                Reverse Finalization
              </button>
            )}
          </div>
          {raceActionError && (
            <div style={{ flexBasis: '100%', color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>
              {raceActionError}
            </div>
          )}
        </div>
      )}

      {/* Print Official Race Summary — available to all admins */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '0.6rem 1rem', marginBottom: '1rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Official Race Summary</div>
          <div style={{ ...styles.muted, fontSize: '0.82rem' }}>
            Mark official nominees / candidates progressing to primary, then print the official outcome PDF for this race.
          </div>
        </div>
        <button
          style={{ ...styles.btnPrimary, padding: '0.5rem 1rem', fontSize: '0.88rem' }}
          onClick={openSummaryModal}
        >
          Print Race Summary
        </button>
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

              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={styles.btnSecondary}
                  onClick={() => {
                    setRecoveryOpen(true);
                    setRecoveryFile(null);
                    setRecoveryPreview(null);
                    setRecoveryError(null);
                    setRecoveryResult(null);
                  }}
                  title="Use the printed PDF to rebuild the OMR scan zones for every round of this race. Use when scanning misreads votes because the printed paper doesn't match the on-disk spec."
                >
                  Fix scan zones from PDF
                </button>
              </div>

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

      {/* Race-level PIN modal (Finalize / Reverse Finalization) */}
      <SuperAdminPinModal
        open={!!racePinModal}
        title={racePinModal?.title}
        description={racePinModal?.description}
        confirmLabel={racePinModal?.confirmLabel}
        confirmStyle={racePinModal?.confirmStyle}
        requireNotes={racePinModal?.requireNotes}
        notesLabel={racePinModal?.notesLabel}
        onCancel={() => setRacePinModal(null)}
        onConfirm={racePinModal?.onConfirm || (() => {})}
      />

      {/* Ballot-Spec Recovery Modal */}
      {recoveryOpen && (
        <RecoverySpecModal
          raceId={raceId}
          recoveryFile={recoveryFile}
          recoveryPreview={recoveryPreview}
          recoveryResult={recoveryResult}
          recoveryError={recoveryError}
          recoveryBusy={recoveryBusy}
          recoveryOverride={recoveryOverride}
          setRecoveryOverride={setRecoveryOverride}
          onChooseFile={async (file) => {
            setRecoveryFile(file);
            setRecoveryPreview(null);
            setRecoveryResult(null);
            setRecoveryError(null);
            setRecoveryOverride('');
            if (!file) return;
            await runRecoveryPreview(file, '', { setRecoveryBusy, setRecoveryPreview, setRecoveryError, raceId });
          }}
          onRetry={async () => {
            if (!recoveryFile) return;
            setRecoveryPreview(null);
            setRecoveryError(null);
            await runRecoveryPreview(recoveryFile, recoveryOverride, { setRecoveryBusy, setRecoveryPreview, setRecoveryError, raceId });
          }}
          onApply={async () => {
            if (!recoveryFile) return;
            setRecoveryBusy(true);
            setRecoveryError(null);
            try {
              const fd = new FormData();
              fd.append('file', recoveryFile);
              fd.append('confirm', 'true');
              if (recoveryOverride.trim()) {
                fd.append('candidates_override', normalizeOverride(recoveryOverride));
              }
              const { data } = await api.post(
                `/admin/races/${raceId}/recover-spec/apply`,
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } }
              );
              setRecoveryResult(data);
              fetchAll();
            } catch (err) {
              setRecoveryError(err.response?.data?.error || err.message);
            } finally {
              setRecoveryBusy(false);
            }
          }}
          onClose={() => {
            setRecoveryOpen(false);
            setRecoveryFile(null);
            setRecoveryPreview(null);
            setRecoveryError(null);
            setRecoveryResult(null);
            setRecoveryOverride('');
          }}
        />
      )}

      {/* Print Official Race Summary Modal */}
      {summaryOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalCard, maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 0.25rem' }}>Print Official Race Summary</h3>
            <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{race.name}</p>
            <p style={{ margin: '0 0 1rem', color: '#6b7280', fontSize: '0.85rem', lineHeight: 1.45 }}>
              Mark each candidate's official designation. These selections are saved as the race's official outcome and will appear on the printed PDF.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr', columnGap: '0.5rem', rowGap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, color: '#374151' }}>Candidate</div>
              <div style={{ fontWeight: 600, color: '#374151', textAlign: 'center' }}>None</div>
              <div style={{ fontWeight: 600, color: '#374151', textAlign: 'center' }}>Official Nominee</div>
              <div style={{ fontWeight: 600, color: '#374151', textAlign: 'center' }}>Progress to Primary</div>
              {candidates.map(c => {
                const cur = summaryDesignations[c.id] || '';
                const total = summaryDecidingTotals[c.id];
                return [
                  <div key={`${c.id}-name`} style={{ paddingRight: '0.5rem' }}>
                    <div style={{ fontWeight: 500 }}>{c.name}</div>
                    {total !== undefined && (
                      <div style={{ ...styles.muted, fontSize: '0.78rem' }}>{total} votes</div>
                    )}
                  </div>,
                  <div key={`${c.id}-none`} style={{ textAlign: 'center' }}>
                    <input
                      type="radio"
                      name={`des-${c.id}`}
                      checked={cur === ''}
                      onChange={() => setSummaryDesignations({ ...summaryDesignations, [c.id]: '' })}
                    />
                  </div>,
                  <div key={`${c.id}-on`} style={{ textAlign: 'center' }}>
                    <input
                      type="radio"
                      name={`des-${c.id}`}
                      checked={cur === 'official_nominee'}
                      onChange={() => setSummaryDesignations({ ...summaryDesignations, [c.id]: 'official_nominee' })}
                    />
                  </div>,
                  <div key={`${c.id}-pp`} style={{ textAlign: 'center' }}>
                    <input
                      type="radio"
                      name={`des-${c.id}`}
                      checked={cur === 'progress_to_primary'}
                      onChange={() => setSummaryDesignations({ ...summaryDesignations, [c.id]: 'progress_to_primary' })}
                    />
                  </div>,
                ];
              })}
            </div>

            {summaryError && (
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                {summaryError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button style={styles.btnSmall} onClick={() => setSummaryOpen(false)} disabled={summaryBusy}>Cancel</button>
              <button style={styles.btnPrimary} onClick={handleGenerateSummary} disabled={summaryBusy}>
                {summaryBusy ? 'Generating...' : 'Save & Generate PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

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

function normalizeOverride(text) {
  return String(text || '')
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('|');
}

async function runRecoveryPreview(file, overrideText, { setRecoveryBusy, setRecoveryPreview, setRecoveryError, raceId }) {
  setRecoveryBusy(true);
  try {
    const fd = new FormData();
    fd.append('file', file);
    if (overrideText && overrideText.trim()) {
      fd.append('candidates_override', normalizeOverride(overrideText));
    }
    const { data } = await api.post(
      `/admin/races/${raceId}/recover-spec/preview`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    setRecoveryPreview(data);
    if (!data.ok) setRecoveryError(data.error || 'Preview returned not-ok');
  } catch (err) {
    setRecoveryError(err.response?.data?.error || err.message);
  } finally {
    setRecoveryBusy(false);
  }
}

function RecoverySpecModal({
  raceId, recoveryFile, recoveryPreview, recoveryResult, recoveryError, recoveryBusy,
  recoveryOverride, setRecoveryOverride,
  onChooseFile, onRetry, onApply, onClose,
}) {
  const allMatched = recoveryPreview && Array.isArray(recoveryPreview.candidate_matches)
    && recoveryPreview.candidate_matches.length > 0
    && recoveryPreview.candidate_matches.every(m => m.db);

  return (
    <div style={styles.modalOverlay}>
      <div style={{ ...styles.modalCard, maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Fix scan zones from PDF</h3>
        <p style={{ margin: '0 0 1rem', color: '#374151', lineHeight: 1.45, fontSize: '0.9rem' }}>
          Upload the PDF that was actually sent to the printer. The server will read the QR + oval positions
          directly from the PDF's drawing operators and rewrite the OMR <code>ballot-spec.json</code> for
          <strong> every round of race {raceId}</strong>. Existing specs are backed up.
        </p>

        {!recoveryResult && (
          <>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>
                Printed ballot PDF
              </label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => onChooseFile(e.target.files?.[0] || null)}
                disabled={recoveryBusy}
              />
              {recoveryFile && (
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
                  {recoveryFile.name} ({Math.round(recoveryFile.size / 1024)} KB)
                </div>
              )}
            </div>

            {recoveryBusy && !recoveryPreview && (
              <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Reading PDF...</p>
            )}

            {recoveryError && !recoveryResult && (
              <div style={styles.recoveryErrorBox}>
                <strong>Error:</strong> {recoveryError}
              </div>
            )}

            {/* Manual override: shown collapsed by default, auto-expanded when there's been an error */}
            {recoveryFile && (
              <details
                style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}
                open={!!recoveryError}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#374151' }}>
                  Manual candidate names (override auto-detection)
                </summary>
                <p style={{ margin: '0.5rem 0', color: '#6b7280', fontSize: '0.82rem' }}>
                  Use this if the auto-detection failed or picked the wrong ovals. Enter the candidate names
                  in <strong>display order</strong>, one per line. They'll be assigned to the detected
                  ovals top-to-bottom. The number of names must match the number of ovals on the ballot.
                </p>
                <textarea
                  rows={5}
                  style={{
                    width: '100%', padding: '0.5rem', border: '1px solid #ccc',
                    borderRadius: 4, fontSize: '0.85rem', fontFamily: 'system-ui, sans-serif',
                    boxSizing: 'border-box',
                  }}
                  placeholder={'Jane Smith\nJohn Doe\nAlex Lee'}
                  value={recoveryOverride}
                  onChange={(e) => setRecoveryOverride(e.target.value)}
                  disabled={recoveryBusy}
                />
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    style={{ ...styles.btnSmall, padding: '0.4rem 0.75rem' }}
                    onClick={onRetry}
                    disabled={recoveryBusy}
                  >
                    {recoveryBusy ? 'Re-running...' : 'Re-run preview with these names'}
                  </button>
                </div>
              </details>
            )}

            {recoveryPreview && (
              <div style={{ marginBottom: '0.75rem' }}>
                <h4 style={styles.recoverySectionH4}>Detected layout</h4>
                <div style={styles.recoveryFactRow}>
                  <span style={styles.recoveryFactLabel}>Ballot size:</span>
                  <code>{recoveryPreview.extraction?.ballot_size}</code>
                </div>
                <div style={styles.recoveryFactRow}>
                  <span style={styles.recoveryFactLabel}>QR position (pts):</span>
                  <code>
                    x={recoveryPreview.extraction?.qr_position_pts?.x?.toFixed(2)} y={recoveryPreview.extraction?.qr_position_pts?.y?.toFixed(2)} {recoveryPreview.extraction?.qr_position_pts?.width?.toFixed(0)}×{recoveryPreview.extraction?.qr_position_pts?.height?.toFixed(0)}
                  </code>
                </div>

                <h4 style={styles.recoverySectionH4}>Candidate matches</h4>
                <table style={styles.recoveryTable}>
                  <thead>
                    <tr>
                      <th style={styles.recoveryTh}>From PDF</th>
                      <th style={styles.recoveryTh}>Matched DB candidate</th>
                      <th style={styles.recoveryTh}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recoveryPreview.candidate_matches || []).map((m, i) => (
                      <tr key={i}>
                        <td style={styles.recoveryTd}>{m.pdf_name}</td>
                        <td style={styles.recoveryTd}>
                          {m.db ? (
                            <>
                              <strong>{m.db.name}</strong>
                              <span style={styles.recoveryMuted}> (id={m.db.id}{m.db.status === 'withdrawn' ? ', withdrawn' : ''})</span>
                            </>
                          ) : (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>NO MATCH</span>
                          )}
                        </td>
                        <td style={styles.recoveryTd}>
                          {m.db ? (
                            <span style={{ ...styles.recoveryMatchBadge, background: m.method === 'exact' ? '#d1fae5' : '#fef3c7', color: m.method === 'exact' ? '#065f46' : '#92400e' }}>
                              {m.method}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {recoveryPreview.missing_from_pdf?.length > 0 && (
                  <div style={{ ...styles.recoveryWarnBox, marginTop: '0.5rem' }}>
                    <strong>Note:</strong> {recoveryPreview.missing_from_pdf.length} DB candidate(s) have no oval on the printed paper:{' '}
                    {recoveryPreview.missing_from_pdf.map(c => c.name).join(', ')}.
                    {' '}This is OK if those candidates were added/withdrawn after printing — they just won't be scannable.
                  </div>
                )}

                <h4 style={styles.recoverySectionH4}>Rounds that will be updated</h4>
                {recoveryPreview.rounds_to_update?.length > 0 ? (
                  <ul style={styles.recoveryList}>
                    {recoveryPreview.rounds_to_update.map(r => (
                      <li key={r.round_id} style={{ marginBottom: 2 }}>
                        Round {r.round_number}{' '}
                        <span style={styles.recoveryMuted}>(id={r.round_id})</span>
                        {r.backup && <span style={styles.recoveryMuted}> — existing spec will be backed up</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={styles.recoveryMuted}>No rounds found for this race.</p>
                )}
              </div>
            )}
          </>
        )}

        {recoveryResult && recoveryResult.ok && (
          <div style={styles.recoverySuccessBox}>
            <h4 style={{ margin: '0 0 0.25rem', color: '#065f46' }}>Recovery applied</h4>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
              Updated <strong>{recoveryResult.rounds_updated.length}</strong> round(s) of race {recoveryResult.race?.name}. Backups saved with extension <code>.broken-&lt;timestamp&gt;.json</code>.
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              <strong>Next:</strong> physically scan one printed ballot for this race with a known marked candidate to verify scanning aligns correctly.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          {recoveryResult ? (
            <button style={styles.btnPrimary} onClick={onClose}>Close</button>
          ) : (
            <>
              <button style={styles.btnSmall} onClick={onClose} disabled={recoveryBusy}>Cancel</button>
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: (allMatched && !recoveryBusy) ? 1 : 0.5,
                  cursor: (allMatched && !recoveryBusy) ? 'pointer' : 'not-allowed',
                }}
                disabled={!allMatched || recoveryBusy}
                onClick={onApply}
                title={!allMatched ? 'All PDF candidates must match a DB candidate before applying' : 'Write the recovered spec to every round of this race'}
              >
                {recoveryBusy ? 'Applying...' : `Apply to all ${recoveryPreview?.rounds_to_update?.length || 0} round(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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

  // Recovery modal styles
  btnSecondary: {
    padding: '0.5rem 1rem', background: '#fff', color: '#1f2937', border: '1px solid #d1d5db',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  },
  recoverySectionH4: { margin: '0.75rem 0 0.4rem', fontSize: '0.92rem', color: '#1f2937' },
  recoveryFactRow: { display: 'flex', gap: '0.5rem', fontSize: '0.85rem', marginBottom: 2, color: '#374151' },
  recoveryFactLabel: { fontWeight: 600, minWidth: 130 },
  recoveryTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  recoveryTh: { textAlign: 'left', padding: '0.35rem 0.5rem', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#1f2937' },
  recoveryTd: { padding: '0.35rem 0.5rem', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' },
  recoveryMuted: { color: '#6b7280', fontSize: '0.82rem' },
  recoveryMatchBadge: { padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 },
  recoveryList: { paddingLeft: '1.2rem', margin: 0, fontSize: '0.85rem', color: '#374151' },
  recoveryErrorBox: {
    background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b',
    padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', marginBottom: '0.75rem',
  },
  recoveryWarnBox: {
    background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e',
    padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem',
  },
  recoverySuccessBox: {
    background: '#d1fae5', border: '1px solid #6ee7b7',
    padding: '0.75rem', borderRadius: 6, marginBottom: '0.5rem',
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
