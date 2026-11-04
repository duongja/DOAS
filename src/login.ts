import { getAuthStatus, safeNextPath } from './client/auth';
import { registerPwa } from './client/pwa';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

const form = byId<HTMLFormElement>('login-form');
const emailInput = byId<HTMLInputElement>('login-email');
const passwordInput = byId<HTMLInputElement>('login-password');
const submitButton = byId<HTMLButtonElement>('login-submit');
const errorElement = byId<HTMLParagraphElement>('login-error');

const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function hideError(): void {
  errorElement.hidden = true;
  errorElement.textContent = '';
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? 'Signing in…' : 'Sign in';
}

async function redirectIfAuthenticated(): Promise<void> {
  try {
    const status = await getAuthStatus();
    if (status.authenticated) {
      window.location.replace(next);
    }
  } catch {
    // The form is still usable; a transient status failure should not trap the user.
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  hideError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Enter both your email and password.');
    return;
  }

  setBusy(true);

  void fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
    .then(async (response) => {
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : 'Could not sign in. Try again.';
        showError(message);
        setBusy(false);
        passwordInput.select();
        return;
      }

      window.location.replace(next);
    })
    .catch(() => {
      showError('Could not reach the API. Check the connection and try again.');
      setBusy(false);
    });
});

void redirectIfAuthenticated();
registerPwa();
