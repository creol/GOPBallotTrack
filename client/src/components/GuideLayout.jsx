import { useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import AppHeader from './AppHeader';

const GUIDE_LINKS = [
  { to: '/admin/guides/admin-quickstart', label: 'Admin Quick Start', icon: '✓' },
  { to: '/admin/guides/scan-station',     label: 'Scan Station Guide', icon: '⌨' },
  { to: '/admin/guides/faq',              label: 'Convention FAQ', icon: '?' },
];

export default function GuideLayout({ eyebrow, title, subtitle, audience, accent = '#2563eb', sections, children }) {
  const location = useLocation();
  const [active, setActive] = useState(sections?.[0]?.id);
  const contentRef = useRef(null);

  // Highlight the active TOC item as the user scrolls.
  useEffect(() => {
    if (!sections || !sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 1] }
    );
    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div style={s.container}>
      <AppHeader title="BallotTrack" />

      {/* Print-only header */}
      <div style={s.printHeader} className="print-only">
        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>{title}</h1>
        {subtitle && <p style={{ margin: '0.25rem 0 0', color: '#666' }}>{subtitle}</p>}
      </div>

      <div style={s.layout} data-guide-layout>
        {/* Left rail — guides nav */}
        <nav style={s.sidebar} data-guide-sidebar>
          <Link to="/admin" style={s.backLink}>← Back to Admin</Link>

          <div style={s.sectionLabel}>Convention Guides</div>
          {GUIDE_LINKS.map(link => {
            const isActive = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                style={{ ...s.navItem, ...(isActive ? s.navItemActive : {}) }}
              >
                <span style={s.navIcon}>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}

          {sections && sections.length > 0 && (
            <>
              <div style={s.divider} />
              <div style={s.sectionLabel}>On This Page</div>
              <div style={s.toc}>
                {sections.map(sec => (
                  <a
                    key={sec.id}
                    href={`#${sec.id}`}
                    style={{
                      ...s.tocItem,
                      ...(active === sec.id ? s.tocItemActive : {}),
                      paddingLeft: sec.depth === 2 ? '1.5rem' : '0.5rem',
                      fontSize: sec.depth === 2 ? '0.78rem' : '0.82rem',
                    }}
                  >
                    {sec.label}
                  </a>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* Content */}
        <div style={s.contentWrap} ref={contentRef}>
          <div style={{ ...s.hero, borderLeft: `5px solid ${accent}` }}>
            {eyebrow && <div style={{ ...s.eyebrow, color: accent }}>{eyebrow}</div>}
            <h1 style={s.heroTitle}>{title}</h1>
            {subtitle && <p style={s.heroSubtitle}>{subtitle}</p>}
            <div style={s.heroMeta}>
              {audience && <span style={s.audienceBadge}>{audience}</span>}
              <button style={s.printBtn} onClick={() => window.print()}>🖨 Print</button>
            </div>
          </div>

          <article style={s.article}>{children}</article>
        </div>
      </div>
    </div>
  );
}

/* ---------- shared content primitives ---------- */

export function Section({ id, title, depth = 1, children }) {
  const Heading = depth === 2 ? 'h3' : 'h2';
  return (
    <section id={id} style={depth === 2 ? s.subSection : s.section}>
      <Heading style={depth === 2 ? s.subHeading : s.heading}>
        <a href={`#${id}`} style={s.anchor} aria-label="Link to section">#</a>
        {title}
      </Heading>
      {children}
    </section>
  );
}

export function Step({ n, title, children }) {
  return (
    <div style={s.step}>
      <div style={s.stepNum}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={s.stepTitle}>{title}</h4>
        <div style={s.stepBody}>{children}</div>
      </div>
    </div>
  );
}

const CALLOUT_STYLES = {
  info:    { border: '#bfdbfe', bg: '#eff6ff', accent: '#2563eb', icon: 'ℹ' },
  warning: { border: '#fde68a', bg: '#fffbeb', accent: '#b45309', icon: '⚠' },
  danger:  { border: '#fecaca', bg: '#fef2f2', accent: '#b91c1c', icon: '🛑' },
  success: { border: '#bbf7d0', bg: '#f0fdf4', accent: '#15803d', icon: '✓' },
  tip:     { border: '#ddd6fe', bg: '#f5f3ff', accent: '#6d28d9', icon: '💡' },
};

export function Callout({ kind = 'info', title, children }) {
  const c = CALLOUT_STYLES[kind] || CALLOUT_STYLES.info;
  return (
    <div style={{
      borderLeft: `4px solid ${c.accent}`, background: c.bg, border: `1px solid ${c.border}`,
      borderLeftWidth: 4, borderRadius: 6, padding: '0.75rem 1rem', margin: '1rem 0',
    }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>{c.icon}</span>
        <div style={{ flex: 1 }}>
          {title && <div style={{ fontWeight: 700, color: c.accent, marginBottom: '0.25rem' }}>{title}</div>}
          <div style={{ color: '#374151', fontSize: '0.9rem', lineHeight: 1.55 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Pill({ kind = 'neutral', children }) {
  const palette = {
    neutral: { bg: '#f3f4f6', fg: '#374151' },
    blue:    { bg: '#dbeafe', fg: '#1e40af' },
    green:   { bg: '#dcfce7', fg: '#166534' },
    amber:   { bg: '#fef3c7', fg: '#92400e' },
    red:     { bg: '#fee2e2', fg: '#991b1b' },
    purple:  { bg: '#ede9fe', fg: '#5b21b6' },
    indigo:  { bg: '#e0e7ff', fg: '#3730a3' },
  };
  const p = palette[kind] || palette.neutral;
  return (
    <span style={{
      background: p.bg, color: p.fg, padding: '2px 8px', borderRadius: 999,
      fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
      display: 'inline-block', lineHeight: 1.5,
    }}>{children}</span>
  );
}

export function Kbd({ children }) {
  return (
    <kbd style={{
      background: '#f9fafb', border: '1px solid #d1d5db', borderBottomWidth: 2,
      borderRadius: 4, padding: '1px 6px', fontSize: '0.78rem',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#374151',
    }}>{children}</kbd>
  );
}

export function Table({ headers, rows }) {
  return (
    <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
      <table style={s.table}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
              {row.map((cell, j) => <td key={j} style={s.td}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- styles ---------- */

const s = {
  container: { maxWidth: 1280, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: '#1f2937' },
  layout: { display: 'flex', gap: '2rem', alignItems: 'flex-start' },
  sidebar: {
    width: 240, flexShrink: 0, position: 'sticky', top: '1rem',
    maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto',
    paddingRight: '0.5rem',
  },
  backLink: {
    display: 'inline-block', fontSize: '0.8rem', color: '#6b7280',
    textDecoration: 'none', padding: '0.4rem 0.5rem', marginBottom: '0.5rem',
  },
  sectionLabel: {
    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: '#9ca3af',
    padding: '0.75rem 0.5rem 0.35rem',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.55rem 0.75rem', textDecoration: 'none',
    color: '#374151', fontSize: '0.88rem',
    borderRadius: 6, borderLeft: '3px solid transparent', marginLeft: -3,
  },
  navItemActive: {
    background: '#eff6ff', color: '#1d4ed8', fontWeight: 600,
    borderLeft: '3px solid #2563eb',
  },
  navIcon: {
    width: 22, height: 22, borderRadius: '50%',
    background: '#f3f4f6', color: '#6b7280',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
  },
  divider: { height: 1, background: '#e5e7eb', margin: '0.5rem 0' },
  toc: { display: 'flex', flexDirection: 'column', gap: '1px' },
  tocItem: {
    display: 'block', padding: '0.3rem 0.5rem',
    color: '#6b7280', textDecoration: 'none',
    borderLeft: '2px solid transparent', marginLeft: -2,
    lineHeight: 1.35,
  },
  tocItemActive: {
    color: '#1d4ed8', fontWeight: 600, borderLeft: '2px solid #2563eb',
  },

  contentWrap: { flex: 1, minWidth: 0, maxWidth: 820 },
  hero: {
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
    border: '1px solid #e5e7eb',
    padding: '1.5rem 1.75rem',
    borderRadius: 10,
    marginBottom: '1.5rem',
  },
  eyebrow: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' },
  heroTitle: { margin: 0, fontSize: '1.85rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 },
  heroSubtitle: { margin: '0.5rem 0 0', color: '#475569', fontSize: '1rem', lineHeight: 1.5 },
  heroMeta: { display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' },
  audienceBadge: {
    background: '#1e293b', color: '#fff', padding: '4px 12px', borderRadius: 999,
    fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  printBtn: {
    background: '#fff', border: '1px solid #d1d5db', color: '#374151',
    padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
    marginLeft: 'auto',
  },

  article: { fontSize: '0.95rem', lineHeight: 1.6, color: '#1f2937' },
  section: { marginTop: '2rem', marginBottom: '0.5rem', scrollMarginTop: '1.5rem' },
  subSection: { marginTop: '1.5rem', marginBottom: '0.5rem', scrollMarginTop: '1.5rem' },
  heading: { fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.4rem', position: 'relative' },
  subHeading: { fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', marginTop: '1.25rem', marginBottom: '0.5rem', position: 'relative' },
  anchor: { position: 'absolute', left: '-1.25rem', color: '#cbd5e1', textDecoration: 'none', fontWeight: 400 },

  step: {
    display: 'flex', gap: '1rem', alignItems: 'flex-start',
    padding: '1rem', margin: '0.75rem 0',
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
    transition: 'border-color 150ms',
  },
  stepNum: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: '0.95rem', flexShrink: 0,
    boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
  },
  stepTitle: { margin: '0 0 0.4rem', fontSize: '1rem', fontWeight: 700, color: '#0f172a' },
  stepBody: { fontSize: '0.9rem', lineHeight: 1.55, color: '#374151' },

  table: { borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' },
  th: { textAlign: 'left', padding: '0.55rem 0.75rem', background: '#f3f4f6', fontWeight: 700, color: '#374151', borderBottom: '1px solid #e5e7eb', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '0.55rem 0.75rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', color: '#374151' },

  printHeader: { display: 'none' },
};

/* ---------- responsive + print CSS (injected once) ---------- */
if (typeof document !== 'undefined') {
  const id = 'guide-layout-styles';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = `
      .print-only { display: none; }
      [data-guide-layout] article p { margin: 0.6rem 0; }
      [data-guide-layout] article ul, [data-guide-layout] article ol { margin: 0.5rem 0; padding-left: 1.4rem; }
      [data-guide-layout] article li { margin: 0.25rem 0; }
      [data-guide-layout] article code { background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #b45309; }
      [data-guide-layout] article a { color: #2563eb; }
      [data-guide-layout] article strong { color: #0f172a; }
      html { scroll-behavior: smooth; }
      @media (max-width: 900px) {
        [data-guide-layout] { flex-direction: column !important; }
        [data-guide-sidebar] { position: static !important; width: 100% !important; max-height: none !important; border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem; margin-bottom: 1rem; }
      }
      @media print {
        [data-guide-sidebar] { display: none !important; }
        .print-only { display: block !important; }
        [data-guide-layout] > div { max-width: 100% !important; }
        button, a[href^="#"] { display: none !important; }
        body { font-size: 11pt; }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
