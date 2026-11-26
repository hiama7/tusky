// Client-side form validation for quick feedback. The API repeats every check —
// browser validation is for user experience only, never for security.
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const isPhone = (v) => /^[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '').replace(/^\+?91/, ''));
export const passwordIssue = (v) => {
  if (v.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Include at least one letter and one number.';
  return null;
};

/** Returns 0–4 strength score for the password meter. */
export function passwordStrength(v) {
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++;
  return s;
}

export function validateRegister(f) {
  const e = {};
  if (f.name.trim().length < 3) e.name = 'Please enter your full name.';
  if (!isEmail(f.email)) e.email = 'Enter a valid email address.';
  if (!isPhone(f.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number.';
  const pw = passwordIssue(f.password);
  if (pw) e.password = pw;
  if (!f.confirm) e.confirm = 'Please confirm your password.';
  else if (f.confirm !== f.password) e.confirm = 'Passwords do not match.';
  if (!f.terms) e.terms = 'Please accept the terms to continue.';
  return e;
}

export function validateLogin(f) {
  const e = {};
  if (!isEmail(f.email)) e.email = 'Enter a valid email address.';
  if (!f.password) e.password = 'Password is required.';
  return e;
}
