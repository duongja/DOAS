import type { Request, Response } from 'express';
import { app, ensureDatabase } from '../src/server';

/**
 * Vercel routes every /api/* request here. Express handles the route matching.
 * The database connection is cached by ensureDatabase across Fluid invocations.
 */
export const config = {
  maxDuration: 300,
};

function normalizeApiUrl(request: Request): void {
  const raw = request.url || '/api';

  // Vercel's rewrite may expose the function destination rather than the
  // original URL depending on runtime behavior. Normalize both cases.
  const restored = raw.replace(/^\/api\/index(?:\.ts)?/, '/api');
  request.url = restored.startsWith('/api')
    ? restored
    : `/api${restored.startsWith('/') ? restored : `/${restored}`}`;
}

export default async function handler(
  request: Request,
  response: Response,
): Promise<void> {
  try {
    await ensureDatabase();
  } catch (error) {
    console.error('[vercel] Database connection failed:', error);
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'Database connection failed.' }));
    return;
  }

  normalizeApiUrl(request);
  app(request, response);
}
