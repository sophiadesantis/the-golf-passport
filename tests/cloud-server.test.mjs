import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MAX_PASSPORT_BYTES } from '../server/worker.js';
import { normalizeCourse } from '../data.js';

class FakeR2 {
  entries = new Map();
  writes = 0;
  async get(key) {
    const value = this.entries.get(key);
    if (!value) return null;
    return { etag: value.etag, httpEtag: `"${value.etag}"`, size: Buffer.byteLength(value.body), json: async () => JSON.parse(value.body) };
  }
  async put(key, body, { onlyIf }) {
    const existing = this.entries.get(key);
    const match = onlyIf.get('if-match');
    if (match && (!existing || match !== `"${existing.etag}"`)) return null;
    if (onlyIf.get('if-none-match') === '*' && existing) return null;
    const etag = `revision-${++this.writes}`;
    this.entries.set(key, { body, etag });
    return { etag, httpEtag: `"${etag}"` };
  }
}

const passport = (name = 'My passport') => ({
  id: 'my-passport', name, createdAt: '2026-11-18T00:00:00Z',
  courses: [normalizeCourse({ id: 'course-1', name: 'Test Links', score: '83', rating: 4.5,
    photos: [{ id: 'photo1', name: 'My course', dataUrl: 'data:image/jpeg;base64,/9j/AA==' }] })],
  bucket: [{ id: 'future-1', name: 'Future Course' }],
});

function req(path = '/api/passport', { user = 'golfer-a', method = 'GET', revision, profile, origin = 'https://golf.example', headers = {}, body } = {}) {
  return new Request(`https://golf.example${path}`, {
    method,
    headers: {
      ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.com` } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : method === 'PUT' ? { 'If-None-Match': '*' } : {}),
      ...headers,
    },
    body: body ?? (profile ? JSON.stringify({ profile }) : undefined),
  });
}

test('API requires platform identity and configured storage', async () => {
  const env = { BUCKET: new FakeR2() };
  assert.equal((await worker.fetch(req('/api/session', { user: null }), env)).status, 401);
  assert.equal((await worker.fetch(req('/api/passport', { user: null, method: 'PUT', profile: passport() }), env)).status, 401);
  assert.equal((await worker.fetch(req(), {})).status, 503);
  assert.equal(env.BUCKET.writes, 0);
});

test('authenticated passports sync course details and photos across requests', async () => {
  const env = { BUCKET: new FakeR2() };
  const empty = await (await worker.fetch(req('/api/session'), env)).json();
  assert.equal(empty.profile, null);
  assert.equal(empty.revision, null);
  const savedResponse = await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport() }), env);
  assert.equal(savedResponse.status, 200);
  assert.equal(savedResponse.headers.get('cache-control'), 'private, no-store');
  const saved = await savedResponse.json();
  assert.ok(saved.revision);
  const restored = await (await worker.fetch(req(), env)).json();
  assert.equal(restored.profile.courses[0].rating, 4.5);
  assert.equal(restored.profile.courses[0].photos[0].dataUrl, 'data:image/jpeg;base64,/9j/AA==');
  assert.equal(restored.profile.bucket[0].name, 'Future Course');
  assert.equal(restored.revision, saved.revision);
});

test('each platform user has an isolated hashed storage key', async () => {
  const env = { BUCKET: new FakeR2() };
  await worker.fetch(req('/api/passport', { user: 'private-account-a', method: 'PUT', profile: passport('A') }), env);
  const other = await (await worker.fetch(req('/api/passport', { user: 'private-account-b' }), env)).json();
  assert.equal(other.profile, null);
  await worker.fetch(req('/api/passport', { user: 'private-account-b', method: 'PUT', profile: passport('B') }), env);
  const first = await (await worker.fetch(req('/api/passport', { user: 'private-account-a' }), env)).json();
  assert.equal(first.profile.name, 'A');
  assert.equal(env.BUCKET.entries.size, 2);
  for (const key of env.BUCKET.entries.keys()) {
    assert.match(key, /^passports\/v1\/[a-f0-9]{64}\.json$/);
    assert.ok(!key.includes('private-account'));
  }
});

test('conditional revisions prevent lost updates and concurrent initial creation', async () => {
  const env = { BUCKET: new FakeR2() };
  const first = await (await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport('First') }), env)).json();
  const duplicateCreate = await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport('Duplicate') }), env);
  assert.equal(duplicateCreate.status, 409);
  const results = await Promise.all([
    worker.fetch(req('/api/passport', { method: 'PUT', revision: first.revision, profile: passport('Device A') }), env),
    worker.fetch(req('/api/passport', { method: 'PUT', revision: first.revision, profile: passport('Device B') }), env),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const current = await (await worker.fetch(req(), env)).json();
  assert.ok(['Device A', 'Device B'].includes(current.profile.name));
  assert.notEqual(current.revision, first.revision);
});

test('deletion clears course/photo content and cannot erase a newer revision', async () => {
  const env = { BUCKET: new FakeR2() };
  const first = await (await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport() }), env)).json();
  assert.equal((await worker.fetch(req('/api/passport', { method: 'DELETE', revision: 'stale' }), env)).status, 409);
  const deleted = await (await worker.fetch(req('/api/passport', { method: 'DELETE', revision: first.revision }), env)).json();
  assert.equal(deleted.profile, null);
  assert.ok(deleted.revision);
  const storedBody = [...env.BUCKET.entries.values()][0].body;
  assert.ok(!storedBody.includes('Test Links'));
  assert.ok(!storedBody.includes('data:image'));
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', revision: first.revision, profile: passport() }), env)).status, 409);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', revision: deleted.revision, profile: passport('New passport') }), env)).status, 200);
});

test('cross-origin writes and missing or malformed revisions are rejected', async () => {
  const env = { BUCKET: new FakeR2() };
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport(), origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'DELETE' }), env)).status, 428);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport(), headers: { 'If-None-Match': '', 'If-Match': '*' } }), env)).status, 428);
  assert.equal(env.BUCKET.writes, 0);
});

test('invalid, non-JSON, and excessive uploads fail without changing storage', async () => {
  const env = { BUCKET: new FakeR2() };
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', body: '{bad json' }), env)).status, 400);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', body: 'null' }), env)).status, 400);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', profile: { ...passport(), name: '' } }), env)).status, 400);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', profile: passport(), headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal((await worker.fetch(req('/api/passport', { method: 'PUT', body: '{}', headers: { 'Content-Length': String(MAX_PASSPORT_BYTES + 1) } }), env)).status, 413);
  assert.equal(env.BUCKET.writes, 0);
});

test('error responses reveal no storage internals and unsupported routes return 404', async () => {
  const env = { BUCKET: { get: async () => { throw new Error('secret-key-and-account'); } } };
  const response = await worker.fetch(req(), env);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret-key'));
  assert.equal((await worker.fetch(req('/any-page'), env)).status, 404);
  assert.equal((await worker.fetch(req('/api/session', { method: 'DELETE', revision: 'r1' }), env)).status, 405);
});

test('percent-encoded platform display names decode safely', async () => {
  const response = await worker.fetch(req('/api/session', { headers: {
    'oai-authenticated-user-full-name': encodeURIComponent('Zoë Golfer'),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  } }), { BUCKET: new FakeR2() });
  assert.equal((await response.json()).user.name, 'Zoë Golfer');
});
