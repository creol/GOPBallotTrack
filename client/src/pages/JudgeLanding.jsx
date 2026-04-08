import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';

export default function JudgeLanding({ onLogout }) {
  const navigate = useNavigate();

  return (
    <div style={styles.wrapper}>
      <AppHeader title="Election Judge" />
      <div style={styles.card}>
        <h1 style={styles.title}>Election Event Judge</h1>
        <p style={styles.description}>
          As an Election Event Judge, you confirm round results and handle mismatch overrides.
          You do not have access to the Admin dashboard — election event setup is managed by the Admin or Chair.
        </p>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>What you can do</h3>
          <ul style={styles.list}>
            <li>Review pass comparisons and confirm round results</li>
            <li>Override mismatches with required notes</li>
            <li>Delete passes started in error (before confirmation)</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>How to access</h3>
          <p style={styles.description}>
            The Admin or Chair will share a direct link to the confirmation page for each round
            when it is ready for your review. The link will look like:
          </p>
          <code style={styles.code}>/admin/elections/:id/races/:raceId/rounds/:roundId/confirm</code>
        </div>

        {onLogout && (
          <button style={styles.btnLogout} onClick={onLogout}>Logout</button>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', borderRadius: 12, padding: '2.5rem', width: '100%', maxWidth: 500, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { margin: '0 0 0.75rem', textAlign: 'center', fontSize: '1.75rem' },
  description: { color: '#4b5563', fontSize: '0.95rem', lineHeight: 1.5 },
  section: { marginTop: '1.5rem' },
  sectionTitle: { margin: '0 0 0.5rem', fontSize: '1rem' },
  list: { color: '#4b5563', fontSize: '0.95rem', lineHeight: 1.7, paddingLeft: '1.25rem' },
  code: { display: 'block', background: '#f3f4f6', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'monospace', marginTop: '0.5rem', color: '#374151', wordBreak: 'break-all' },
  btnLogout: { marginTop: '2rem', width: '100%', padding: '0.6rem', background: '#e5e7eb', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.95rem', color: '#374151' },
};
