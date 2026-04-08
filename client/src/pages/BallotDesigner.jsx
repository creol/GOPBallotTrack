import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import AppHeader from '../components/AppHeader';

export default function BallotDesigner() {
  const { id: electionId } = useParams();
  const [config, setConfig] = useState(null);
  const [election, setElection] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewSize, setPreviewSize] = useState('quarter_letter');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [rounds, setRounds] = useState([]);
  const [testRoundId, setTestRoundId] = useState('');
  const [testCount, setTestCount] = useState(10);
  const [generatingTest, setGeneratingTest] = useState(false);

  useEffect(() => {
    api.get(`/admin/elections/${electionId}`).then(({ data }) => {
      setElection(data);
      // Fetch rounds for test ballot generation
      const allRounds = [];
      if (data.races) {
        Promise.all(data.races.map(race =>
          api.get(`/admin/races/${race.id}/rounds`).then(({ data: rds }) =>
            rds.forEach(r => allRounds.push({ ...r, race_name: race.name }))
          ).catch(() => {})
        )).then(() => {
          setRounds(allRounds);
          if (allRounds.length > 0) setTestRoundId(String(allRounds[0].id));
        });
      }
    });
    api.get(`/admin/elections/${electionId}/ballot-design`).then(({ data }) => setConfig(data.config));
    fetch(`/api/admin/elections/${electionId}/ballot-design/logo`, { method: 'HEAD' })
      .then(r => { if (r.ok) setLogoUrl(`/api/admin/elections/${electionId}/ballot-design/logo`); })
      .catch(() => {});
  }, [electionId]);

  const updateField = (section, field, value) => {
    setConfig(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
    setSaved(false);
  };

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      await api.post(`/admin/elections/${electionId}/ballot-design/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLogoUrl(`/api/admin/elections/${electionId}/ballot-design/logo?t=${Date.now()}`);
      updateField('logo', 'show', true);
    } catch (err) {
      alert('Logo upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = async () => {
    await api.delete(`/admin/elections/${electionId}/ballot-design/logo`);
    setLogoUrl(null);
    updateField('logo', 'show', false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/elections/${electionId}/ballot-design`, { config });
      setSaved(true);
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const { data } = await api.get(`/admin/elections/${electionId}/ballot-design/defaults`);
    setConfig(data);
    setSaved(false);
  };

  const handlePreview = async () => {
    // Save first, then generate a preview ballot
    setGeneratingPreview(true);
    try {
      await api.put(`/admin/elections/${electionId}/ballot-design`, { config });
      setSaved(true);

      // Find a round to preview with, or use a dummy
      const races = election?.races || [];
      let roundId = null;
      for (const race of races) {
        const { data: rounds } = await api.get(`/admin/races/${race.id}/rounds`);
        if (rounds.length > 0) { roundId = rounds[0].id; break; }
      }

      if (!roundId) {
        alert('Create a round first to preview the ballot design.');
        setGeneratingPreview(false);
        return;
      }

      setPreviewUrl(`/api/admin/rounds/${roundId}/ballot-preview?size=${previewSize}&t=${Date.now()}`);
    } catch (err) {
      alert('Preview failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setGeneratingPreview(false);
    }
  };

  if (!config) return <div style={s.container}><p>Loading...</p></div>;

  return (
    <div style={s.container}>
      <AppHeader title="Ballot Designer" />
      <Link to={`/admin/elections/${electionId}?section=ballots`} style={s.backLink}>&larr; Back to Ballot Generation</Link>
      <div style={s.header}>
        <h1>Ballot Designer</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={s.btnSecondary} onClick={handleReset}>Reset to Defaults</button>
          <button style={{ ...s.btnPrimary, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Design'}
          </button>
        </div>
      </div>

      <div style={s.layout}>
        {/* LEFT: Settings */}
        <div style={s.settingsPanel}>

          {/* Header */}
          <Section title="Header">
            <Toggle label="Show header" value={config.header.show} onChange={v => updateField('header', 'show', v)} />
            {config.header.show && <>
              <NumberField label="Election event name font size" value={config.header.electionNameSize} onChange={v => updateField('header', 'electionNameSize', v)} />
              <NumberField label="Race name font size" value={config.header.raceNameSize} onChange={v => updateField('header', 'raceNameSize', v)} />
              <NumberField label="Round info font size" value={config.header.roundInfoSize} onChange={v => updateField('header', 'roundInfoSize', v)} />
            </>}
          </Section>

          {/* Logo */}
          <Section title="Logo">
            <Toggle label="Show logo" value={config.logo.show} onChange={v => updateField('logo', 'show', v)} />
            {config.logo.show && <>
              {logoUrl ? (
                <div style={{ marginBottom: '0.5rem' }}>
                  <img src={logoUrl} alt="Logo" style={{ maxWidth: 80, maxHeight: 80, border: '1px solid #d1d5db', borderRadius: 4, display: 'block', marginBottom: '0.4rem' }} />
                  <button style={s.btnRemove} onClick={handleLogoRemove}>Remove logo</button>
                </div>
              ) : (
                <div style={{ marginBottom: '0.5rem' }}>
                  <span style={s.fieldLabel}>Upload logo image</span>
                  <input type="file" accept="image/*" style={{ fontSize: '0.82rem' }}
                    onChange={e => handleLogoUpload(e.target.files[0])} disabled={uploadingLogo} />
                  {uploadingLogo && <span style={s.muted}> Uploading...</span>}
                </div>
              )}
              <SelectField label="Position" value={config.logo.position} options={[
                { value: 'top-left', label: 'Top Left' },
                { value: 'top-right', label: 'Top Right' },
                { value: 'top-center', label: 'Top Center' },
              ]} onChange={v => updateField('logo', 'position', v)} />
              <NumberField label="Max width (px)" value={config.logo.maxWidth} onChange={v => updateField('logo', 'maxWidth', v)} />
            </>}
          </Section>

          {/* Candidates */}
          <Section title="Candidates (auto-placed)">
            <NumberField label="Font size" value={config.candidates.fontSize} onChange={v => updateField('candidates', 'fontSize', v)} />
            <SelectField label="Oval size" value={config.candidates.ovalSize} options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]} onChange={v => updateField('candidates', 'ovalSize', v)} />
            <SelectField label="Spacing" value={config.candidates.spacing} options={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
              { value: 'spacious', label: 'Spacious' },
            ]} onChange={v => updateField('candidates', 'spacing', v)} />
          </Section>

          {/* Instructions */}
          <Section title="Instructions">
            <Toggle label="Show instructions" value={config.instructions.show} onChange={v => updateField('instructions', 'show', v)} />
            {config.instructions.show && <>
              <TextArea label="Text" value={config.instructions.text} onChange={v => updateField('instructions', 'text', v)} />
              <NumberField label="Font size" value={config.instructions.fontSize} onChange={v => updateField('instructions', 'fontSize', v)} />
            </>}
          </Section>

          {/* Encouragement */}
          <Section title="Photo Encouragement">
            <Toggle label="Show encouragement" value={config.encouragement.show} onChange={v => updateField('encouragement', 'show', v)} />
            {config.encouragement.show &&
              <TextArea label="Text" value={config.encouragement.text} onChange={v => updateField('encouragement', 'text', v)} />
            }
          </Section>

          {/* Examples */}
          <Section title="Marking Examples">
            <Toggle label="Show examples (correct/wrong ovals)" value={config.examples.show} onChange={v => updateField('examples', 'show', v)} />
          </Section>

          {/* Custom Notes */}
          <Section title="Custom Notes">
            <Toggle label="Show custom notes" value={config.notes.show} onChange={v => updateField('notes', 'show', v)} />
            {config.notes.show && <>
              <TextArea label="Notes text" value={config.notes.text} onChange={v => updateField('notes', 'text', v)} />
              <NumberField label="Font size" value={config.notes.fontSize} onChange={v => updateField('notes', 'fontSize', v)} />
            </>}
          </Section>

          {/* QR Code */}
          <Section title="QR Code">
            <Toggle label="Show QR code" value={config.qr.show} onChange={v => updateField('qr', 'show', v)} />
            {config.qr.show &&
              <SelectField label="Position" value={config.qr.position} options={[
                { value: 'bottom-right', label: 'Bottom Right' },
                { value: 'bottom-left', label: 'Bottom Left' },
                { value: 'bottom-center', label: 'Bottom Center' },
              ]} onChange={v => updateField('qr', 'position', v)} />
            }
          </Section>

          {/* Serial Number */}
          <Section title="Serial Number">
            <Toggle label="Show serial number text" value={config.sn.show} onChange={v => updateField('sn', 'show', v)} />
            {config.sn.show && (
              <NumberField label="Font size (0 = auto)" value={config.sn.fontSize || 0} onChange={v => updateField('sn', 'fontSize', v)} />
            )}
          </Section>

          {/* Test Ballot Generation */}
          <Section title="Generate Test Ballots">
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }}>
              <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: 0, fontWeight: 600 }}>
                Test ballots are for TEST RACES ONLY. Do not use for real races.
              </p>
            </div>
            <p style={{ color: '#666', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
              Create random filled ballot images for scanner/OMR testing. Uses the ballot size selected above.
            </p>
            <SelectField label="Round" value={testRoundId} options={
              rounds.map(r => ({ value: String(r.id), label: `${r.race_name} — Round ${r.round_number}` }))
            } onChange={v => setTestRoundId(v)} />
            <NumberField label="Number of ballots" value={testCount} onChange={v => setTestCount(v)} />
            <button
              style={{ ...s.btnPrimary, background: '#7c3aed', marginTop: '0.5rem', opacity: generatingTest ? 0.6 : 1 }}
              disabled={generatingTest || !testRoundId}
              onClick={async () => {
                setGeneratingTest(true);
                try {
                  const { data } = await api.post(`/admin/rounds/${testRoundId}/generate-test-ballots`, {
                    count: testCount, size: previewSize,
                  });
                  // Auto-download the PDF
                  const link = document.createElement('a');
                  link.href = `/api/admin/rounds/${testRoundId}/test-ballot-pdf`;
                  link.download = 'test-ballots.pdf';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                } catch (err) {
                  alert('Failed: ' + (err.response?.data?.error || err.message));
                } finally {
                  setGeneratingTest(false);
                }
              }}
            >
              {generatingTest ? 'Generating...' : 'Generate Test Ballots'}
            </button>
          </Section>
        </div>

        {/* RIGHT: Preview */}
        <div style={s.previewPanel}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <select style={s.input} value={previewSize} onChange={e => setPreviewSize(e.target.value)}>
              <option value="quarter_letter">Quarter Letter (4 per page)</option>
            </select>
            <button
              style={{ ...s.btnPrimary, opacity: generatingPreview ? 0.6 : 1 }}
              onClick={handlePreview}
              disabled={generatingPreview}
            >
              {generatingPreview ? 'Generating...' : 'Preview'}
            </button>
          </div>

          <p style={s.muted}>
            4 ballots per page — saves design and generates a real PDF preview.
          </p>

          {previewUrl && (
            <iframe src={previewUrl} style={s.previewFrame} title="Ballot Preview" />
          )}

          {!previewUrl && (
            <div style={s.previewPlaceholder}>
              <p>Click "Preview" to generate a ballot with your current design settings.</p>
              <p style={s.muted}>Requires at least one round to exist.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// === Reusable form components ===
function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={s.section}>
      <h3 style={s.sectionTitle} onClick={() => setOpen(!open)}>
        {title} <span style={{ color: '#9ca3af' }}>{open ? '▼' : '▶'}</span>
      </h3>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label style={s.fieldRow}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label style={s.fieldRow}>
      <span style={s.fieldLabel}>{label}</span>
      <input style={{ ...s.input, width: 70 }} type="number" value={value} onChange={e => onChange(parseInt(e.target.value) || 0)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label style={s.fieldRow}>
      <span style={s.fieldLabel}>{label}</span>
      <select style={s.input} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <span style={s.fieldLabel}>{label}</span>
      <textarea style={{ ...s.input, width: '100%', minHeight: 50, resize: 'vertical', boxSizing: 'border-box' }} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

// === Styles ===
const s = {
  container: { maxWidth: 1200, margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' },
  backLink: { color: '#2563eb', textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  layout: { display: 'flex', gap: '1.5rem', alignItems: 'flex-start' },
  settingsPanel: { width: 380, flexShrink: 0, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: '0.5rem' },
  previewPanel: { flex: 1, position: 'sticky', top: '1rem' },
  section: { marginBottom: '0.5rem', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  sectionTitle: { margin: 0, padding: '0.6rem 0.75rem', background: '#f9fafb', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  sectionBody: { padding: '0.5rem 0.75rem' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' },
  fieldLabel: { fontSize: '0.82rem', color: '#374151', display: 'block', marginBottom: '0.15rem' },
  input: { padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.85rem' },
  previewFrame: { width: '100%', height: 600, border: '1px solid #d1d5db', borderRadius: 6 },
  previewPlaceholder: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3rem', textAlign: 'center', color: '#666' },
  btnPrimary: { padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnRemove: { padding: '0.2rem 0.5rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' },
  btnSecondary: { padding: '0.5rem 1rem', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  muted: { color: '#9ca3af', fontSize: '0.82rem' },
};
