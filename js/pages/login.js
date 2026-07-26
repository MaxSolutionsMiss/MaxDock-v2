import { db } from '../db.js';
import { session } from '../session.js';

const params = new URLSearchParams(globalThis.location.search);
const panels = {
  signIn: document.getElementById('sign-in-panel'),
  forgot: document.getElementById('forgot-panel'),
  password: document.getElementById('password-panel'),
};

function showPanel(name) {
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  const first = panels[name]?.querySelector('input');
  first?.focus();
}

function setMessage(id, message, success = false) {
  const target = document.getElementById(id);
  target.textContent = message || '';
  target.classList.toggle('form-message--success', success);
}

async function redirectAfterAuth(context) {
  const returnPath = session.safeReturn(params.get('return'), context);
  globalThis.location.replace(returnPath);
}

async function loadSignedInContext() {
  const context = await session.loadContext({ redirect: false, allowPasswordSetup: true });
  if (!context) return null;
  if (context.profile.must_change_password) {
    document.getElementById('password-title').textContent = 'Create a new password';
    document.getElementById('password-intro').textContent = 'Your temporary password must be replaced before you continue.';
    document.getElementById('password-submit').textContent = 'Save password and continue';
    showPanel('password');
    return null;
  }
  return context;
}


function initialisePasswordReveal() {
  for (const button of document.querySelectorAll('[data-password-reveal]')) {
    const input = document.getElementById(button.dataset.passwordReveal);
    if (!input) continue;
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  }
}

initialisePasswordReveal();

const signInForm = document.getElementById('sign-in-form');
const signInButton = document.getElementById('sign-in-submit');
signInForm.addEventListener('submit', async event => {
  event.preventDefault();
  signInButton.disabled = true;
  setMessage('sign-in-message', '');
  const data = new FormData(signInForm);
  try {
    await db.auth.signIn(String(data.get('email') || '').trim(), String(data.get('password') || ''));
    await db.recordUsage('login', 'login');
    const context = await loadSignedInContext();
    if (context) await redirectAfterAuth(context);
  } catch (error) {
    setMessage('sign-in-message', error.userMessage || 'The email/username or password is incorrect.');
    document.getElementById('password').focus();
  } finally {
    signInButton.disabled = false;
  }
});

document.getElementById('forgot-link').addEventListener('click', () => {
  const identifier = document.getElementById('email').value.trim();
  setMessage('forgot-message', '');
  showPanel('forgot');
  // Password reset always needs a real email address, even for accounts that sign in
  // with a username, so only prefill it when what was typed already looks like one.
  if (identifier.includes('@')) document.getElementById('reset-email').value = identifier;
});

document.getElementById('back-to-sign-in').addEventListener('click', () => showPanel('signIn'));

const forgotForm = document.getElementById('forgot-form');
const forgotButton = document.getElementById('forgot-submit');
forgotForm.addEventListener('submit', async event => {
  event.preventDefault();
  forgotButton.disabled = true;
  setMessage('forgot-message', '');
  const email = String(new FormData(forgotForm).get('email') || '').trim();
  const redirectTo = `${globalThis.location.origin}${globalThis.location.pathname}?mode=recovery`;
  try {
    await db.auth.requestPasswordReset(email, redirectTo);
    setMessage('forgot-message', 'Check your email for the password-reset link. You may close this page.', true);
  } catch (error) {
    setMessage('forgot-message', error.userMessage || 'The reset email could not be sent.');
  } finally {
    forgotButton.disabled = false;
  }
});

const passwordForm = document.getElementById('password-form');
const passwordButton = document.getElementById('password-submit');
passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  passwordButton.disabled = true;
  setMessage('password-message', '');
  const data = new FormData(passwordForm);
  const password = String(data.get('password') || '');
  const confirmation = String(data.get('confirmation') || '');

  if (password.length < 10) {
    setMessage('password-message', 'Use at least 10 characters for your new password.');
    passwordButton.disabled = false;
    return;
  }
  if (password !== confirmation) {
    setMessage('password-message', 'The two passwords do not match.');
    passwordButton.disabled = false;
    return;
  }

  try {
    await db.auth.updatePassword(password);
    const context = await session.loadContext({ redirect: false, allowPasswordSetup: true });
    if (context?.profile.must_change_password) {
      await db.rpc('complete_password_setup', {}, {
        key: 'password-setup:complete',
        retry: 1,
        userMessage: 'The password was saved, but MaxDock could not complete account setup.',
      });
      db.invalidate('profile:');
    }
    const refreshed = await session.loadContext({ redirect: false, allowPasswordSetup: true });
    setMessage('password-message', 'Password saved. Opening MaxDock…', true);
    await redirectAfterAuth(refreshed || context);
  } catch (error) {
    setMessage('password-message', error.userMessage || 'The new password could not be saved.');
  } finally {
    passwordButton.disabled = false;
  }
});

const unsubscribe = db.auth.onChange(async event => {
  if (event === 'PASSWORD_RECOVERY') {
    document.getElementById('password-title').textContent = 'Reset your password';
    document.getElementById('password-intro').textContent = 'Choose a new password for your MaxDock account.';
    document.getElementById('password-submit').textContent = 'Save new password';
    showPanel('password');
  }
});

globalThis.addEventListener('pagehide', unsubscribe, { once: true });

(async () => {
  try {
    const authSession = await session.getAuthSession();
    const recovery = params.get('mode') === 'recovery' || globalThis.location.hash.includes('type=recovery');
    const setup = params.get('mode') === 'setup';
    if (authSession && (recovery || setup)) {
      showPanel('password');
      return;
    }
    if (authSession) {
      const context = await loadSignedInContext();
      if (context) await redirectAfterAuth(context);
      return;
    }
    showPanel('signIn');
  } catch (error) {
    showPanel('signIn');
    setMessage('sign-in-message', error.userMessage || 'MaxDock could not restore the previous session. Sign in again.');
  }
})();
