// What the sea refuses before anyone sees it.
// Links, emails and long digit runs (phone numbers, IDs) are always refused, which stops most spam.
// Add your own words with the BLOCKED_WORDS variable (comma-separated) in the Cloudflare dashboard.
const PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b[\w-]+\.(com|net|org|io|cn|xyz|top|ru|info|biz|me|co)\b/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\d{7,}/,
];

export function refused(text, env) {
  if (PATTERNS.some(p => p.test(text))) return true;
  const words = (env.BLOCKED_WORDS || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  const t = text.toLowerCase();
  return words.some(w => t.includes(w));
}

// a creature leaves the sea once this many different people report it
export const REPORT_LIMIT = 3;
