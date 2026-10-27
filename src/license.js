// GazBook plans. A plan is bought on gazgoc.com.ng/gazbook/ and comes as a
// code: the plan's letter, the day it ends, then Gaz Media's signature of
// "gazbook-plan-v1|email|LETTER|YYYYMMDD" (made by the GazPresenter Plans
// WordPress plugin with the private key, which is never in this repo).
// Checking it needs only the public key, and no internet.
const crypto = require('crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqrwZe7sLa8E0I0wQEA4df+Zy46Qu2lAxutvBL6v7Mdo=
-----END PUBLIC KEY-----`;

const TRIAL_DAYS = 7;
const BUY_URL = 'https://gazgoc.com.ng/gazbook/';

// Each plan has everything in the one before it.
const PLANS = {
  S: { id: 'starter', name: 'Starter', features: ['format'] },
  W: { id: 'writer', name: 'Writer', features: ['format', 'cover'] },
  P: { id: 'publisher', name: 'Publisher', features: ['format', 'cover', 'translate', 'ai'] },
  T: { id: 'studio', name: 'Studio', features: ['format', 'cover', 'translate', 'ai', 'many'] },
};
const FEATURES = {
  format: 'Making the PDF, Kindle and Word files',
  cover: 'The cover maker',
  translate: 'Translating',
  ai: 'Claude writing your back cover',
  many: 'Translating into many languages at once',
};
// the cheapest plan that has a feature: "Writer"
const planFor = (f) => Object.values(PLANS).find((p) => p.features.includes(f)).name;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function fromBase58(text) {
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return Buffer.alloc(0);
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const lead = text.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(lead), n > 0n ? Buffer.from(hex, 'hex') : Buffer.alloc(0)]);
}

const cleanEmail = (e) => String(e || '').trim().toLowerCase();

// "20271027" -> "2027-10-27", or '' if it isn't a real day
function ymdDay(ymd) {
  const d = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const t = new Date(`${d}T00:00:00Z`);
  return !isNaN(t) && t.toISOString().slice(0, 10) === d ? d : '';
}

// { plan, name, ends, features } for a real code for this email, else null
function readCode(email, code, publicKey = PUBLIC_KEY) {
  const m = String(code || '').replace(/\s+/g, '').match(/^([SWPT])(\d{8})-?(.+)$/);
  if (!m || !cleanEmail(email)) return null;
  const [, letter, ymd, sig] = m;
  const ends = ymdDay(ymd);
  const signature = fromBase58(sig.replace(/-/g, ''));
  if (!ends || signature.length !== 64) return null;
  try {
    const data = Buffer.from(`gazbook-plan-v1|${cleanEmail(email)}|${letter}|${ymd}`, 'utf8');
    if (!crypto.verify(null, data, crypto.createPublicKey(publicKey), signature)) return null;
  } catch { return null; }
  const p = PLANS[letter];
  return { plan: p.id, name: p.name, ends, features: p.features, forever: ends >= '2099-01-01' };
}

const today = (now) => new Date(now).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// What this computer may do now. s: { email, code, firstRun }
function licenseState(s, now = Date.now()) {
  const day = today(now);
  const plan = readCode(s.email, s.code);
  if (plan && plan.ends >= day) {
    return { kind: 'plan', email: cleanEmail(s.email), ...plan, daysLeft: daysBetween(day, plan.ends) };
  }
  const started = s.firstRun || day;
  const left = TRIAL_DAYS - daysBetween(started, day);
  if (left > 0) return { kind: 'trial', name: 'Free trial', daysLeft: left, features: Object.keys(FEATURES), ended: plan ? plan.ends : '' };
  return { kind: 'locked', name: 'Trial ended', features: [], ended: plan ? plan.ends : '' };
}

// Throws a friendly message if the plan doesn't include this feature.
function need(state, feature) {
  if (state.features.includes(feature)) return;
  if (state.kind === 'locked') {
    throw new Error(state.ended
      ? `Your GazBook plan ended on ${state.ended}. Click the plan badge at the top to renew it.`
      : 'Your 7-day free trial has ended. Click the plan badge at the top to buy a plan.');
  }
  throw new Error(`${FEATURES[feature]} is in the ${planFor(feature)} plan and up. Click the plan badge at the top to upgrade.`);
}

module.exports = { readCode, licenseState, need, PLANS, FEATURES, TRIAL_DAYS, BUY_URL, PUBLIC_KEY };
