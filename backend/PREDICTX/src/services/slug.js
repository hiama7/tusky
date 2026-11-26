// URL slug + short team-code helpers.
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** "Royal Lions" → "RL", "India" → "IND". */
export function shortCode(name) {
  const words = String(name).replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'TBD';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
}
