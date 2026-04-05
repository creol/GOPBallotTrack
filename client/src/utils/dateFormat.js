/**
 * Parse a date string without timezone shift.
 * Handles both "2026-06-15" and "2026-06-15T00:00:00.000Z" formats.
 */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  // Extract just the YYYY-MM-DD part
  const ymd = String(dateStr).split('T')[0];
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d); // local timezone, no UTC shift
}

/**
 * Format a date string for display. No timezone issues.
 */
export function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString();
}

/**
 * Get YYYY-MM-DD string for an input[type=date] value.
 */
export function toInputDate(dateStr) {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Format a time string (HH:MM or HH:MM:SS) to 12hr AM/PM.
 */
export function formatTime12(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0]);
  const m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Format race schedule for dashboard display.
 * If race date is today, omit the date and just show time.
 * Returns { date, time, location } strings ready to display.
 */
export function formatRaceSchedule(raceDate, raceTime, location) {
  const parts = [];

  const d = parseLocalDate(raceDate);
  const today = new Date();
  const isToday = d && d.toDateString() === today.toDateString();

  if (d && !isToday) {
    parts.push(d.toLocaleDateString());
  }

  if (raceTime) {
    const timeFormatted = formatTime12(raceTime);
    if (parts.length > 0) {
      parts.push(`at ${timeFormatted}`);
    } else {
      parts.push(timeFormatted);
    }
  }

  if (location) {
    if (parts.length > 0) {
      parts.push(`— ${location}`);
    } else {
      parts.push(location);
    }
  }

  return parts.join(' ');
}
