import { useAuth } from '../context/AuthContext';
import { APP_VERSION } from '../version';

const roleLabels = {
  super_admin: 'Super Admin',
  race_admin: 'Race Admin',
};

/**
 * Shared header bar for all authenticated pages.
 * Shows: page title (optional), user name, role badge, logout button, version.
 *
 * For public/unauthenticated pages, use <VersionTag /> instead.
 */
export default function AppHeader({ title }) {
  const { auth, onLogout } = useAuth();

  return (
    <div style={s.topBar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {title && <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h1>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={s.version}>v{APP_VERSION}</span>
        {auth?.name && <span style={s.userInfo}>{auth.name}</span>}
        {auth?.role && <span style={s.roleBadge}>{roleLabels[auth.role] || auth.role}</span>}
        {onLogout && auth?.role && <button style={s.btnLogout} onClick={onLogout}>Logout</button>}
      </div>
    </div>
  );
}

/**
 * Tiny version tag for public/unauthenticated pages.
 */
export function VersionTag() {
  return <span style={s.versionFloat}>v{APP_VERSION}</span>;
}

const s = {
  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e5e7eb',
  },
  userInfo: { fontSize: '0.85rem', fontWeight: 600, color: '#374151' },
  roleBadge: { background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600 },
  btnLogout: { padding: '0.25rem 0.5rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  version: { fontSize: '0.6rem', color: '#9ca3af' },
  versionFloat: { position: 'fixed', bottom: 4, right: 8, fontSize: '0.55rem', color: '#9ca3af', pointerEvents: 'none', zIndex: 9999 },
};
