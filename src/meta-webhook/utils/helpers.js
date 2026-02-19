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
    const [d, m, y] = dob.split('-').map(Number);
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

function isValidDOB(dob) {
  if (!dob || typeof dob !== 'string') return false;
  const match = dob.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) return false;
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1;
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

function extractName(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  if (t.length < 2 || t.length > 100) return null;
  const excluded = ['yes', 'no', 'hello', 'hi', 'hey', 'ok', 'thanks', 'okay', 'sure'];
  if (excluded.includes(t.toLowerCase())) return null;
  const patterns = [
    /(?:my\s+)?name\s+is\s+([a-zA-Z\s.]+)/i,
    /i\s*am\s+([a-zA-Z\s.]+)/i,
    /(?:this\s+is|call\s+me)\s+([a-zA-Z\s.]+)/i,
    /(?:i'm|im)\s+([a-zA-Z\s.]+)/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const name = m[1].trim().split(/\s+/).slice(0, 3).join(' ');
      if (name.length >= 2 && /[a-zA-Z]/.test(name)) return name;
    }
  }
  if (/^[a-zA-Z\s.]{2,50}$/.test(t) && !excluded.includes(t.toLowerCase())) return t;
  return null;
}

function extractDOB(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim();
  const patterns = [
    /(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})/,
    /(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})/,
    /(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2})/  // 12-05-60 -> assume 1960
  ];
  for (const p of patterns) {
    const match = t.match(p);
    if (match) {
      let day, month, year;
      if (match[3].length === 2) {
        const yy = parseInt(match[3], 10);
        year = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
        day = match[1].padStart(2, '0');
        month = match[2].padStart(2, '0');
      } else if (match[1].length === 4) {
        year = match[1];
        month = match[2].padStart(2, '0');
        day = match[3].padStart(2, '0');
      } else {
        day = match[1].padStart(2, '0');
        month = match[2].padStart(2, '0');
        year = match[3];
      }
      const d = parseInt(day, 10);
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= new Date().getFullYear()) {
        return `${day}-${month}-${year}`;
      }
    }
  }
  return null;
}

function extractCity(message) {
  if (!message || typeof message !== 'string') return null;
  const t = message.trim()
    .replace(/^(i live in|i am from|my city is|city is|i stay in|staying in|located in)\s*/i, '')
    .replace(/\s*\.\s*$/, '')
    .trim();
  if (t.length < 2 || t.length > 100 || !/[a-zA-Z]/.test(t)) return null;
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
  isYes,
  isNo,
  getMenuOption,
  extractName,
  extractDOB,
  extractCity,
  isBangaloreFuzzy
};
