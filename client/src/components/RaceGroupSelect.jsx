import { useState } from 'react';
import { buildGroupOptions, normalizeGroup, DEFAULT_GROUP } from '../utils/raceGroups';

// Dropdown of preconfigured + existing custom groups, with a "+ New custom group..."
// option that swaps to a free-text input.
//
// Props:
//   value: current group string (defaults to "Other")
//   onChange: (newGroup: string) => void
//   existing: array of races (or strings) used to seed the dropdown with custom groups
//             that other races already use, so a user only types a custom name once.
export default function RaceGroupSelect({ value, onChange, existing = [], style }) {
  const current = normalizeGroup(value);
  const options = buildGroupOptions([...(existing || []), current]);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

  if (customMode) {
    return (
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', ...style }}>
        <input
          autoFocus
          style={{ ...inputStyle, flex: 1 }}
          placeholder="New group name"
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = customDraft.trim();
              if (v) onChange(v);
              setCustomMode(false);
              setCustomDraft('');
            } else if (e.key === 'Escape') {
              setCustomMode(false);
              setCustomDraft('');
            }
          }}
        />
        <button
          type="button"
          style={btnSmallStyle}
          onClick={() => {
            const v = customDraft.trim();
            if (v) onChange(v);
            setCustomMode(false);
            setCustomDraft('');
          }}
        >
          Add
        </button>
        <button
          type="button"
          style={btnSmallStyle}
          onClick={() => { setCustomMode(false); setCustomDraft(''); }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__custom__') {
          setCustomMode(true);
          setCustomDraft('');
        } else {
          onChange(v || DEFAULT_GROUP);
        }
      }}
      style={{ ...inputStyle, ...style }}
    >
      {options.map((g) => (
        <option key={g} value={g}>{g}</option>
      ))}
      <option value="__custom__">+ New custom group…</option>
    </select>
  );
}

const inputStyle = {
  padding: '0.4rem 0.6rem',
  fontSize: '0.9rem',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  background: '#fff',
};

const btnSmallStyle = {
  padding: '0.3rem 0.6rem',
  fontSize: '0.82rem',
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  borderRadius: 4,
  cursor: 'pointer',
};
