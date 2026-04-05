import { Link } from 'react-router-dom';

export default function Breadcrumb({ items }) {
  return (
    <nav style={s.nav}>
      {items.map((item, i) => (
        <span key={i} style={s.item}>
          {i > 0 && <span style={s.sep}>/</span>}
          {item.to ? (
            <Link to={item.to} style={s.link}>{item.label}</Link>
          ) : (
            <span style={s.current}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

const s = {
  nav: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.15rem', marginBottom: '1rem', fontSize: '0.85rem' },
  item: { display: 'inline-flex', alignItems: 'center' },
  sep: { color: '#9ca3af', margin: '0 0.35rem' },
  link: { color: '#2563eb', textDecoration: 'none' },
  current: { color: '#374151', fontWeight: 600 },
};
