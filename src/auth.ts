import type { Express, NextFunction, Request, Response } from 'express';
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

const AUTH_EMAIL = (process.env.AUTH_EMAIL?.trim() || 'nashonsagate@gmail.com').toLowerCase();
const PASSWORD_SALT = '469c5ee50f575edd7bbd2873f7d7aedf';
const PASSWORD_KEY = '6449004944fda634a99520f2a0737b5f4e327b8e8bc334ee96077a03c3cbf0f9';
const SESSION_SECRET =
  process.env.SESSION_SECRET?.trim() || 'doas-development-session-secret-change-me';
const SESSION_COOKIE = 'doas_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

interface AuthSession {
  sub: string;
  iat: number;
  exp: number;
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(value: string): string {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}

function verifyPassword(password: string): boolean {
  const actual = scryptSync(password, Buffer.from(PASSWORD_SALT, 'hex'), 32, {
    N: 16_384,
    r: 8,
    p: 1,
  });
  const expected = Buffer.from(PASSWORD_KEY, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isValidCredentials(email: string, password: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordMatches = verifyPassword(password);
  return normalizedEmail === AUTH_EMAIL && passwordMatches;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

export function createSessionToken(email: string): string {
  const now = Date.now();
  const payload: AuthSession = {
    sub: email,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined): AuthSession | null {
  if (!token) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(encoded);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<AuthSession>;

    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.exp !== 'number' ||
      decoded.exp <= Date.now() ||
      decoded.sub.toLowerCase() !== AUTH_EMAIL
    ) {
      return null;
    }

    return {
      sub: decoded.sub,
      iat: typeof decoded.iat === 'number' ? decoded.iat : 0,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

function getSession(request: Request): AuthSession | null {
  return verifySessionToken(readCookie(request.headers.cookie, SESSION_COOKIE));
}

function loginKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function loginBlocked(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= Date.now()) return false;
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  entry.count += 1;
}

export function registerAuthRoutes(app: Express): void {
  app.get('/api/auth/status', (request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store');
    const session = getSession(request);
    response.json(
      session
        ? { authenticated: true, email: session.sub }
        : { authenticated: false },
    );
  });

  app.post('/api/auth/login', (request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store');

    const key = loginKey(request);
    if (loginBlocked(key)) {
      response.status(429).json({ error: 'Too many login attempts. Try again later.' });
      return;
    }

    const body = request.body as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!email || !password || !isValidCredentials(email, password)) {
      recordLoginFailure(key);
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    loginAttempts.delete(key);
    response.setHeader(
      'Set-Cookie',
      sessionCookie(createSessionToken(AUTH_EMAIL), Math.floor(SESSION_TTL_MS / 1000)),
    );
    response.json({ authenticated: true, email: AUTH_EMAIL });
  });

  app.post('/api/auth/logout', (_request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', sessionCookie('', 0));
    response.json({ ok: true });
  });
}

const PUBLIC_API_PATHS = new Set(['/health', '/auth/login', '/auth/status', '/auth/logout']);

export function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.method === 'OPTIONS' || PUBLIC_API_PATHS.has(request.path)) {
    next();
    return;
  }

  if (!getSession(request)) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  next();
}
