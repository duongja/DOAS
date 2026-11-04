export interface AuthStatus {
  authenticated: boolean;
  email?: string;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Auth status failed with ${response.status}.`);
  }

  return (await response.json()) as AuthStatus;
}

export function loginRedirectUrl(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login.html?next=${encodeURIComponent(next)}`;
}

export function redirectToLogin(): void {
  window.location.replace(loginRedirectUrl());
}

export async function requireAuth(): Promise<AuthStatus | null> {
  try {
    const status = await getAuthStatus();
    if (!status.authenticated) {
      redirectToLogin();
      return null;
    }
    return status;
  } catch {
    redirectToLogin();
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  } finally {
    window.location.replace('/login.html');
  }
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/login.html')) return '/';
  return value;
}
