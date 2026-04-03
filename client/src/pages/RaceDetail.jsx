import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

export default function RaceDetail() {
  const { id: electionId, raceId } = useParams();
  const [race, setRace] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [candidateName, setCandidateName] = useState('');
  const [paperColor, setPaperColor] = useState('');
  const [editing, setEditing] = useState(false);
  const [raceForm, setRaceForm] = useState({ name: '', threshold_type: '', threshold_value: '' });
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const fetchRace = async () => {
    const { data: races } = await api.get(`/admin/elections/${electionId}/races`);
    const found = races.find(r => r.id === parseInt(raceId));
    if (found) {
      setRace(found);
      setRaceForm({ name: found.name, threshold_type: found.threshold_type, threshold_value: found.threshold_value || '' });
    }
  };

  const fetchCandidates = async () => {
    // Get candidates via race — they're returned from reorder endpoint or we fetch via election races
    const { data: races } = await api.get(`/admin/elections/${electionId}/races`);
    const found = races.find(r => r.id === parseInt(raceId));
    if (!found) return;
    // We need a separate query — let's use the race candidates endpoint
    // Candidates are nested — we'll fetch from the election detail
    const { data: election } = await api.get(`/admin/elections/${electionId}`);
    // We need to get candidates separately. Let's add a simple fetch.
    // For now, use the races list approach — we'll query candidates via a helper
  };

  const fetchAll = async () => {
    const { data: election } = await api.get(`/admin/elections/${electionId}`);
    const found = election.races?.find(r => r.id === parseInt(raceId));
    if (found) {
      setRace(found);
      setRaceForm({ name: found.name, threshold_type: found.threshold_type, threshold_value: found.threshold_value || '' });
    }

    // Fetch candidates for this race
    try {
      const { data } = await api.get(`/admin/races/${raceId}/candidates`);
      setCandidates(data);
    } catch {
      // Fallback: endpoint might not exist yet, we'll create it
      setCandidates([]);
    }

    // Fetch rounds for this race
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

  const handleWithdraw = async (candidateId) => {
    if (!confirm('Withdraw this candidate?')) return;
    await api.put(`/admin/candidates/${candidateId}/withdraw`);
    fetchAll();
  };

  const handleCreateRound = async (e) => {
    e.preventDefault();
    if (!paperColor.trim()) return;
    await api.post(`/admin/races/${raceId}/rounds`, { paper_color: paperColor });
    setPaperColor('');
    fetchAll();
  };

  const handleUpdateRace = async (e) => {
    e.preventDefault();
    await api.put(`/admin/races/${raceId}`, {
      name: raceForm.name,
      threshold_type: raceForm.threshold_type,
      threshold_value: raceForm.threshold_value || null,
    });
    setEditing(false);
    fetchAll();
  };

  // Drag-to-reorder handlers
  const handleDragStart = (index) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index) => {
    dragOver.current = index;
  };

  const handleDragEnd = async () => {
    const items = [...candidates];
    const draggedItem = items[dragItem.current];
    items.splice(dragItem.current, 1);
    items.splice(dragOver.current, 0, draggedItem);
    dragItem.current = null;
    dragOver.current = null;
    setCandidates(items);

    // Persist order
    await api.put(`/admin/races/${raceId}/candidates/reorder`, {
      candidate_ids: items.map(c => c.id),
    });
  };

  if (!race) return <div style={styles.container}><p>Loading...</p></div>;

  const statusColor = { pending: '#f59e0b', scanning: '#3b82f6', confirmed: '#10b981', pending_release: '#8b5cf6', released: '#6366f1' };

  return (
    <div style={styles.container}>
      <Link to={`/admin/elections/${electionId}`} style={styles.backLink}>&larr; Back to Election</Link>

      {editing ? (
        <form onSubmit={handleUpdateRace} style={styles.form}>
          <input style={styles.input} value={raceForm.name} onChange={e => setRaceForm({ ...raceForm, name: e.target.value })} required />
          <select style={styles.input} value={raceForm.threshold_type} onChange={e => setRaceForm({ ...raceForm, threshold_type: e.target.value })}>
            <option value="majority">Majority</option>
            <option value="two_thirds">Two-Thirds</option>
            <option value="custom">Custom</option>
          </select>
          {raceForm.threshold_type === 'custom' && (
            <input style={styles.input} type="number" step="0.00001" placeholder="Threshold %" value={raceForm.threshold_value} onChange={e => setRaceForm({ ...raceForm, threshold_value: e.target.value })} />
          )}
          <button style={styles.btnPrimary} type="submit">Save</button>
          <button style={styles.btnSmall} type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <div style={styles.header}>
          <div>
            <h1>{race.name}</h1>
            <p style={styles.muted}>
              Threshold: {race.threshold_type === 'custom' ? `${race.threshold_value}%` : race.threshold_type.replace('_', ' ')}
            </p>
          </div>
          <button style={styles.btnSmall} onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}

      {/* Candidates Section */}
      <div style={styles.section}>
        <h2>Candidates</h2>
        <p style={styles.muted}>Drag to reorder</p>

        {candidates.map((c, index) => (
          <div
            key={c.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={e => e.preventDefault()}
            style={styles.candidateRow}
          >
            <span style={styles.dragHandle}>⠿</span>
            <span style={{ flex: 1, textDecoration: c.status === 'withdrawn' ? 'line-through' : 'none' }}>
              {c.name}
            </span>
            {c.status === 'withdrawn' ? (
              <span style={styles.withdrawnBadge}>Withdrawn</span>
            ) : (
              <button style={styles.btnDanger} onClick={() => handleWithdraw(c.id)}>Withdraw</button>
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

      {/* Rounds Section */}
      <div style={styles.section}>
        <h2>Rounds</h2>

        {rounds.length === 0 && <p style={styles.muted}>No rounds yet.</p>}
        {rounds.map(round => (
          <Link
            key={round.id}
            to={`/admin/elections/${electionId}/races/${raceId}/rounds/${round.id}`}
            style={styles.roundCard}
          >
            <span style={{ fontWeight: 600 }}>Round {round.round_number}</span>
            <span style={styles.muted}>Paper: {round.paper_color}</span>
            <span style={{ ...styles.statusBadge, background: statusColor[round.status] || '#999' }}>
              {round.status}
            </span>
          </Link>
        ))}

        <form onSubmit={handleCreateRound} style={{ ...styles.form, marginTop: '0.5rem' }}>
          <input
            style={styles.input}
            placeholder="Paper Color (e.g. White, Blue)"
            value={paperColor}
            onChange={e => setPaperColor(e.target.value)}
          />
          <button style={styles.btnPrimary} type="submit">Create Round</button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  form: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem' },
  section: { marginTop: '2rem' },
  candidateRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
    border: '1px solid #ddd', borderRadius: 6, marginBottom: '0.25rem',
    background: '#fafafa', cursor: 'grab',
  },
  dragHandle: { color: '#999', fontSize: '1.2rem', cursor: 'grab' },
  withdrawnBadge: { background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  roundCard: {
    display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem',
    border: '1px solid #ddd', borderRadius: 6, marginBottom: '0.5rem', background: '#fafafa',
    textDecoration: 'none', color: 'inherit',
  },
  statusBadge: { color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnSmall: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDanger: { padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
