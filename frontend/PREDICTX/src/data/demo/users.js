// DEMO DATA — sample accounts. NOT a real account system.
// Passwords here are visible on purpose: Stage 1 authentication is a UI demo only.
// Stage 2 replaces this with PHP sessions + password_hash() in MySQL.
export const DEMO_USER_LOGIN = { email: 'demo@tusky.app', password: 'Demo@1234' };
export const DEMO_ADMIN_LOGIN = { email: 'admin@tusky.app', password: 'Admin@1234' };

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Rohan', 'Isha', 'Vivaan', 'Meera', 'Arjun', 'Sara', 'Dev', 'Nisha', 'Aditya', 'Priya', 'Karan', 'Tara', 'Neel', 'Riya', 'Yash', 'Zoya'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Khan', 'Singh', 'Reddy', 'Gupta', 'Das', 'Nair', 'Mehta'];
const SUBS = ['Active', 'Active', 'Expired', 'None', 'None', 'Cancelled', 'Trial'];

/** Sample user list for the admin Users table (fictional people). */
export const DEMO_USERS = Array.from({ length: 24 }, (_, i) => {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 3) % LAST.length];
  const reg = new Date();
  reg.setDate(reg.getDate() - (i * 7 + 3));
  const purchases = (i * 5) % 17;
  return {
    id: `U${String(1001 + i)}`,
    name: `${first} ${last}`,
    email: `${first}.${last}${i}@example.com`.toLowerCase(),
    phone: `98${String(10000000 + i * 734521).slice(0, 8)}`,
    registeredAt: reg.toISOString(),
    subscription: SUBS[i % SUBS.length],
    purchases,
    spent: purchases * 45 + (SUBS[i % SUBS.length] === 'Active' ? 599 : 0),
    status: i % 11 === 6 ? 'Blocked' : 'Active',
  };
});

/** The built-in demo user that can log in on /login. */
export const DEMO_ACCOUNT = {
  id: 'U0001',
  name: 'Demo User',
  email: DEMO_USER_LOGIN.email,
  phone: '9876543210',
  password: DEMO_USER_LOGIN.password,
  registeredAt: new Date().toISOString(),
  status: 'Active',
  favourites: ['cricket', 'football'],
};
