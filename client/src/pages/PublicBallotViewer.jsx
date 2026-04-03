import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';

export default function PublicBallotViewer() {
  const { electionId, serialNumber } = useParams();
  const [data, setData] = useState(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    api.get(`/public/${electionId}/search?sn=${serialNumber}`)
      .then(({ data }) => setData(data))
      .catch(() => setData({ found: false, message: 'Ballot not found or results not yet released' }));
  }, [electionId, serialNumber]);

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
      <Link to={`/public/${electionId}/rounds/${data.round_id}`} style={styles.backLink}>
        &larr; Back to results
      </Link>

      <div style={styles.info}>
        <h2 style={{ margin: '0 0 0.25rem' }}>Ballot {data.serial_number}</h2>
        <p style={styles.muted}>{data.race_name} — Round {data.round_number}</p>
        <span style={styles.statusChip}>
          {data.ballot_status === 'counted' ? 'Counted' : data.ballot_status}
        </span>
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
    </div>
  );
}

const styles = {
  container: { maxWidth: 600, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  info: { marginBottom: '1rem' },
  statusChip: { display: 'inline-block', background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 },
  ballotImage: { width: '100%', borderRadius: 8, border: '1px solid #e5e7eb' },
  noImage: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '2rem', textAlign: 'center' },
  notFound: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '2rem', textAlign: 'center' },
  muted: { color: '#666', fontSize: '0.9rem' },
};
