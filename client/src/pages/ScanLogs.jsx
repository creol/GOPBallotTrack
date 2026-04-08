import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import AppHeader from '../components/AppHeader';

const LEVEL_COLORS = {
  debug:   { bg: '#f3f4f6', color: '#6b7280', label: 'DEBUG' },
  info:    { bg: '#dbeafe', color: '#1e40af', label: 'INFO' },
  success: { bg: '#dcfce7', color: '#166534', label: 'OK' },
  warn:    { bg: '#fef3c7', color: '#92400e', label: 'WARN' },
  error:   { bg: '#fee2e2', color: '#dc2626', label: 'ERROR' },
};

const SOURCE_COLORS = {
  agent:   { bg: '#e0e7ff', color: '#3730a3' },
  server:  { bg: '#fce7f3', color: '#9d174d' },
};

function LevelBadge({ level }) {
  const c = LEVEL_COLORS[level] || LEVEL_COLORS.info;
  return <span style={{ ...s.badge, background: c.bg, color: c.color }}>{c.label}</span>;
}

function SourceBadge({ source }) {
  const type = source?.startsWith('agent') ? 'agent' : 'server';
  const c = SOURCE_COLORS[type];
  return <span style={{ ...s.badge, background: c.bg, color: c.color }}>{source}</span>;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function analyzeLogGroup(logs) {
  const analysis = [];
  const bySerial = {};
  let totalScans = 0, flagged = 0, errors = 0, successes = 0;

  for (const log of logs) {
    if (log.level === 'error') errors++;
    if (log.level === 'success') successes++;
    if (log.message.includes('flagged') || log.message.includes('FLAGGED')) flagged++;
    if (log.message.includes('START') || log.message.includes('Uploaded')) totalScans++;
    if (log.serial_number) {
      if (!bySerial[log.serial_number]) bySerial[log.serial_number] = [];
      bySerial[log.serial_number].push(log);
    }
  }

  if (totalScans > 0) analysis.push({ level: 'info', text: `${totalScans} scan operations` });
  if (successes > 0) analysis.push({ level: 'success', text: `${successes} successful` });
  if (flagged > 0) analysis.push({ level: 'warn', text: `${flagged} flagged for review` });
  if (errors > 0) analysis.push({ level: 'error', text: `${errors} errors` });

  // Detect patterns
  const slowScans = logs.filter(l => {
    const m = l.metadata?.elapsed_ms;
    return m && m > 5000;
  });
  if (slowScans.length > 0) {
    analysis.push({ level: 'warn', text: `${slowScans.length} slow scans (>5s)` });
  }

  const retries = logs.filter(l => l.message.includes('retrying') || l.message.includes('retry'));
  if (retries.length > 0) {
    analysis.push({ level: 'warn', text: `${retries.length} upload retries detected` });
  }

  const qrFails = logs.filter(l => l.message.includes('QR not found') || l.message.includes('qr_not_found'));
  if (qrFails.length > 0) {
    analysis.push({ level: 'error', text: `${qrFails.length} QR decode failures` });
  }

  const wrongStation = logs.filter(l => l.message.includes('wrong_station') || l.message.includes('wrong_round'));
  if (wrongStation.length > 0) {
    analysis.push({ level: 'warn', text: `${wrongStation.length} wrong-station/round scans` });
  }

  return analysis;
}

function AnalysisPanel({ logs, title }) {
  const analysis = analyzeLogGroup(logs);
  if (analysis.length === 0) return null;

  return (
    <div style={s.analysisPanel}>
      <div style={s.analysisTitle}>{title}</div>
      <div style={s.analysisList}>
        {analysis.map((a, i) => {
          const c = LEVEL_COLORS[a.level] || LEVEL_COLORS.info;
          return <span key={i} style={{ ...s.analysisBadge, background: c.bg, color: c.color }}>{a.text}</span>;
        })}
      </div>
    </div>
  );
}

function LogTable({ logs, onSerialClick }) {
  if (logs.length === 0) return <p style={s.muted}>No logs found.</p>;

  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Time</th>
            <th style={s.th}>Source</th>
            <th style={s.th}>Level</th>
            <th style={s.th}>Serial</th>
            <th style={s.th}>Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id} style={{ ...s.tr, background: log.level === 'error' ? '#fef2f2' : log.level === 'warn' ? '#fffbeb' : log.level === 'success' ? '#f0fdf4' : 'transparent' }}>
              <td style={s.td}>
                <span style={s.date}>{formatDate(log.created_at)}</span>{' '}
                <span style={s.time}>{formatTime(log.created_at)}</span>
              </td>
              <td style={s.td}><SourceBadge source={log.source} /></td>
              <td style={s.td}><LevelBadge level={log.level} /></td>
              <td style={s.td}>
                {log.serial_number ? (
                  <button style={s.snLink} onClick={() => onSerialClick(log.serial_number)}>
                    {log.serial_number}
                  </button>
                ) : <span style={s.muted}>—</span>}
              </td>
              <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchedView({ electionId, serial, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/elections/${electionId}/logs/matched?serial=${serial}`)
      .then(({ data }) => { setData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [electionId, serial]);

  if (loading) return <p>Loading matched logs...</p>;
  if (!data) return <p>Failed to load.</p>;

  const allLogs = [...(data.agent || []), ...(data.serverScan || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return (
    <div style={s.matchedPanel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Matched Logs: {serial}</h3>
        <button style={s.btnSmall} onClick={onClose}>Close</button>
      </div>
      <AnalysisPanel logs={allLogs} title="Scan Analysis" />
      <div style={s.matchedTimeline}>
        {allLogs.map((log, i) => {
          const c = LEVEL_COLORS[log.level] || LEVEL_COLORS.info;
          const isAgent = log.source?.startsWith('agent');
          return (
            <div key={i} style={{ ...s.timelineItem, borderLeft: `3px solid ${c.color}` }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={s.time}>{formatTime(log.created_at)}</span>
                <SourceBadge source={log.source} />
                <LevelBadge level={log.level} />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.message}</div>
            </div>
          );
        })}
        {allLogs.length === 0 && <p style={s.muted}>No logs found for this serial number.</p>}
      </div>
    </div>
  );
}

export default function ScanLogs() {
  const { id: electionId } = useParams();
  const [tab, setTab] = useState('agent');
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ level: '', serial: '' });
  const [matchedSerial, setMatchedSerial] = useState(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 200;

  const sourceMap = {
    agent: 'agent',
    serverScan: 'server:scan',
    serverGeneral: 'server:general',
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        source: sourceMap[tab],
        limit: LIMIT,
        offset,
      });
      if (filters.level) params.set('level', filters.level);
      if (filters.serial) params.set('serial', filters.serial);

      const { data } = await api.get(`/admin/elections/${electionId}/logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, [electionId, tab, offset, filters]);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/elections/${electionId}/logs/stats`);
      setStats(data);
    } catch {}
  }, [electionId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleCopy = () => {
    const text = logs.map(l =>
      `[${new Date(l.created_at).toISOString()}] [${l.source}] [${l.level.toUpperCase()}] ${l.serial_number ? `SN=${l.serial_number} ` : ''}${l.message}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  };

  const tabStyle = (t) => ({
    ...s.tab,
    ...(tab === t ? s.tabActive : {}),
  });

  return (
    <div style={s.container}>
      <AppHeader title="Scan Logs" />
      <Link to={`/admin/elections/${electionId}`} style={s.backLink}>&larr; Back to Election</Link>

      {/* Stats summary */}
      {stats && (
        <div style={s.statsRow}>
          {stats.stations.map((st, i) => (
            <div key={i} style={s.statCard}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{st.station_id || st.source}</div>
              <div style={s.muted}>{st.log_count} logs</div>
              <div style={s.muted}>Last: {formatTime(st.last_seen)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={s.tabBar}>
        <button style={tabStyle('agent')} onClick={() => { setTab('agent'); setOffset(0); }}>
          Agent Logs
        </button>
        <button style={tabStyle('serverScan')} onClick={() => { setTab('serverScan'); setOffset(0); }}>
          Server Scan Logs
        </button>
        <button style={tabStyle('serverGeneral')} onClick={() => { setTab('serverGeneral'); setOffset(0); }}>
          Server General
        </button>
        <div style={{ flex: 1 }} />
        <button style={s.btnSmall} onClick={handleCopy} title="Copy visible logs to clipboard">
          Copy to Clipboard
        </button>
        <button style={s.btnSmall} onClick={fetchLogs}>Refresh</button>
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <select style={s.select} value={filters.level} onChange={e => { setFilters(f => ({ ...f, level: e.target.value })); setOffset(0); }}>
          <option value="">All Levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <input
          style={s.input}
          placeholder="Filter by serial number..."
          value={filters.serial}
          onChange={e => { setFilters(f => ({ ...f, serial: e.target.value })); setOffset(0); }}
        />
        <span style={s.muted}>{total} total logs</span>
      </div>

      {/* Analysis */}
      {logs.length > 0 && (
        <AnalysisPanel logs={logs} title={`${tab === 'agent' ? 'Agent' : tab === 'serverScan' ? 'Server Scan' : 'Server'} Log Analysis`} />
      )}

      {/* Matched view */}
      {matchedSerial && (
        <MatchedView
          electionId={electionId}
          serial={matchedSerial}
          onClose={() => setMatchedSerial(null)}
        />
      )}

      {/* Log table */}
      {loading ? <p>Loading...</p> : (
        <LogTable logs={logs} onSerialClick={sn => setMatchedSerial(sn)} />
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div style={s.pagination}>
          <button style={s.btnSmall} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>
            Previous
          </button>
          <span style={s.muted}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button style={s.btnSmall} disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

const s = {
  container: { maxWidth: 1200, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  muted: { color: '#9ca3af', fontSize: '0.8rem' },
  tabBar: { display: 'flex', gap: '0.25rem', alignItems: 'center', borderBottom: '2px solid #e5e7eb', marginBottom: '1rem' },
  tab: { padding: '0.5rem 1rem', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500, color: '#6b7280', marginBottom: '-2px' },
  tabActive: { borderBottom: '2px solid #2563eb', color: '#2563eb', fontWeight: 700 },
  filterRow: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' },
  select: { padding: '0.35rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db', fontSize: '0.82rem' },
  input: { padding: '0.35rem 0.5rem', borderRadius: 4, border: '1px solid #d1d5db', fontSize: '0.82rem', flex: 1, maxWidth: 250 },
  btnSmall: { padding: '0.3rem 0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.02em' },
  tableWrap: { overflowX: 'auto', borderRadius: 6, border: '1px solid #e5e7eb' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: { textAlign: 'left', padding: '0.5rem 0.6rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.35rem 0.6rem', verticalAlign: 'top' },
  time: { fontFamily: 'monospace', fontSize: '0.75rem', color: '#374151' },
  date: { fontSize: '0.7rem', color: '#9ca3af' },
  snLink: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.78rem', textDecoration: 'underline', padding: 0 },
  statsRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' },
  statCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.5rem 0.75rem', minWidth: 120 },
  analysisPanel: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', marginBottom: '1rem' },
  analysisTitle: { fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: '#334155' },
  analysisList: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  analysisBadge: { padding: '3px 10px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  matchedPanel: { background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, padding: '1rem', marginBottom: '1rem' },
  matchedTimeline: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  timelineItem: { paddingLeft: '0.75rem', paddingBottom: '0.5rem' },
  pagination: { display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' },
};
