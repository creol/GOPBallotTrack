// Truncate (never round) a percentage to at most `decimals` decimal places.
// Party rule: percentages on dashboards must never round up or down.
// Operates on the string form to avoid floating-point artifacts (e.g. 33.333 * 1000).
// `decimals` is clamped to 0..5; falsy/invalid values fall back to 3.
export function fmtPct(value, decimals = 3) {
  let d = Number(decimals);
  if (!Number.isFinite(d)) d = 3;
  d = Math.max(0, Math.min(5, Math.trunc(d)));

  if (value === null || value === undefined || value === '') return '0';
  const s = String(value);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intPart, decPart = ''] = body.split('.');
  const truncated = d > 0 ? decPart.slice(0, d).replace(/0+$/, '') : '';
  const out = truncated ? `${intPart}.${truncated}` : intPart;
  return neg && out !== '0' ? `-${out}` : out;
}
