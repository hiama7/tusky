// NOT SECURE — a tiny non-cryptographic hash so demo passwords are not stored as
// readable text in localStorage. Real hashing (password_hash / password_verify)
// happens on the PHP server in Stage 2. Never reuse this for real credentials.
export function demoHash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return `demo$${(h >>> 0).toString(16)}`;
}
