// For the app self-tests: start already signed in to a Gaz account, with the
// account website out of reach (the app then carries on, as it does offline).
const fs = require('fs');
const path = require('path');
module.exports = function signedIn(userData) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, 'settings.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...s, accountToken: 'selftest-token', accountEmail: 'selftest@example.com', accountName: 'Self test' }));
  process.env.GAZ_ACCOUNT_BASE = 'http://127.0.0.1:9/account';
};
