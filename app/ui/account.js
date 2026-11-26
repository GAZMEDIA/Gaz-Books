// The sign-in screen: create a Gaz account, sign in, or set a new password.
// GazBook opens on this screen until the person is signed in.
const $ = (id) => document.getElementById(id);
const TEXT = {
  register: { title: 'Create your Gaz account', lead: 'GazBook needs a free Gaz Media account. The same account works for every Gaz app.', go: 'Create account', pass: 'Choose a password (at least 8 characters)' },
  login: { title: 'Sign in to GazBook', lead: 'Use the email and password of your Gaz Media account (the one you made to download GazBook).', go: 'Sign in', pass: 'Password' },
  forgot: { title: 'Forgot your password?', lead: "Type your account email. We'll email you a 6-digit code.", go: 'Email me a code', pass: '' },
  reset: { title: 'Set a new password', lead: 'Type the 6-digit code from the email and choose a new password.', go: 'Save and sign in', pass: 'New password (at least 8 characters)' },
};
let mode = 'register';

function show(m, note, kind = 'err') {
  mode = m;
  const t = TEXT[m];
  $('title').textContent = t.title;
  $('lead').textContent = t.lead;
  $('go').textContent = t.go;
  $('passLabel').textContent = t.pass;
  document.querySelectorAll('label[data-for]').forEach((l) => l.classList.toggle('hidden', !l.dataset.for.split(' ').includes(m)));
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('password').value = '';
  const links = {
    register: [['Already have an account? Sign in', 'login']],
    login: [['Forgot your password?', 'forgot'], ['New here? Create an account', 'register']],
    forgot: [['Back to sign in', 'login']],
    reset: [['Send a new code', 'forgot'], ['Back to sign in', 'login']],
  }[m];
  $('links').replaceChildren(...links.flatMap(([text, to], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'link'; b.textContent = text; b.onclick = () => show(to);
    return i ? [document.createTextNode(' · '), b] : [b];
  }));
  message(note || '', kind);
}

function message(text, kind = 'err') {
  $('msg').textContent = text;
  $('msg').className = `msg ${kind}${text ? '' : ' hidden'}`;
}

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const action = mode;
  const d = { name: $('name').value, email: $('email').value.trim(), phone: $('phone').value, church: $('church').value, code: $('code').value.trim(), password: $('password').value };
  $('go').disabled = true;
  message('Please wait…', 'ok');
  try {
    const r = await window.gaz.account(action, d);
    if (r.error) return message(r.error);
    if (action === 'forgot') return show('reset', r.message || 'We have emailed you a 6-digit code. Check your inbox and spam folder.', 'ok');
    // signed in: main opens the app
  } catch (err) {
    message(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  } finally {
    $('go').disabled = false;
  }
};

window.gaz.accountInfo().then((a) => {
  if (a && a.email) $('email').value = a.email;
  show(a && a.known ? 'login' : 'register', a && a.note);
});
