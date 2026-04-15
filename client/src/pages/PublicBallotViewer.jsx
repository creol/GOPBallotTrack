import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { VersionTag } from '../components/AppHeader';

export default function PublicBallotViewer() {
  const { electionId, serialNumber } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
    api.get(`/public/${electionId}/search?sn=${serialNumber}`)
      .then(({ data }) => setData(data))
      .catch(() => setData({ found: false, message: 'Ballot not found or results not yet released' }));
  }, [electionId, serialNumber]);

  const goTo = (sn) => navigate(`/public/${electionId}/ballots/${sn}`);

  if (!data) return <div style={styles.container}><p>Loading...</p></div>;

  if (!data.found) {
    return (
      <div style={styles.container}>
        <Link to={`/public/${electionId}`} style={styles.backLink}>&larr; Back to Dashboard</Link>
        <div style={styles.notFound}>
          <h2>Ballot Not Found</h2>
          <p>{data.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <VersionTag />
      <Link to={`/public/${electionId}/rounds/${data.round_id}`} style={styles.backLink}>
        &larr; Back to results
      </Link>

      <div style={styles.info}>
        <h2 style={{ margin: '0 0 0.25rem' }}>Ballot {data.serial_number}</h2>
        <p style={styles.muted}>{data.race_name} — Round {data.round_number}</p>
        {data.ballot_status === 'spoiled' ? (
          <>
            <span style={styles.spoiledChip}>SPOILED — NOT COUNTED</span>
            {data.voted_for && (
              <p style={{ fontSize: '1rem', margin: '0.75rem 0 0', color: '#9ca3af', textDecoration: 'line-through' }}>
                Voted for: <strong>{data.voted_for}</strong>
              </p>
            )}
          </>
        ) : (
          <>
            <span style={styles.statusChip}>Counted</span>
            {data.voted_for && (
              <p style={styles.votedFor}>Voted for: <strong>{data.voted_for}</strong></p>
            )}
          </>
        )}
      </div>

      {/* Ballot Image */}
      {!imageError ? (
        <img
          src={`/api/public/${electionId}/ballots/${data.serial_number}`}
          alt={`Ballot ${data.serial_number}`}
          style={styles.ballotImage}
          onError={() => setImageError(true)}
        />
      ) : (
        <div style={styles.noImage}>
          <p>Ballot image not available</p>
          <p style={styles.muted}>The ballot was counted but the scanned image is not accessible.</p>
        </div>
      )}

      {/* Prev / Next navigation — hidden when browse is disabled */}
      {data.public_browse_enabled !== false && (
        <div style={styles.nav}>
          <button
            style={{ ...styles.navBtn, opacity: data.prev_sn ? 1 : 0.3 }}
            disabled={!data.prev_sn}
            onClick={() => goTo(data.prev_sn)}
          >
            &larr; Previous
          </button>
          <span style={styles.navCount}>
            {data.ballot_index} of {data.ballot_total}
          </span>
          <button
            style={{ ...styles.navBtn, opacity: data.next_sn ? 1 : 0.3 }}
            disabled={!data.next_sn}
            onClick={() => goTo(data.next_sn)}
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 600, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  info: { marginBottom: '1rem' },
  statusChip: { display: 'inline-block', background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 },
  spoiledChip: { display: 'inline-block', background: '#fee2e2', color: '#dc2626', padding: '4px 12px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700 },
  votedFor: { fontSize: '1.1rem', margin: '0.75rem 0 0', color: '#1e293b' },
  ballotImage: { width: '100%', borderRadius: 8, border: '1px solid #e5e7eb' },
  noImage: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '2rem', textAlign: 'center' },
  notFound: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '2rem', textAlign: 'center' },
  muted: { color: '#666', fontSize: '0.9rem' },
  nav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.75rem 0', borderTop: '1px solid #e5e7eb' },
  navBtn: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  navCount: { color: '#666', fontSize: '0.85rem' },
};
