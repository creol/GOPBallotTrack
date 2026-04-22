import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';
import DashboardPreview from '../components/DashboardPreview';
import SuperAdminPinModal from '../components/SuperAdminPinModal';
import { useAuth } from '../context/AuthContext';

const STATUS_META = {
  pending_needs_action: { bg: '#fef3c7', color: '#92400e', label: 'Needs Action' },
  ready:                { bg: '#dcfce7', color: '#166534', label: 'Ready' },
  voting_open:          { bg: '#dbeafe', color: '#1e40af', label: 'Voting Open' },
  voting_closed:        { bg: '#e0e7ff', color: '#3730a3', label: 'Voting Closed' },
  tallying:             { bg: '#fef3c7', color: '#92400e', label: 'Tallying' },
  round_finalized:      { bg: '#f3e8ff', color: '#6b21a8', label: 'Finalized' },
  canceled:             { bg: '#f3f4f6', color: '#6b7280', label: 'Canceled' },
};

const OUTCOME_META = {
  eliminated:          { color: '#ef4444', label: 'Eliminated' },
  withdrew:            { color: '#6b7280', label: 'Withdrew' },
  advance:             { color: '#16a34a', label: 'Advances' },
  convention_winner:   { color: '#16a34a', label: 'Convention Winner' },
  winner:              { color: '#16a34a', label: 'Winner' },
  advance_to_primary:  { color: '#16a34a', label: 'Advances to Primary' },
};

export default function RoundDetail() {
  const { id: electionId, raceId, roundId } = useParams();
  const { auth } = useAuth();
  const isSuperAdmin = auth?.role === 'super_admin';

  const [round, setRound] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [spoiledCount, setSpoiledCount] = useState(0);
  const [resettingSpoiled, setResettingSpoiled] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const [globalError, setGlobalError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resultsView, setResultsView] = useState('dashboard'); // 'dashboard' | 'results'
  const [pinModal, setPinModal] = useState(null); // { title, description, confirmLabel, confirmStyle, requireNotes, onConfirm }

  const fetchRound = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/rounds/${roundId}`);
      setRound(data);
    } catch (err) {
      setGlobalError(err.response?.data?.error || 'Failed to load round');
    }
  }, [roundId]);

  const fetchFlagged = useCallback(async () => {
    try {
      const { data } = await api.get(`/rounds/${roundId}/reviewed-ballots?status=unresolved`);
      setFlaggedCount(Array.isArray(data) ? data.length : 0);
    } catch {}
  }, [roundId]);

  const fetchSpoiled = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/rounds/${roundId}/ballot-serials-summary`);
      setSpoiledCount(data.spoiled || 0);
    } catch {}
  }, [roundId]);

  const refreshAll = useCallback(() => {
    fetchRound(); fetchFlagged(); fetchSpoiled();
  }, [fetchRound, fetchFlagged, fetchSpoiled]);

  useEffect(() => {
    refreshAll();
    const socket = socketIO();
    socket.on('status:changed', refreshAll);
    socket.on('round:released', refreshAll);
    socket.on('scan:upload', refreshAll);
    socket.on('pass:complete', refreshAll);
    return () => socket.disconnect();
  }, [refreshAll]);

  // Fire-and-forget POST with spinner state; refreshes on success.
  const postAction = async (url, body) => {
    setActionBusy(url);
    setGlobalError(null);
    try {
      await api.post(url, body || {});
      refreshAll();
    } catch (err) {
      setGlobalError(err.response?.data?.error || 'Action failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleResetSpoiled = () => {
    setPinModal({
      title: 'Reset Spoiled Ballots',
      description: `Reset all ${spoiledCount} spoiled ballot${spoiledCount === 1 ? '' : 's'} back to unused? They will be available to scan again.`,
      confirmLabel: `Reset ${spoiledCount} Ballot${spoiledCount === 1 ? '' : 's'}`,
      confirmStyle: 'danger',
      requireNotes: false,
      onConfirm: async ({ adminName }) => {
        setResettingSpoiled(true);
        try {
          await api.put(`/admin/rounds/${roundId}/reset-spoiled`, { reset_by: adminName });
          refreshAll();
        } catch (err) {
          setGlobalError(err.response?.data?.error || 'Reset failed');
        } finally {
          setResettingSpoiled(false);
          setPinModal(null);
        }
      },
    });
  };

  if (!round) {
    return (
      <ElectionLayout breadcrumbs={[{ label: 'Election Events', to: '/admin' }]}>
        <p>Loading…</p>
      </ElectionLayout>
    );
  }

  const status = round.status;
  const statusMeta = STATUS_META[status] || { bg: '#e5e7eb', color: '#374151', label: status };
  const isPublished = !!round.published_at;
  const hasResults = round.results && round.results.length > 0;
  const totalVotes = hasResults ? round.results.reduce((s, r) => s + r.vote_count, 0) : 0;

  // Primary state action — one button that captures "what to do next" in the current phase.
  const primaryAction = (() => {
    if (status === 'ready') return { label: 'Open Voting', style: styles.btnSuccess, onClick: () => postAction(`/admin/control-center/round/${roundId}/open-voting`) };
    if (status === 'voting_open') return { label: 'Close Voting', style: styles.btnWarning, onClick: () => postAction(`/admin/control-center/round/${roundId}/close-voting`) };
    if (status === 'voting_closed') return { label: 'Open for Tallying', style: styles.btnPrimary, onClick: () => postAction(`/admin/control-center/round/${roundId}/open-tallying`) };
    if (status === 'round_finalized' && !isPublished) return {
      label: 'Publish to Dashboard',
      style: styles.btnPublish,
      onClick: () => {
        if (!confirm('Publish these results to the public dashboard?')) return;
        postAction(`/admin/control-center/round/${roundId}/publish`);
      },
    };
    return null;
  })();

  // Revert action — lets admin step back one lifecycle state if they moved too early.
  // PIN-gated because reverting is a real state change that affects other parts of the app
  // (e.g. tallying → voting_closed hides in-progress scans from the Confirmation view).
  const revertAction = (() => {
    if (status === 'voting_open') return {
      label: 'Back to Ready',
      url: `/admin/control-center/round/${roundId}/revert-to-ready`,
      description: 'Return this round to Ready. Voting has not produced any data yet — this just reopens the configuration step.',
    };
    if (status === 'voting_closed') return {
      label: 'Reopen Voting',
      url: `/admin/control-center/round/${roundId}/revert-to-voting-open`,
      description: 'Return this round to Voting Open so polls can continue accepting votes.',
    };
    if (status === 'tallying') return {
      label: 'Back to Voting Closed',
      url: `/admin/control-center/round/${roundId}/revert-to-voting-closed`,
      description: 'Step back to Voting Closed. Any scans already collected remain attached to their passes, but the Scanning section will lock again until tallying is reopened.',
    };
    return null;
  })();

  const openRevert = () => {
    if (!revertAction) return;
    setPinModal({
      title: revertAction.label,
      description: revertAction.description,
      confirmLabel: revertAction.label,
      confirmStyle: 'normal',
      requireNotes: false,
      onConfirm: async () => {
        setPinModal(null);
        await postAction(revertAction.url);
      },
    });
  };

  const openUnpublish = () => setPinModal({
    title: `Unpublish Round ${round.round_number}`,
    description: 'This removes the round from the public dashboard. The round stays finalized and its results are kept — you can republish at any time.',
    confirmLabel: 'Unpublish',
    confirmStyle: 'normal',
    requireNotes: false,
    onConfirm: async () => {
      setPinModal(null);
      await postAction(`/admin/control-center/round/${roundId}/unpublish`);
    },
  });

  const openRecount = () => setPinModal({
    title: `Issue Recount — Round ${round.round_number}`,
    description: 'This archives the current results, soft-deletes all passes for this round, resets publication, and sends the round back to tallying. Requires Super Admin approval.',
    confirmLabel: 'Issue Recount',
    confirmStyle: 'danger',
    requireNotes: true,
    notesLabel: 'Reason for recount',
    onConfirm: async ({ notes }) => {
      setPinModal(null);
      await postAction(`/admin/control-center/round/${roundId}/recount`, { notes });
    },
  });

  const openReverseFinalize = () => setPinModal({
    title: `Reverse Finalization — Round ${round.round_number}`,
    description: 'This un-publishes the round and resets its status to tallying so it can be re-confirmed. The race must not yet be fully finalized.',
    confirmLabel: 'Reverse Finalization',
    confirmStyle: 'danger',
    requireNotes: true,
    notesLabel: 'Reason for reversing finalization',
    onConfirm: async ({ notes }) => {
      setPinModal(null);
      await postAction(`/admin/control-center/round/${roundId}/reverse-finalize`, { notes });
    },
  });

  const openVoid = () => setPinModal({
    title: `Void Round ${round.round_number}`,
    description: `Voiding cancels ONLY this round. Other rounds in the race are not affected. This cannot be undone.`,
    confirmLabel: `Void Round ${round.round_number}`,
    confirmStyle: 'danger',
    requireNotes: true,
    notesLabel: 'Reason for voiding this round',
    onConfirm: async ({ notes }) => {
      setPinModal(null);
      await postAction(`/admin/control-center/round/${roundId}/void`, { notes });
    },
  });

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: round.race?.election?.name || 'Election', to: `/admin/elections/${electionId}` },
      { label: round.race?.name || 'Race', to: `/admin/elections/${electionId}/races/${raceId}` },
      { label: `Round ${round.round_number}` },
    ]}>
      <div data-round-page>
      <div data-round-header style={styles.stickyHeader}>
        <div style={styles.headerInner}>
          <div>
            <h1 style={styles.title}>Round {round.round_number}</h1>
            <p style={styles.subtitle}>
              Paper: <strong>{round.paper_color || '(none)'}</strong>
              {round.race?.name && <> &nbsp;·&nbsp; {round.race.name}</>}
            </p>
          </div>
          <div style={styles.badges}>
            <span style={{ ...styles.badge, background: statusMeta.bg, color: statusMeta.color }}>
              {statusMeta.label}
            </span>
            {isPublished && <span style={{ ...styles.badge, background: '#dcfce7', color: '#166534' }}>Published</span>}
          </div>
        </div>
      </div>

      {globalError && <div style={styles.errorBanner}>{globalError}</div>}

      {/* 1. Round Controls — state-aware lifecycle buttons. Super admin only. */}
      {isSuperAdmin && (
      <section style={styles.sectionCard}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Round Controls</h2>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {primaryAction && (
            <button
              data-primary-in-page
              style={{ ...primaryAction.style, opacity: actionBusy ? 0.6 : 1 }}
              onClick={primaryAction.onClick}
              disabled={!!actionBusy}
            >
              {primaryAction.label}
            </button>
          )}
          {revertAction && (
            <button
              style={{ ...styles.btnGhost, opacity: actionBusy ? 0.6 : 1 }}
              onClick={openRevert}
              disabled={!!actionBusy}
              title={revertAction.description}
            >
              ← {revertAction.label}
            </button>
          )}
        </div>

        {status === 'round_finalized' && isPublished && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            <span style={styles.infoLine}>✓ Published to public dashboard.</span>
            <button
              style={{ ...styles.btnGhost, opacity: actionBusy ? 0.6 : 1 }}
              onClick={openUnpublish}
              disabled={!!actionBusy}
              title="Remove this round from the public dashboard (results remain saved)"
            >
              Unpublish
            </button>
          </div>
        )}

        {status === 'canceled' && (
          <p style={styles.infoLine}>This round was canceled.</p>
        )}

        {!primaryAction && status !== 'round_finalized' && status !== 'canceled' && (
          <p style={styles.infoLine}>
            No direct action available. See the Scanning and Tasks sections below.
          </p>
        )}
      </section>
      )}

      {/* 2. Scanning & Passes — grayed out until status = tallying */}
      <PassManager
        roundId={roundId}
        onUpdate={refreshAll}
        disabled={status !== 'tallying'}
        disabledReason={
          status === 'pending_needs_action' || status === 'ready'
            ? 'Open voting first, then move to tallying to enable scanning.'
            : status === 'voting_open'
              ? 'Close voting, then open for tallying to enable scanning.'
              : status === 'voting_closed'
                ? 'Open for tallying to enable scanning.'
                : status === 'round_finalized'
                  ? 'This round is finalized. Scanning is closed.'
                  : status === 'canceled'
                    ? 'This round was canceled. Scanning is closed.'
                    : 'Scanning is not currently open.'
        }
      />

      {/* 3. Results view — Dashboard Preview by default; toggle to the raw Results panel. */}
      {hasResults && (
        <section style={styles.sectionCard}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>
              {resultsView === 'dashboard' ? 'Dashboard Preview' : 'Results'}
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {isPublished
                ? <span style={{ ...styles.badge, background: '#dcfce7', color: '#166534' }}>Live on public dashboard</span>
                : <span style={{ ...styles.badge, background: '#f3f4f6', color: '#4b5563' }}>Preview only — not published</span>}
              <div style={styles.viewToggle} role="tablist">
                <button
                  role="tab"
                  aria-selected={resultsView === 'dashboard'}
                  style={resultsView === 'dashboard' ? styles.viewToggleActive : styles.viewToggleInactive}
                  onClick={() => setResultsView('dashboard')}
                >
                  Dashboard Preview
                </button>
                <button
                  role="tab"
                  aria-selected={resultsView === 'results'}
                  style={resultsView === 'results' ? styles.viewToggleActive : styles.viewToggleInactive}
                  onClick={() => setResultsView('results')}
                >
                  Results
                </button>
              </div>
            </div>
          </div>

          {resultsView === 'dashboard' ? (
            <DashboardPreview
              electionName={round.race?.election?.name}
              raceName={round.race?.name}
              roundNumber={round.round_number}
              results={round.results}
              decisions={{}}
              withdrawn={new Set()}
              totalVotes={totalVotes}
            />
          ) : (
            <div style={styles.resultsPanel}>
              {round.results.map(r => {
                const pct = Number(r.percentage);
                const oc = OUTCOME_META[r.outcome];
                return (
                  <div key={r.id || r.candidate_id} style={styles.tvResultRow}>
                    <span style={styles.tvCandidateName}>
                      {r.candidate_name}
                      {oc && <span style={{ color: oc.color, fontSize: '0.75rem', marginLeft: '0.5rem' }}>{oc.label}</span>}
                    </span>
                    <div style={styles.tvBarContainer}>
                      <div style={{ ...styles.tvBar, width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span style={styles.tvVoteCount}>{r.vote_count}</span>
                    <span style={styles.tvPct}>{pct.toFixed(5)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 4. Tasks — state-aware workflow links */}
      <TaskSection
        round={round}
        flaggedCount={flaggedCount}
        spoiledCount={spoiledCount}
        resettingSpoiled={resettingSpoiled}
        onResetSpoiled={handleResetSpoiled}
        electionId={electionId}
        raceId={raceId}
        roundId={roundId}
      />

      {/* 5. Advanced Actions — collapsed, PIN-gated */}
      {isSuperAdmin && (
        <section style={styles.sectionCard}>
          <button
            style={styles.advancedToggle}
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
          >
            <span>{showAdvanced ? '▾' : '▸'} Advanced actions</span>
            <span style={styles.muted}>recount, void, reverse finalization</span>
          </button>
          {showAdvanced && (
            <div style={styles.advancedActions}>
              <p style={styles.muted}>
                These are destructive admin actions. Each one requires a Super Admin PIN to confirm.
              </p>
              <div style={styles.actionGrid}>
                <button style={styles.btnDangerOutline} onClick={openRecount} disabled={status !== 'round_finalized' || !!actionBusy}>
                  Issue Recount
                </button>
                <button style={styles.btnDangerOutline} onClick={openReverseFinalize} disabled={status !== 'round_finalized' || !!actionBusy}>
                  Reverse Finalization
                </button>
                <button style={styles.btnDanger} onClick={openVoid} disabled={!['round_finalized', 'tallying', 'voting_closed'].includes(status) || !!actionBusy}>
                  Void Round {round.round_number}
                </button>
              </div>
              {status !== 'round_finalized' && (
                <p style={styles.muted}>Recount and Reverse Finalization are only available after a round is finalized.</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Mobile sticky primary action bar — super admin only, matches the Round Controls button */}
      {isSuperAdmin && primaryAction && (
        <div data-round-actionbar style={styles.mobileActionBar}>
          <button
            style={{ ...primaryAction.style, width: '100%', opacity: actionBusy ? 0.6 : 1 }}
            onClick={primaryAction.onClick}
            disabled={!!actionBusy}
          >
            {primaryAction.label}
          </button>
        </div>
      )}

      <SuperAdminPinModal
        open={!!pinModal}
        title={pinModal?.title}
        description={pinModal?.description}
        confirmLabel={pinModal?.confirmLabel}
        confirmStyle={pinModal?.confirmStyle}
        requireNotes={pinModal?.requireNotes}
        notesLabel={pinModal?.notesLabel}
        onCancel={() => setPinModal(null)}
        onConfirm={pinModal?.onConfirm || (() => {})}
      />
      </div>
    </ElectionLayout>
  );
}

// ─── Scanning / Passes ─────────────────────────────────────────────────────
function PassManager({ roundId, onUpdate, disabled = false, disabledReason = '' }) {
  const { auth } = useAuth();
  const isSuperAdmin = auth?.role === 'super_admin';
  const [passes, setPasses] = useState([]);
  const [stationCounts, setStationCounts] = useState([]);
  const [reconcileCounts, setReconcileCounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pinModal, setPinModal] = useState(null);

  const fetchAll = async () => {
    try {
      const [passesRes, countsRes, reconRes] = await Promise.all([
        api.get(`/rounds/${roundId}/passes`),
        api.get(`/rounds/${roundId}/station-counts`),
        api.get(`/rounds/${roundId}/reconciliation-counts`),
      ]);
      setPasses(Array.isArray(passesRes.data) ? passesRes.data : []);
      setStationCounts(Array.isArray(countsRes.data) ? countsRes.data : []);
      setReconcileCounts(Array.isArray(reconRes.data) ? reconRes.data : []);
    } catch {}
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [roundId]);

  const handleComplete = async (passId, passNumber) => {
    if (!confirm(`Complete Pass ${passNumber}?`)) return;
    setLoading(true);
    try {
      await api.put(`/passes/${passId}/complete`);
      fetchAll();
      onUpdate?.();
    } catch (err) {
      alert('Failed to complete pass: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post(`/rounds/${roundId}/passes`);
      fetchAll();
      onUpdate?.();
    } catch (err) {
      alert('Failed to create pass: ' + (err.response?.data?.error || err.message));
    }
  };

  const openReopen = (passId, passNumber) => setPinModal({
    title: `Reopen Pass ${passNumber}`,
    description: 'Reopening allows additional ballots to be scanned into this pass.',
    confirmLabel: 'Reopen Pass',
    confirmStyle: 'normal',
    requireNotes: true,
    notesLabel: 'Reason for reopening',
    onConfirm: async ({ notes }) => {
      setPinModal(null);
      setLoading(true);
      try {
        await api.put(`/passes/${passId}/reopen`, { reason: notes });
        fetchAll();
        onUpdate?.();
      } catch (err) {
        alert('Failed to reopen pass: ' + (err.response?.data?.error || err.message));
      } finally {
        setLoading(false);
      }
    },
  });

  const openDelete = (passId, passNumber, scanCount) => setPinModal({
    title: `Delete Pass ${passNumber}`,
    description: `${scanCount || 0} scan${scanCount === 1 ? '' : 's'} will be deleted and their ballots reset to unused. This cannot be undone.`,
    confirmLabel: 'Delete Pass',
    confirmStyle: 'danger',
    requireNotes: true,
    notesLabel: 'Reason for deleting pass',
    onConfirm: async ({ pin, notes }) => {
      setPinModal(null);
      setLoading(true);
      try {
        await api.delete(`/passes/${passId}`, { data: { deleted_reason: notes, confirm_pin: pin } });
        fetchAll();
        onUpdate?.();
      } catch (err) {
        alert('Failed to delete pass: ' + (err.response?.data?.error || err.message));
      } finally {
        setLoading(false);
      }
    },
  });

  const activePasses = passes.filter(p => p.status === 'active');
  const completedPasses = passes.filter(p => p.status === 'complete');

  return (
    <section style={{ ...styles.sectionCard, ...(disabled ? styles.sectionDisabled : {}) }}>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Scanning</h2>
        {!disabled && isSuperAdmin && activePasses.length === 0 && (
          <button style={styles.btnPrimary} onClick={handleCreate}>
            Start Pass {passes.length + 1}
          </button>
        )}
      </div>

      {disabled && (
        <div style={styles.scanningLockedBanner}>
          <span style={{ fontWeight: 700 }}>Scanning is locked.</span>
          {disabledReason && <span> &nbsp;·&nbsp; {disabledReason}</span>}
        </div>
      )}

      {!disabled && passes.length === 0 && (
        <p style={styles.muted}>No passes yet. Super Admin starts a pass, then ballots flow in from the agent.</p>
      )}

      <div style={disabled ? { opacity: 0.5, pointerEvents: 'none', userSelect: 'none' } : undefined}>
      {activePasses.map(p => (
        <div key={p.id} style={styles.activePassCard}>
          <div style={styles.passLineLeft}>
            <span style={styles.passLabel}>Pass {p.pass_number}</span>
            <span style={styles.pill} title="Total uploads (any outcome)">{p.upload_count ?? p.scan_count ?? 0} scans</span>
            <span style={styles.activeBadge}>Active</span>
          </div>
          {isSuperAdmin && (
            <div style={styles.passLineRight}>
              <button style={styles.btnGhostDanger} onClick={() => openDelete(p.id, p.pass_number, p.scan_count)} disabled={loading}>Delete Pass</button>
              <button style={styles.btnWarning} onClick={() => handleComplete(p.id, p.pass_number)} disabled={loading}>
                {loading ? 'Completing…' : 'Complete Pass'}
              </button>
            </div>
          )}
        </div>
      ))}

      {completedPasses.map(p => (
        <div key={p.id} style={styles.completedPassRow}>
          <div style={styles.passLineLeft}>
            <span style={{ fontWeight: 600 }}>Pass {p.pass_number}</span>
            <span style={styles.muted} title="Total uploads (any outcome)">{p.upload_count ?? p.scan_count ?? 0} scans</span>
            <span style={styles.completeBadge}>✓ Complete</span>
          </div>
          {isSuperAdmin && (
            <div style={styles.passLineRight}>
              <button style={styles.btnGhost} onClick={() => openReopen(p.id, p.pass_number)} disabled={loading}>Reopen</button>
              <button style={styles.btnGhostDanger} onClick={() => openDelete(p.id, p.pass_number, p.scan_count)} disabled={loading}>Delete</button>
            </div>
          )}
        </div>
      ))}

      <StationCountsTable passes={passes} stationCounts={stationCounts} reconcileCounts={reconcileCounts} />
      </div>

      <SuperAdminPinModal
        open={!!pinModal}
        title={pinModal?.title}
        description={pinModal?.description}
        confirmLabel={pinModal?.confirmLabel}
        confirmStyle={pinModal?.confirmStyle}
        requireNotes={pinModal?.requireNotes}
        notesLabel={pinModal?.notesLabel}
        onCancel={() => setPinModal(null)}
        onConfirm={pinModal?.onConfirm || (() => {})}
      />
    </section>
  );
}

// ─── Scans by Station table ────────────────────────────────────────────────
function StationCountsTable({ passes, stationCounts, reconcileCounts }) {
  const reconMap = new Map((reconcileCounts || []).map(r => [r.station_id, r.pending || 0]));
  const stationIdSet = new Set((stationCounts || []).map(r => r.station_id));
  reconMap.forEach((_, sid) => stationIdSet.add(sid));
  if (stationIdSet.size === 0) return null;

  const nonDeletedPasses = passes.filter(p => p.status !== 'deleted');
  const passColumns = nonDeletedPasses.map(p => ({ id: p.id, label: `Pass ${p.pass_number}` }));
  const hasUnbucketed = stationCounts.some(r => r.pass_id == null);
  if (hasUnbucketed) passColumns.push({ id: null, label: 'Unassigned' });

  const stationIds = Array.from(stationIdSet).sort();
  const lookup = new Map();
  stationCounts.forEach(r => { lookup.set(`${r.station_id}|${r.pass_id ?? 'null'}`, r.uploads || 0); });

  const colTotal = (passId) =>
    stationCounts.filter(r => (r.pass_id ?? null) === passId).reduce((s, r) => s + (r.uploads || 0), 0);
  const rowTotal = (station) =>
    stationCounts.filter(r => r.station_id === station).reduce((s, r) => s + (r.uploads || 0), 0);
  const grandTotal = stationCounts.reduce((s, r) => s + (r.uploads || 0), 0);
  const reconTotal = Array.from(reconMap.values()).reduce((s, n) => s + n, 0);

  const th = { textAlign: 'left', padding: '0.5rem 0.75rem', background: '#f9fafb', fontSize: '0.82rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700 };
  const td = { padding: '0.4rem 0.75rem', fontSize: '0.88rem', borderBottom: '1px solid #f3f4f6' };
  const numeric = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>Scans by Station</h3>
      {/* Desktop table */}
      <div data-station-table style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Station</th>
              {passColumns.map(c => (
                <th key={c.id ?? 'null'} style={{ ...th, textAlign: 'right' }}>{c.label}</th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={{ ...th, textAlign: 'right' }} title="Unresolved reviewed ballots">Needs Review</th>
            </tr>
          </thead>
          <tbody>
            {stationIds.map(sid => {
              const pending = reconMap.get(sid) || 0;
              return (
                <tr key={sid}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{sid}</td>
                  {passColumns.map(c => (
                    <td key={c.id ?? 'null'} style={numeric}>{lookup.get(`${sid}|${c.id ?? 'null'}`) || 0}</td>
                  ))}
                  <td style={{ ...numeric, fontWeight: 700 }}>{rowTotal(sid)}</td>
                  <td style={{
                    ...numeric, fontWeight: 700,
                    color: pending > 0 ? '#b45309' : '#6b7280',
                    background: pending > 0 ? '#fef3c7' : undefined,
                  }}>{pending}</td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...td, fontWeight: 700, background: '#f9fafb' }}>Total</td>
              {passColumns.map(c => (
                <td key={c.id ?? 'null'} style={{ ...numeric, fontWeight: 700, background: '#f9fafb' }}>{colTotal(c.id ?? null)}</td>
              ))}
              <td style={{ ...numeric, fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>{grandTotal}</td>
              <td style={{
                ...numeric, fontWeight: 700,
                color: reconTotal > 0 ? '#b45309' : '#6b7280',
                background: reconTotal > 0 ? '#fef3c7' : '#f9fafb',
              }}>{reconTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile card view — shown under 500px via CSS */}
      <div data-station-cards style={styles.stationCardList}>
        {stationIds.map(sid => {
          const pending = reconMap.get(sid) || 0;
          return (
            <div key={sid} style={styles.stationCard}>
              <div style={styles.stationCardHeader}>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{sid}</span>
                <span style={{ ...styles.pill }}>Total {rowTotal(sid)}</span>
              </div>
              {passColumns.map(c => (
                <div key={c.id ?? 'null'} style={styles.stationCardRow}>
                  <span style={styles.muted}>{c.label}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{lookup.get(`${sid}|${c.id ?? 'null'}`) || 0}</span>
                </div>
              ))}
              <div style={styles.stationCardRow}>
                <span style={styles.muted}>Needs Review</span>
                <span style={{
                  fontFamily: 'monospace', fontWeight: 700,
                  color: pending > 0 ? '#b45309' : '#6b7280',
                }}>{pending}</span>
              </div>
            </div>
          );
        })}
        <div style={{ ...styles.stationCard, background: '#f9fafb' }}>
          <div style={styles.stationCardHeader}>
            <span style={{ fontWeight: 700 }}>Totals</span>
            <span style={{ ...styles.pill, background: '#dbeafe', color: '#1e40af' }}>Total {grandTotal}</span>
          </div>
          <div style={styles.stationCardRow}>
            <span style={styles.muted}>Needs Review</span>
            <span style={{
              fontFamily: 'monospace', fontWeight: 700,
              color: reconTotal > 0 ? '#b45309' : '#6b7280',
            }}>{reconTotal}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tasks (state-aware workflow prompts) ──────────────────────────────────
function TaskSection({ round, flaggedCount, spoiledCount, resettingSpoiled, onResetSpoiled, electionId, raceId, roundId }) {
  const status = round.status;
  const isPublished = !!round.published_at;

  const items = [];

  if (flaggedCount > 0) {
    items.push({
      key: 'review',
      title: `Review ${flaggedCount} flagged ballot${flaggedCount === 1 ? '' : 's'}`,
      description: 'Ballots flagged by OMR or scanned at the wrong station. Resolve before confirming.',
      active: ['tallying', 'voting_closed'].includes(status),
      action: (
        <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/review`} style={styles.btnLink}>
          Review Ballots ({flaggedCount})
        </Link>
      ),
    });
  }

  if (['tallying', 'voting_closed'].includes(status)) {
    items.push({
      key: 'confirm',
      title: 'Confirm results',
      description: 'Compare pass counts and confirm the tally is accurate.',
      active: true,
      action: (
        <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/confirm`} style={styles.btnLinkGreen}>
          Open Confirmation
        </Link>
      ),
    });
  }

  if (status === 'round_finalized' && !isPublished) {
    items.push({
      key: 'chair',
      title: 'Preview & Release',
      description: 'Preview what the public dashboard will show, then release.',
      active: true,
      action: (
        <Link to={`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`} style={styles.btnLinkPurple}>
          Preview & Release
        </Link>
      ),
    });
  }

  if (status === 'round_finalized') {
    items.push({
      key: 'download',
      title: 'Download Results PDF',
      description: 'Official results for this round.',
      active: true,
      action: (
        <a href={`/api/admin/rounds/${roundId}/results-pdf`} style={styles.btnLinkGreen} download>
          Download PDF
        </a>
      ),
    });
  }

  if (spoiledCount > 0) {
    items.push({
      key: 'reset-spoiled',
      title: `Reset ${spoiledCount} spoiled ballot${spoiledCount === 1 ? '' : 's'}`,
      description: 'Return spoiled serials to unused so they can be scanned again.',
      active: true,
      action: (
        <button style={{ ...styles.btnWarning, opacity: resettingSpoiled ? 0.6 : 1 }} onClick={onResetSpoiled} disabled={resettingSpoiled}>
          {resettingSpoiled ? 'Resetting…' : 'Reset Spoiled'}
        </button>
      ),
    });
  }

  if (items.length === 0) return null;

  return (
    <section style={styles.sectionCard}>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Tasks</h2>
      </div>
      <div style={styles.taskGrid}>
        {items.map(item => (
          <div key={item.key} data-task-card style={{ ...styles.taskCard, ...(item.active ? styles.taskCardActive : {}) }}>
            <div style={{ flex: 1 }}>
              <div style={styles.taskTitle}>{item.title}</div>
              <div style={styles.taskDescription}>{item.description}</div>
            </div>
            <div data-task-action style={styles.taskAction}>{item.action}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const styles = {
  // Sticky header for mobile visibility.
  stickyHeader: {
    position: 'sticky', top: 0, zIndex: 10,
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0.75rem 0',
    marginBottom: '1rem',
  },
  headerInner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  title: { margin: 0, fontSize: '1.5rem' },
  subtitle: { margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.9rem' },
  badges: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  badge: { padding: '4px 12px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 },

  errorBanner: { background: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem', fontWeight: 600 },

  // Section cards
  sectionCard: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
    padding: '1rem', marginBottom: '1rem',
  },
  sectionDisabled: { background: '#f9fafb', borderColor: '#e5e7eb' },
  scanningLockedBanner: {
    background: '#f3f4f6', color: '#4b5563', padding: '0.6rem 0.85rem',
    borderRadius: 6, fontSize: '0.88rem', marginBottom: '0.5rem',
    border: '1px dashed #d1d5db',
  },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' },
  sectionTitle: { margin: 0, fontSize: '1.1rem' },

  // Passes
  activePassCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem', border: '2px solid #3b82f6', borderRadius: 8, background: '#eff6ff',
    marginBottom: '0.5rem', flexWrap: 'wrap',
  },
  completedPassRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
    padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', flexWrap: 'wrap',
  },
  passLineLeft: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  passLineRight: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  passLabel: { fontWeight: 700 },
  pill: { background: '#dbeafe', color: '#1e40af', padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.85rem' },
  activeBadge: { color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' },
  completeBadge: { color: '#16a34a', fontSize: '0.82rem' },

  // Station card view (mobile fallback)
  stationCardList: { display: 'none', gap: '0.5rem', flexDirection: 'column' },
  stationCard: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem', background: '#fff' },
  stationCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' },
  stationCardRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.15rem 0' },

  // Results
  resultsPanel: { background: '#1e293b', borderRadius: 12, padding: '1.25rem' },
  tvResultRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', flexWrap: 'wrap' },
  tvCandidateName: { minWidth: 120, fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', flex: '1 1 140px' },
  tvBarContainer: { flex: '2 1 120px', minWidth: 80, height: 16, background: '#334155', borderRadius: 8, overflow: 'hidden' },
  tvBar: { height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: 8, transition: 'width 0.8s ease' },
  tvVoteCount: { width: 40, textAlign: 'right', fontWeight: 700, fontSize: '1.05rem', color: '#fff' },
  tvPct: { width: 80, textAlign: 'right', color: '#94a3b8', fontSize: '0.85rem' },

  // View toggle (Dashboard Preview / Results)
  viewToggle: {
    display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden',
  },
  viewToggleActive: {
    padding: '0.35rem 0.75rem', background: '#2563eb', color: '#fff', border: 'none',
    cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
  },
  viewToggleInactive: {
    padding: '0.35rem 0.75rem', background: '#fff', color: '#4b5563', border: 'none',
    cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
  },

  // Tasks
  taskGrid: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  taskCard: {
    display: 'flex', gap: '0.75rem', alignItems: 'center',
    padding: '0.75rem', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fafafa',
    flexWrap: 'wrap',
  },
  taskCardActive: { borderColor: '#93c5fd', background: '#eff6ff' },
  taskTitle: { fontWeight: 600, fontSize: '0.95rem' },
  taskDescription: { color: '#6b7280', fontSize: '0.82rem', marginTop: '0.15rem' },
  taskAction: { flexShrink: 0 },

  // Advanced
  advancedToggle: {
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0',
    fontSize: '0.95rem', fontWeight: 600, color: '#374151',
  },
  advancedActions: { paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  actionGrid: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },

  // Buttons
  btnPrimary: { padding: '0.6rem 1.2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  btnSuccess: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  btnWarning: { padding: '0.6rem 1.2rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  btnPublish: { padding: '0.7rem 1.4rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 700 },
  btnDanger: { padding: '0.6rem 1.2rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600 },
  btnDangerOutline: { padding: '0.5rem 1rem', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnGhost: { padding: '0.5rem 1rem', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem' },
  btnGhostDanger: { padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 },
  btnLink: { padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 },
  btnLinkGreen: { padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 },
  btnLinkPurple: { padding: '0.5rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 },

  // Mobile sticky action bar — hidden on desktop via media query
  mobileActionBar: {
    display: 'none',
    position: 'fixed', bottom: 0, left: 0, right: 0,
    padding: '0.75rem',
    background: '#fff',
    borderTop: '1px solid #e5e7eb',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
    zIndex: 20,
  },

  // Shared
  muted: { color: '#6b7280', fontSize: '0.85rem' },
  infoLine: { color: '#4b5563', fontSize: '0.9rem', margin: '0.5rem 0 0' },
};

// Inject responsive CSS
if (typeof document !== 'undefined') {
  const id = 'round-detail-responsive';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = `
      /* Tablets and phones — stack task cards vertically, tighter padding */
      @media (max-width: 768px) {
        [data-round-page] section { padding: 0.75rem !important; }
        [data-task-card] { flex-direction: column !important; align-items: stretch !important; }
        [data-task-card] [data-task-action] { width: 100%; display: flex; }
        [data-task-card] [data-task-action] > * { flex: 1; text-align: center; }
      }
      /* Narrow phones — hide station table, show card fallback, pin primary action, add bottom padding */
      @media (max-width: 600px) {
        [data-station-table] { display: none !important; }
        [data-station-cards] { display: flex !important; }
        [data-round-actionbar] { display: block !important; }
        [data-round-page] { padding-bottom: 5rem !important; }
        /* Hide the primary-action duplicate inside Round Controls on mobile (sticky bar takes over) */
        [data-primary-in-page] { display: none !important; }
      }
      /* Tablet-up: full table, no sticky action bar, show primary button in-page */
      @media (min-width: 601px) {
        [data-station-cards] { display: none !important; }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
