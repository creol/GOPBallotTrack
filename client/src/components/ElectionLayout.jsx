import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import api from '../api/client';
import ElectionSidebar from './ElectionSidebar';
import Breadcrumb from './Breadcrumb';

export default function ElectionLayout({ children, breadcrumbs, electionId: propElectionId }) {
  const params = useParams();
  const electionId = propElectionId || params.id;
  const [races, setRaces] = useState([]);
  const location = useLocation();

  useEffect(() => {
    if (!electionId) return;
    api.get(`/admin/elections/${electionId}`).then(({ data }) => {
      setRaces(data.races || []);
    }).catch(() => {});
  }, [electionId]);

  const basePath = `/admin/elections/${electionId}`;

  return (
    <div style={s.container}>
      {breadcrumbs && <Breadcrumb items={breadcrumbs} />}

      {/* Mobile nav — visible only on small screens */}
      <nav style={s.mobileNav} data-election-mobilenav>
        <Link to={basePath} style={{ ...s.mobileTab, textDecoration: 'none' }}>Overview</Link>
        <Link to={`${basePath}?section=ballots`} style={{ ...s.mobileTab, textDecoration: 'none' }}>Ballots</Link>
        <Link to={`${basePath}?section=boxes`} style={{ ...s.mobileTab, textDecoration: 'none' }}>Boxes</Link>
        <Link to={`${basePath}?section=export`} style={{ ...s.mobileTab, textDecoration: 'none' }}>Export</Link>
        <Link to={`${basePath}?section=dashboards`} style={{ ...s.mobileTab, textDecoration: 'none' }}>Dashboards</Link>
      </nav>

      <div style={s.layout} data-election-layout>
        {electionId && <ElectionSidebar electionId={electionId} />}
        <div style={s.content} data-election-content>
          {children}
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { maxWidth: 1200, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  layout: { display: 'flex', gap: '1.5rem', alignItems: 'flex-start' },
  content: { flex: 1, minWidth: 0 },
  mobileNav: {
    display: 'none', overflowX: 'auto', gap: '0.25rem', padding: '0.25rem 0',
    borderBottom: '1px solid #e5e7eb', marginBottom: '1rem',
  },
  mobileTab: {
    padding: '0.5rem 0.75rem', background: 'none', border: 'none', borderBottom: '2px solid transparent',
    fontSize: '0.82rem', color: '#6b7280', whiteSpace: 'nowrap', cursor: 'pointer',
  },
  mobileTabActive: {
    borderBottom: '2px solid #2563eb', color: '#2563eb', fontWeight: 600,
  },
};

// Inject responsive CSS
if (typeof document !== 'undefined') {
  const id = 'election-layout-responsive';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = `
      @media (max-width: 768px) {
        [data-election-sidebar] { display: none !important; }
        [data-election-mobilenav] { display: flex !important; }
        [data-election-layout] { flex-direction: column !important; }
      }
      @media (min-width: 769px) {
        [data-election-mobilenav] { display: none !important; }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
