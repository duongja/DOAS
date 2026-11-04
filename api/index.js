const { app, ensureDatabase } = require('../dist/server.js');

function normalizeApiUrl(request) {
  const raw = request.url || '/api';

  // Vercel may expose the function destination instead of the original URL.
  const restored = raw.replace(/^\/api\/index(?:\.js|\.ts)?/, '/api');
  request.url = restored.startsWith('/api')
    ? restored
    : `/api${restored.startsWith('/') ? restored : `/${restored}`}`;
}

module.exports = async function handler(request, response) {
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
};

module.exports.config = {
  maxDuration: 300,
};
