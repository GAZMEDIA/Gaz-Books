// The Gaz account: one email and password for downloading from Gaz Media's
// website and for signing in to GazBook (and GazPresenter). The website keeps
// the accounts (GazPresenter Plans plugin, /wp-json/gazpresenter/v1/account/...);
// the app only keeps the sign-in token it is given, never the password.

// GAZ_ACCOUNT_BASE: a stand-in website, for testing
const DEFAULT_BASE = process.env.GAZ_ACCOUNT_BASE || 'https://gazgoc.com.ng/wp-json/gazpresenter/v1/account';
const ACTIONS = ['register', 'login', 'forgot', 'reset', 'check'];

class AccountClient {
  constructor({ base = DEFAULT_BASE, fetchImpl = globalThis.fetch, app = 'gazbook', machine = '' } = {}) {
    this.base = base;
    this.fetch = fetchImpl;
    this.app = app;
    this.machine = machine;
  }

  // action: register | login | forgot | reset | check.
  // Returns { ok, token, account, message } or { error } in plain words
  // ({ error, signedOut: true } when check says the token no longer works,
  // { error, offline: true } when the website can't be reached).
  async call(action, details = {}) {
    if (!ACTIONS.includes(action)) return { error: 'Unknown action' };
    const body = { ...details, app: this.app, machine: typeof this.machine === 'function' ? this.machine() : this.machine };
    let res;
    try {
      res = await this.fetch(`${this.base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      return { error: 'No internet. Connect this computer to the internet and try again.', offline: true };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data || data.ok === false) {
      if (res.status === 401 && action === 'check') return { error: (data && data.message) || 'Please sign in again.', signedOut: true };
      if (res.status === 429) return { error: 'Too many tries. Please wait a few minutes and try again.' };
      if (res.status >= 500 || res.status === 404) return { error: "Gaz Media's website didn't answer. Please try again in a minute.", offline: action === 'check' };
      return { error: (data && data.message) || "Gaz Media's website didn't answer. Please try again." };
    }
    return { ok: true, token: data.token || '', account: data.account || null, message: data.message || '' };
  }
}

// what a form must have before it is sent; '' when it is fine
function checkAccountForm(action, d = {}) {
  const email = String(d.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please type a real email address';
  if (action === 'register' && !String(d.name || '').trim()) return 'Please type your name';
  if (action === 'register' && String(d.phone || '').replace(/\D/g, '').length < 7) return 'Please type your phone number';
  if ((action === 'register' || action === 'reset') && String(d.password || '').length < 8) return 'The password needs at least 8 characters';
  if (action === 'login' && !d.password) return 'Please type your password';
  if (action === 'reset' && !/^\d{6}$/.test(String(d.code || '').trim())) return 'Type the 6-digit code from the email';
  return '';
}

module.exports = { AccountClient, checkAccountForm, DEFAULT_BASE };
