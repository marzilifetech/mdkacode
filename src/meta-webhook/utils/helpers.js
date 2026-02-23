/**
 * Helpers for flow runner: age/DOB, intent (yes/no/menu), extractors (name, DOB, city), Bangalore fuzzy.
 * Pure functions where possible for testability and no side effects.
 */

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function calculateAge(dob) {
  if (!dob || typeof dob !== 'string') return null;
  try {
    const [d, m, y] = dob.split(/[-/]/).map(Number);
    if (!d || !m || !y) return null;
    const birth = new Date(y, m - 1, d);
    const today = new Date();
    if (birth > today) return null;
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  } catch {
    return null;
  }
}

/**
 * Normalize DOB to DD-MM-YYYY for storage. Year-only (e.g. "1968") becomes 01-01-1968.
 * @returns {string|null} DD-MM-YYYY or null
 */
function normalizeDOB(dob) {
  if (!dob || typeof dob !== 'string') return null;
  const t = dob.trim();
  const thisYear = new Date().getFullYear();
  const patterns = [
    /(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})/,
    /(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})/,
    /(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2})\b/,
    /^(\d{4})$/,           // year only: 1968 -> 01-01-1968
    /^(\d{2})$/,           // 68 -> 01-01-1968 (assume 50+ for Marzi)
  ];
  for (const p of patterns) {
    const match = t.match(p);
    if (match) {
      let day = '01', month = '01', year;
      if (match[0] === t && match[1] && match.length === 2) {
        const y = parseInt(match[1], 10);
        if (y >= 1900 && y <= thisYear) {
          year = String(y);
          return `${day}-${month}-${year}`;
        }
        if (y >= 0 && y <= 99) {
          year = y <= 50 ? 2000 + y : 1900 + y;
          return `${day}-${month}-${year}`;
        }
      }
      if (match.length >= 3) {
        if (match[1].length === 4) {
          year = match[1];
          month = String(parseInt(match[2], 10)).padStart(2, '0');
          day = String(parseInt(match[3], 10)).padStart(2, '0');
        } else if (match[3].length === 2) {
          const yy = parseInt(match[3], 10);
          year = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
          day = String(parseInt(match[1], 10)).padStart(2, '0');
          month = String(parseInt(match[2], 10)).padStart(2, '0');
        } else {
          day = String(parseInt(match[1], 10)).padStart(2, '0');
          month = String(parseInt(match[2], 10)).padStart(2, '0');
          year = match[3];
        }
        const d = parseInt(day, 10);
        const m = parseInt(month, 10);
        const y = parseInt(year, 10);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= thisYear) {
          return `${day}-${month}-${year}`;
        }
      }
    }
  }
  return null;
}

function isValidDOB(dob) {
  const normalized = normalizeDOB(dob);
  if (!normalized) return false;
  const [day, month, year] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year;
}

function isYes(message) {
  const n = normalizeText(message);
  return ['yes', 'y', 'ya', 'yeah', 'yep', 'ok', 'okay', 'sure', 'alright'].some(p => n.includes(p));
}

function isNo(message) {
  const n = normalizeText(message);
  return ['no', 'n', 'nah', 'nope', 'not', 'no thanks', 'no thank you'].some(p => n.includes(p));
}

function getMenuOption(message) {
  const n = normalizeText(message);
  const num = parseInt(n, 10);
  if (num >= 1 && num <= 4) return num;
  if (n.includes('holiday') || n.includes('1')) return 1;
  if (n.includes('event') || n.includes('meetup') || n.includes('2')) return 2;
  if (n.includes('support') || n.includes('3')) return 3;
  if (n.includes('community') || n.includes('4')) return 4;
  return null;
}

/** Capitalize each word for proper name display (Indian names). */
function normalizeNameForDisplay(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim()
    .split(/\s+/)
    .map(w => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractName(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim().replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 100) return null;
  const excluded = ['yes', 'no', 'hello', 'hi', 'hey', 'ok', 'thanks', 'okay', 'sure', 'alright', 'hmm', 'na'];
  const lower = t.toLowerCase();
  if (excluded.includes(lower)) return null;
  const patterns = [
    /(?:my\s+)?name\s+is\s+([a-zA-Z\s.'-]+)/i,
    /(?:mera\s+naam|mujhe\s+kehte\s+hain)\s+([a-zA-Z\s.'-]+)/i,
    /i\s*am\s+([a-zA-Z\s.'-]+)/i,
    /(?:this\s+is|call\s+me)\s+([a-zA-Z\s.'-]+)/i,
    /(?:i'm|im)\s+([a-zA-Z\s.'-]+)/i,
    /name[:\s]+([a-zA-Z\s.'-]+)/i,
    /^(?:dr\.?|shri|smt\.?|mr\.?|mrs\.?|ms\.?)\s*([a-zA-Z\s.'-]+)$/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const raw = m[1].trim().replace(/\s+/g, ' ');
      const parts = raw.split(/\s+/).slice(0, 4);
      const name = parts.join(' ');
      if (name.length >= 2 && /[a-zA-Z]/.test(name) && name.length <= 80) return normalizeNameForDisplay(name);
    }
  }
  if (/^[a-zA-Z\s.'-]{2,80}$/.test(t) && /[a-zA-Z]{2,}/.test(t) && !excluded.includes(lower)) return normalizeNameForDisplay(t);
  return null;
}

function extractDOB(message) {
  if (!message || typeof message !== 'string') return null;
  return normalizeDOB(message.trim());
}

function extractCity(message) {
  if (!message || typeof message !== 'string') return null;
  let t = message.trim().replace(/\s+/g, ' ')
    .replace(/^(?:i\s+live\s+in|i\s+am\s+from|my\s+city\s+is|city\s+is|i\s+stay\s+in|staying\s+in|located\s+in|based\s+in|mera\s+city|i\s+reside\s+in)\s*/i, '')
    .replace(/^(?:it'?s?|its)\s+/i, '')
    .replace(/\s*[.,;:!?]\s*$/, '')
    .replace(/\s+\d{6}\s*$/, '')
    .trim();
  if (t.length < 2 || t.length > 80 || !/[a-zA-Z]/.test(t)) return null;
  return t;
}

/** Bangalore fuzzy match: Bengaluru, Bangalore, B'lore, Blr, Benguluru, etc. */
function isBangaloreFuzzy(city) {
  if (!city || typeof city !== 'string') return false;
  const n = city.trim().toLowerCase().replace(/\s+/g, ' ').replace(/['']/g, '');
  if (n.length < 2) return false;
  return /^(bangalore|bengaluru|benguluru|blr|blore)$/.test(n) ||
    /\b(bangalore|bengaluru|benguluru|blr|blore)\b/.test(n);
}

module.exports = {
  normalizeText,
  calculateAge,
  isValidDOB,
  normalizeDOB,
  normalizeNameForDisplay,
  isYes,
  isNo,
  getMenuOption,
  extractName,
  extractDOB,
  extractCity,
  isBangaloreFuzzy
};
