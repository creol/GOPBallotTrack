import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import ElectionLayout from '../components/ElectionLayout';

export default function Confirmation() {
  const { id: electionId, raceId, roundId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [judgeName, setJudgeName] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [reviewPassId, setReviewPassId] = useState(null);
  const [reviewBallots, setReviewBallots] = useState([]);
  const [loadingBallots, setLoadingBallots] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showBallotTable, setShowBallotTable] = useState(false);
  const [allPassBallots, setAllPassBallots] = useState({});
  const [comparePass1, setComparePass1] = useState(null);
  const [comparePass2, setComparePass2] = useState(null);
  const [tableFilter, setTableFilter] = useState('all'); // all, mismatch, confDiff, corrected
  const [tableSearch, setTableSearch] = useState('');

  const fetchComparison = async () => {
    try {
      const { data: comp } = await api.get(`/admin/rounds/${roundId}/comparison`);
      setData(comp);
      // Default compare passes to first two
      if (comp.passes.length >= 2 && !comparePass1) {
        setComparePass1(comp.passes[0].pass_number);
        setComparePass2(comp.passes[1].pass_number);
      } else if (comp.passes.length === 1 && !comparePass1) {
        setComparePass1(comp.passes[0].pass_number);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load comparison');
    }
  };

  useEffect(() => { fetchComparison(); }, [roundId]);

  const handleToggleBallotTable = async () => {
    if (showBallotTable) { setShowBallotTable(false); return; }
    // Load ballots from all passes
    const byPass = {};
    for (const p of data.passes) {
      try {
        const { data: ballots } = await api.get(`/admin/passes/${p.id}/ballots`);
        byPass[p.pass_number] = ballots;
      } catch { byPass[p.pass_number] = []; }
    }
    setAllPassBallots(byPass);
    setShowBallotTable(true);
  };

  const handleReviewPass = async (passId) => {
    if (reviewPassId === passId) { setReviewPassId(null); return; }
    setLoadingBallots(true);
    setReviewIndex(0);
    try {
      // Load ballots from the selected pass
      const { data: ballots } = await api.get(`/admin/passes/${passId}/ballots`);
      setReviewBallots(ballots);
      // Also load all other passes for comparison
      const byPass = {};
      for (const p of data.passes) {
        if (p.id === passId) {
          byPass[p.pass_number] = ballots;
        } else {
          try {
            const { data: pb } = await api.get(`/admin/passes/${p.id}/ballots`);
            byPass[p.pass_number] = pb;
          } catch { byPass[p.pass_number] = []; }
        }
      }
      setAllPassBallots(byPass);
      setReviewPassId(passId);
    } catch {
      setReviewBallots([]);
    } finally {
      setLoadingBallots(false);
    }
  };

  const handleConfirm = async () => {
    if (!judgeName.trim()) { setError('Please enter your name'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/rounds/${roundId}/confirm`, { confirmed_by_name: judgeName });
      navigate(`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`);
    } catch (err) {
      setError(err.response?.data?.error || 'Confirmation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverride = async () => {
    if (!judgeName.trim()) { setError('Please enter your name'); return; }
    if (!overrideNotes.trim()) { setError('Override notes are required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/rounds/${roundId}/confirm-override`, {
        confirmed_by_name: judgeName,
        override_notes: overrideNotes,
      });
      navigate(`/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}/chair`);
    } catch (err) {
      setError(err.response?.data?.error || 'Override failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPass = () => {
    navigate(`/scan/${roundId}`);
  };

  if (!data) return <div style={styles.container}><p>{error || 'Loading...'}</p></div>;

  const notEnoughPasses = data.passes.length < 2;

  return (
    <ElectionLayout breadcrumbs={[
      { label: 'Election Events', to: '/admin' },
      { label: data.race?.name || 'Race', to: `/admin/elections/${electionId}/races/${raceId}` },
      { label: `Round ${data.round.round_number}`, to: `/admin/elections/${electionId}/races/${raceId}/rounds/${roundId}` },
      { label: 'Confirm' },
    ]}>

      <h1>Confirm Round {data.round.round_number}</h1>
      <p style={styles.muted}>{data.race.name} — Paper: {data.round.paper_color}</p>

      {notEnoughPasses && (
        <div style={styles.warningBanner}>
          At least 2 completed passes are required before confirmation.
          Currently {data.passes.length} completed pass(es).
          <button style={styles.btnPrimary} onClick={handleAddPass}>Go to Scanner</button>
        </div>
      )}

      {/* Comparison Table */}
      <div style={styles.section}>
        <h2>Pass Comparison</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Candidate</th>
                {data.passes.map(p => (
                  <th key={p.pass_number} style={styles.th}>
                    Pass {p.pass_number}
                    <button
                      style={{ ...styles.btnReview, background: reviewPassId === p.id ? '#2563eb' : '#e5e7eb', color: reviewPassId === p.id ? '#fff' : '#374151' }}
                      onClick={() => handleReviewPass(p.id)}
                    >
                      {reviewPassId === p.id ? 'Hide' : 'Review'}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.comparison.map(row => {
                const counts = Object.values(row.counts);
                const mismatch = new Set(counts).size > 1;
                return (
                  <tr key={row.candidate_id}>
                    <td style={styles.td}>{row.candidate_name}</td>
                    {data.passes.map(p => (
                      <td
                        key={p.pass_number}
                        style={{
                          ...styles.td,
                          ...styles.countCell,
                          background: mismatch ? '#fef2f2' : '#f0fdf4',
                          color: mismatch ? '#dc2626' : '#166534',
                          fontWeight: 700,
                        }}
                      >
                        {row.counts[p.pass_number] ?? '-'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ballot-Level Comparison Table */}
      {data.passes.length >= 1 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={styles.btnPrimary} onClick={handleToggleBallotTable}>
              {showBallotTable ? 'Hide Ballot Table' : 'Show Ballot-Level Comparison'}
            </button>
            {showBallotTable && data.passes.length > 2 && (
              <>
                <span style={{ fontSize: '0.82rem', color: '#666' }}>Compare:</span>
                <select style={styles.input} value={comparePass1 || ''} onChange={e => setComparePass1(parseInt(e.target.value))}>
                  {data.passes.map(p => <option key={p.pass_number} value={p.pass_number}>Pass {p.pass_number}</option>)}
                </select>
                <span style={{ fontSize: '0.82rem', color: '#666' }}>vs</span>
                <select style={styles.input} value={comparePass2 || ''} onChange={e => setComparePass2(parseInt(e.target.value))}>
                  {data.passes.map(p => <option key={p.pass_number} value={p.pass_number}>Pass {p.pass_number}</option>)}
                </select>
              </>
            )}
          </div>

          {showBallotTable && (() => {
            const selectedPasses = [comparePass1, comparePass2].filter(Boolean);
            const snMap = {};
            for (const [passNum, ballots] of Object.entries(allPassBallots)) {
              if (selectedPasses.length > 0 && !selectedPasses.includes(parseInt(passNum))) continue;
              for (const b of ballots) {
                if (!snMap[b.serial_number]) snMap[b.serial_number] = {};
                snMap[b.serial_number][passNum] = { candidate: b.candidate_name, confidence: b.omr_confidence, method: b.omr_method };
              }
            }
            const passNums = selectedPasses.length > 0 ? selectedPasses : data.passes.map(p => p.pass_number);

            // Build rows with computed fields for filtering
            const allRows = Object.keys(snMap).sort().map(sn => {
              const row = snMap[sn];
              const votes = passNums.map(n => row[n]?.candidate).filter(Boolean);
              const confs = passNums.map(n => row[n]?.confidence).filter(c => c != null);
              const sameResult = new Set(votes).size <= 1;
              const confDiff = confs.length >= 2 ? Math.abs(confs[0] - confs[1]) * 100 : 0;
              const significantDiff = confDiff > 20;
              const wasCorrected = passNums.some(n => row[n]?.method === 'manual_correction');
              return { sn, row, votes, confs, sameResult, confDiff, significantDiff, wasCorrected };
            });

            // Apply filters
            let filtered = allRows;
            if (tableSearch) {
              filtered = filtered.filter(r => r.sn.includes(tableSearch.toUpperCase()));
            }
            if (tableFilter === 'mismatch') filtered = filtered.filter(r => !r.sameResult);
            else if (tableFilter === 'confDiff') filtered = filtered.filter(r => r.significantDiff);
            else if (tableFilter === 'corrected') filtered = filtered.filter(r => r.wasCorrected);

            const mismatchCount = allRows.filter(r => !r.sameResult).length;
            const confDiffCount = allRows.filter(r => r.significantDiff).length;
            const correctedCount = allRows.filter(r => r.wasCorrected).length;

            return (
              <div style={{ marginTop: '0.75rem' }}>
                {/* Filters */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <input
                    style={{ ...styles.input, width: 150, fontFamily: 'monospace', textTransform: 'uppercase', fontSize: '0.82rem' }}
                    placeholder="Search SN..."
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                  />
                  <button style={{ ...styles.btnSmall, background: tableFilter === 'all' ? '#2563eb' : '#e5e7eb', color: tableFilter === 'all' ? '#fff' : '#374151' }}
                    onClick={() => setTableFilter('all')}>All ({allRows.length})</button>
                  <button style={{ ...styles.btnSmall, background: tableFilter === 'mismatch' ? '#dc2626' : '#e5e7eb', color: tableFilter === 'mismatch' ? '#fff' : '#374151' }}
                    onClick={() => setTableFilter(tableFilter === 'mismatch' ? 'all' : 'mismatch')}>Mismatch ({mismatchCount})</button>
                  <button style={{ ...styles.btnSmall, background: tableFilter === 'confDiff' ? '#f59e0b' : '#e5e7eb', color: tableFilter === 'confDiff' ? '#fff' : '#374151' }}
                    onClick={() => setTableFilter(tableFilter === 'confDiff' ? 'all' : 'confDiff')}>Conf. Diff ({confDiffCount})</button>
                  <button style={{ ...styles.btnSmall, background: tableFilter === 'corrected' ? '#3730a3' : '#e5e7eb', color: tableFilter === 'corrected' ? '#fff' : '#374151' }}
                    onClick={() => setTableFilter(tableFilter === 'corrected' ? 'all' : 'corrected')}>Corrected ({correctedCount})</button>
                </div>

                {/* Scrollable table window */}
                <div style={{ maxHeight: 280, overflowY: 'auto', overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table style={{ ...styles.table, marginTop: 0 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                    <tr>
                      <th style={styles.th}>#</th>
                      <th style={styles.th}>Serial Number</th>
                      {passNums.map(n => (
                        <React.Fragment key={n}>
                          <th style={styles.th}>Pass {n} Vote</th>
                          <th style={styles.th}>Pass {n} Conf.</th>
                        </React.Fragment>
                      ))}
                      <th style={styles.th}>Conf. Diff</th>
                      <th style={styles.th}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      let rowBg = '';
                      if (!r.sameResult) rowBg = '#fef2f2';
                      else if (r.significantDiff) rowBg = '#fffbeb';

                      return (
                        <tr key={r.sn} style={{ background: rowBg }}>
                          <td style={styles.td}>{i + 1}</td>
                          <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem' }}>
                            <a href="#review" style={{ color: '#2563eb', textDecoration: 'none', cursor: 'pointer' }}
                              onClick={async (e) => {
                                e.preventDefault();
                                const firstPassId = data.passes[0]?.id;
                                if (!firstPassId) return;
                                if (reviewPassId !== firstPassId) {
                                  await handleReviewPass(firstPassId);
                                }
                                const idx = (reviewPassId === firstPassId ? reviewBallots : []).findIndex(b => b.serial_number === r.sn);
                                if (idx >= 0) {
                                  setReviewIndex(idx);
                                } else {
                                  try {
                                    const { data: ballots } = await api.get(`/admin/passes/${firstPassId}/ballots`);
                                    const foundIdx = ballots.findIndex(b => b.serial_number === r.sn);
                                    setReviewBallots(ballots);
                                    setReviewPassId(firstPassId);
                                    setReviewIndex(foundIdx >= 0 ? foundIdx : 0);
                                    const byPass = {};
                                    for (const p of data.passes) {
                                      try {
                                        const { data: pb } = await api.get(`/admin/passes/${p.id}/ballots`);
                                        byPass[p.pass_number] = pb;
                                      } catch { byPass[p.pass_number] = []; }
                                    }
                                    setAllPassBallots(byPass);
                                  } catch {}
                                }
                              }}
                            >{r.sn}</a>
                            {r.wasCorrected && (
                              <span style={{ marginLeft: '0.35rem', background: '#e0e7ff', color: '#3730a3', padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700, verticalAlign: 'middle' }}>
                                CORRECTED
                              </span>
                            )}
                          </td>
                          {passNums.map(n => {
                            const d = r.row[n];
                            return (
                              <React.Fragment key={n}>
                                <td style={{ ...styles.td, fontWeight: 600, fontSize: '0.85rem', color: !r.sameResult ? '#dc2626' : '#374151' }}>
                                  {d?.candidate || '—'}
                                </td>
                                <td style={{ ...styles.td, fontSize: '0.8rem', color: d?.confidence > 0.5 ? '#16a34a' : d?.confidence > 0.2 ? '#f59e0b' : '#dc2626' }}>
                                  {d?.confidence != null ? `${(d.confidence * 100).toFixed(1)}%` : '—'}
                                </td>
                              </React.Fragment>
                            );
                          })}
                          <td style={{ ...styles.td, fontWeight: 600, fontSize: '0.85rem', color: r.significantDiff ? '#f59e0b' : '#6b7280' }}>
                            {r.confs.length >= 2 ? `${r.confDiff.toFixed(1)}%` : '—'}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem',
                              background: r.sameResult ? '#dcfce7' : '#fee2e2',
                              color: r.sameResult ? '#166534' : '#dc2626',
                            }}>
                              {r.sameResult ? 'Yes' : 'No'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                  Showing {filtered.length} of {allRows.length} ballots
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Ballot Review Panel */}
      {reviewPassId && (
        <div style={styles.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>Ballot Review</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {data.passes.length > 2 && (
                <>
                  <span style={{ fontSize: '0.82rem', color: '#666' }}>Comparing:</span>
                  <select style={{ ...styles.input, fontSize: '0.8rem', padding: '0.2rem' }} value={comparePass1 || ''} onChange={e => { setComparePass1(parseInt(e.target.value)); }}>
                    {data.passes.map(p => <option key={p.pass_number} value={p.pass_number}>Pass {p.pass_number}</option>)}
                  </select>
                  <span style={{ fontSize: '0.82rem', color: '#666' }}>vs</span>
                  <select style={{ ...styles.input, fontSize: '0.8rem', padding: '0.2rem' }} value={comparePass2 || ''} onChange={e => { setComparePass2(parseInt(e.target.value)); }}>
                    {data.passes.map(p => <option key={p.pass_number} value={p.pass_number}>Pass {p.pass_number}</option>)}
                  </select>
                </>
              )}
              <button style={styles.btnSmall} onClick={() => setReviewPassId(null)}>Close</button>
            </div>
          </div>

          {loadingBallots && <p>Loading ballots...</p>}

          {!loadingBallots && reviewBallots.length > 0 && (() => {
            const b = reviewBallots[reviewIndex];
            const imgSrc = b.image_path ? `/data/scans/${b.image_path.replace(/^\/app\/data\/scans\//, '')}` : null;
            const selectedPasses = [comparePass1, comparePass2].filter(Boolean);
            const passNums = selectedPasses.length >= 2 ? selectedPasses : data.passes.map(p => p.pass_number);

            // Find this SN's data across selected passes
            const passData = {};
            for (const [pn, ballots] of Object.entries(allPassBallots)) {
              if (selectedPasses.length >= 2 && !selectedPasses.includes(parseInt(pn))) continue;
              const match = ballots.find(x => x.serial_number === b.serial_number);
              if (match) passData[pn] = match;
            }
            const votes = Object.values(passData).map(d => d.candidate_name).filter(Boolean);
            const confs = Object.values(passData).map(d => d.omr_confidence).filter(c => c != null);
            const sameResult = new Set(votes).size <= 1;
            const confDiff = confs.length >= 2 ? Math.abs(confs[0] - confs[1]) * 100 : 0;
            const significantDiff = confDiff > 20;

            // Status bar color: green = match, yellow = significant conf diff, red = different votes
            let statusColor = '#16a34a'; // green
            let statusBg = '#dcfce7';
            let statusText = 'Passes Agree';
            if (!sameResult) {
              statusColor = '#dc2626'; statusBg = '#fee2e2'; statusText = 'DIFFERENT RESULTS';
            } else if (significantDiff) {
              statusColor = '#f59e0b'; statusBg = '#fef3c7'; statusText = `Conf. Diff: ${confDiff.toFixed(1)}%`;
            }

            return (
              <div style={styles.reviewCard}>
                {/* Navigation */}
                <div style={styles.reviewNav}>
                  <button style={styles.btnNav} onClick={() => setReviewIndex(Math.max(0, reviewIndex - 1))} disabled={reviewIndex === 0}>
                    &larr; Prev
                  </button>
                  <span style={{ fontWeight: 600 }}>{reviewIndex + 1} of {reviewBallots.length}</span>
                  <button style={styles.btnNav} onClick={() => setReviewIndex(Math.min(reviewBallots.length - 1, reviewIndex + 1))} disabled={reviewIndex === reviewBallots.length - 1}>
                    Next &rarr;
                  </button>
                </div>

                {/* Status bar */}
                <div style={{ background: statusBg, color: statusColor, padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.9rem', textAlign: 'center' }}>
                  {statusText}
                </div>

                {/* SN */}
                <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
                  <span style={styles.reviewLabel}>Serial Number</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.2rem', marginLeft: '0.5rem' }}>{b.serial_number}</span>
                </div>

                {/* Per-pass comparison with change vote */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
                  {passNums.map(pn => {
                    const pd = passData[pn];
                    const isCurrentPass = data.passes.find(p => p.id === reviewPassId)?.pass_number === parseInt(pn);
                    return (
                      <div key={pn} style={{ flex: 1, padding: '0.5rem 1rem', borderRight: '1px solid #e5e7eb', background: isCurrentPass ? '#f9fafb' : '#fff' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                          Pass {pn}
                        </div>
                        {pd ? (
                          <>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: !sameResult ? '#dc2626' : '#1d4ed8' }}>
                              {pd.candidate_name}
                            </div>
                            <div style={{
                              fontSize: '0.85rem', fontWeight: 600,
                              color: pd.omr_confidence > 0.5 ? '#16a34a' : pd.omr_confidence > 0.2 ? '#f59e0b' : '#dc2626',
                            }}>
                              {pd.omr_confidence != null ? `${(pd.omr_confidence * 100).toFixed(1)}%` : 'manual'}
                            </div>
                            <select
                              style={{ marginTop: '0.35rem', padding: '0.25rem', fontSize: '0.8rem', border: '1px solid #d1d5db', borderRadius: 4, width: '100%' }}
                              value={pd.candidate_id}
                              onChange={async (e) => {
                                const newCandId = parseInt(e.target.value);
                                if (newCandId === pd.candidate_id) return;
                                let name = judgeName;
                                if (!name) {
                                  name = prompt('Enter your name to log this change:');
                                  if (!name) { e.target.value = pd.candidate_id; return; }
                                  setJudgeName(name);
                                }
                                const reason = prompt('Reason for change (optional):');
                                try {
                                  await api.put(`/admin/scans/${pd.scan_id}/change-vote`, {
                                    candidate_id: newCandId,
                                    changed_by: name,
                                    reason: reason || null,
                                  });
                                  handleReviewPass(reviewPassId);
                                  fetchComparison();
                                } catch (err) {
                                  alert('Failed to change vote: ' + (err.response?.data?.error || err.message));
                                  e.target.value = pd.candidate_id;
                                }
                              }}
                            >
                              {data.candidates.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <div style={{ color: '#9ca3af' }}>Not scanned</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Ballot image */}
                {imgSrc ? (
                  <img src={imgSrc} alt={`Ballot ${b.serial_number}`} style={styles.reviewImage} />
                ) : (
                  <div style={styles.reviewNoImage}>No image available</div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Mismatch Warning or Match Confirmation */}
      {!notEnoughPasses && (
        <div style={styles.section}>
          {data.hasMismatch ? (
            <div style={styles.mismatchBanner}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>Mismatch Detected</h3>
              <p>Pass counts do not match for one or more candidates. You may:</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button style={styles.btnWarning} onClick={() => setShowOverride(true)}>
                  Confirm Anyway (Override)
                </button>
                <button style={styles.btnPrimary} onClick={handleAddPass}>Add Another Pass</button>
              </div>
            </div>
          ) : (
            <div style={styles.matchBanner}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>Passes Match</h3>
              <p>All pass counts agree. Ready for confirmation.</p>
            </div>
          )}

          {/* Override Modal */}
          {showOverride && (
            <div style={styles.overrideBox}>
              <h3>Override Mismatch</h3>
              <p style={styles.muted}>Explain why you are confirming despite the mismatch:</p>
              <textarea
                style={{ ...styles.input, minHeight: 80, width: '100%', resize: 'vertical' }}
                placeholder="Notes are required..."
                value={overrideNotes}
                onChange={e => setOverrideNotes(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button style={styles.btnWarning} onClick={handleOverride} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Confirm Override'}
                </button>
                <button style={styles.btnSmall} onClick={() => setShowOverride(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Normal Confirm */}
          {!data.hasMismatch && !showOverride && (
            <div style={styles.confirmBox}>
              <h3 style={{ marginBottom: '0.5rem' }}>Do you confirm these results?</h3>
              <input
                style={styles.input}
                placeholder="Your name"
                value={judgeName}
                onChange={e => setJudgeName(e.target.value)}
              />
              <button
                style={{ ...styles.btnConfirm, opacity: submitting ? 0.6 : 1 }}
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? 'Confirming...' : 'Confirm Results'}
              </button>
            </div>
          )}

          {/* Name input for override path */}
          {showOverride && (
            <div style={{ marginTop: '0.75rem' }}>
              <input
                style={styles.input}
                placeholder="Your name"
                value={judgeName}
                onChange={e => setJudgeName(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {error && <p style={styles.errorMsg}>{error}</p>}
    </ElectionLayout>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  section: { marginTop: '1.5rem' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' },
  th: { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #e5e7eb', fontSize: '0.85rem', fontWeight: 700 },
  td: { padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb' },
  countCell: { textAlign: 'center', fontSize: '1.1rem' },
  warningBanner: { background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  mismatchBanner: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem' },
  matchBanner: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem' },
  overrideBox: { background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '1rem', marginTop: '1rem' },
  confirmBox: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnConfirm: { padding: '0.6rem 1.2rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 },
  btnWarning: { padding: '0.5rem 1rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  btnSmall: { padding: '0.3rem 0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  btnReview: { marginLeft: '0.5rem', padding: '0.15rem 0.5rem', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 },
  reviewCard: { marginTop: '1rem', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  reviewNav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' },
  btnNav: { padding: '0.5rem 1.25rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  reviewInfo: { display: 'flex', gap: '2rem', padding: '0.75rem 1rem', background: '#f0fdf4', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' },
  reviewInfoItem: { display: 'flex', flexDirection: 'column', gap: '0.1rem' },
  reviewLabel: { fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' },
  reviewImage: { width: '100%', maxHeight: 600, objectFit: 'contain', display: 'block' },
  reviewNoImage: { padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '1rem' },
  errorMsg: { color: '#dc2626', marginTop: '0.75rem', fontWeight: 600 },
  muted: { color: '#666', fontSize: '0.9rem' },
};
