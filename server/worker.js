import { validateBackup } from '../data.js';

// Sites supplies trusted identity headers after its own sign-in flow.
// BUCKET is private; no R2 object URLs are exposed to the browser.
export const MAX_PASSPORT_BYTES = 16 * 1024 * 1024;
const API_PATHS = new Set(['/api/session', '/api/passport']);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie, OAI-Sites-Authorization',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function problem(status, code, message) {
  return json({ error: { code, message } }, status);
}

function getUser(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id || !email || id.length > 1024) return null;
  let name = null;
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(request.headers.get('oai-authenticated-user-full-name') || ''); } catch { /* Fall back to account name. */ }
  }
  return { id, name: (name || email.split('@')[0] || 'Golfer').slice(0, 80) };
}

async function objectKey(userId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `passports/v1/${hash}.json`;
}

function writeCondition(request, deleting = false) {
  const match = request.headers.get('if-match');
  const none = request.headers.get('if-none-match');
  const condition = new Headers();
  if (match && !none && /^"[A-Za-z0-9:_-]{1,200}"$/.test(match)) {
    condition.set('If-Match', match);
    return condition;
  }
  if (!deleting && !match && none === '*') {
    condition.set('If-None-Match', '*');
    return condition;
  }
  return null;
}

async function boundedJSON(request) {
  const announced = Number(request.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > MAX_PASSPORT_BYTES) {
    throw Object.assign(new Error('Your passport is larger than 16 MB. Export a backup and remove a few photos before syncing.'), { status: 413, code: 'PASSPORT_TOO_LARGE' });
  }
  if (!request.body) throw Object.assign(new Error('A passport is required.'), { status: 400, code: 'INVALID_PASSPORT' });
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_PASSPORT_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('Your passport is larger than 16 MB. Export a backup and remove a few photos before syncing.'), { status: 413, code: 'PASSPORT_TOO_LARGE' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('This passport is not valid JSON.'), { status: 400, code: 'INVALID_PASSPORT' }); }
}

function state(user, profile, revision) {
  return { user, profile, revision };
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!API_PATHS.has(url.pathname)) return problem(404, 'NOT_FOUND', 'This page was not found.');
    const user = getUser(request);
    if (!user) return problem(401, 'SIGN_IN_REQUIRED', 'Sign in with ChatGPT to open your synced golf passport.');
    if (!env.BUCKET) return problem(503, 'STORAGE_UNAVAILABLE', 'Passport sync is temporarily unavailable. Your saved browser copy is safe.');
    const permitted = url.pathname === '/api/session' ? ['GET'] : ['GET', 'PUT', 'DELETE'];
    if (!permitted.includes(request.method)) {
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'This action is not supported.' } }, 405, { Allow: permitted.join(', ') });
    }
    try {
      const key = await objectKey(user.id);
      if (request.method === 'GET') {
        const object = await env.BUCKET.get(key);
        if (!object) return json(state(user, null, null));
        if (object.size > MAX_PASSPORT_BYTES) return problem(500, 'STORED_PASSPORT_TOO_LARGE', 'This stored passport needs support before it can be opened.');
        const stored = await object.json();
        if (stored.version !== 1 || !('profile' in stored)) throw new Error('Invalid stored passport.');
        const profile = stored.profile === null ? null : validateBackup(stored.profile);
        return json(state(user, profile, object.etag), 200, { ETag: object.httpEtag || `"${object.etag}"` });
      }

      // Cookies cannot authorize cross-origin writes. Do not enable API CORS.
      if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
        return problem(403, 'ORIGIN_REJECTED', 'Open your golf passport directly before making changes.');
      }
      const condition = writeCondition(request, request.method === 'DELETE');
      if (!condition) return problem(428, 'REVISION_REQUIRED', 'Refresh your passport before saving this change.');

      let profile = null;
      if (request.method === 'PUT') {
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return problem(415, 'JSON_REQUIRED', 'Passport changes must use JSON.');
        }
        const payload = await boundedJSON(request);
        try { profile = validateBackup(payload?.profile); }
        catch (error) { return problem(400, 'INVALID_PASSPORT', error.message); }
      }

      // A conditional tombstone clears deleted data without erasing a newer save.
      // A unique write ID prevents identical profile contents from reusing an etag.
      const body = JSON.stringify({ version: 1, profile, writeId: crypto.randomUUID(), savedAt: new Date().toISOString() });
      if (new TextEncoder().encode(body).byteLength > MAX_PASSPORT_BYTES) {
        return problem(413, 'PASSPORT_TOO_LARGE', 'Your passport is larger than 16 MB. Export a backup and remove a few photos before syncing.');
      }
      const saved = await env.BUCKET.put(key, body, {
        onlyIf: condition,
        httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
      });
      if (!saved) return problem(409, 'SYNC_CONFLICT', 'Your passport changed on another device. Reload the latest version before saving.');
      return json(state(user, profile, saved.etag), 200, { ETag: saved.httpEtag || `"${saved.etag}"` });
    } catch (error) {
      if (error.status) return problem(error.status, error.code, error.message);
      // Never return storage keys, account IDs, stack traces, or stored content.
      return problem(503, 'SYNC_UNAVAILABLE', 'Your passport could not sync right now. Keep this tab open and try again.');
    }
  },
};

export default worker;
