import test from 'node:test';
import assert from 'node:assert/strict';
import { getSession, cloudLoad, cloudSave, cloudDelete, CloudError } from '../cloud.js';

const profile = { id: 'p1', name: 'Golfer', courses: [], bucket: [], createdAt: '2026-11-18T00:00:00Z' };
const state = { user: { id: 'u1', name: 'Golfer' }, profile, revision: 'r1' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('session recognizes anonymous accounts and local static previews', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response({}, 401));
  assert.equal(await getSession(), null);
  globalThis.fetch.mock.mockImplementation(async () => response({}, 404));
  assert.deepEqual(await getSession(), { local: true });
  globalThis.fetch.mock.mockImplementation(async () => new Response('<html>Static preview</html>', { headers: { 'Content-Type': 'text/html' } }));
  assert.deepEqual(await getSession(), { local: true });
});

test('save uses conditional creation and revision headers with authenticated browser credentials', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push({ path, options }); return response(state); });
  assert.equal((await cloudSave(profile, null)).revision, 'r1');
  assert.equal(calls[0].path, '/api/passport');
  assert.equal(calls[0].options.headers['If-None-Match'], '*');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(JSON.parse(calls[0].options.body).profile.name, 'Golfer');
  await cloudSave(profile, 'revision-2');
  assert.equal(calls[1].options.headers['If-Match'], '"revision-2"');
});

test('client exposes conflicts for explicit reload instead of silently overwriting', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response({ error: { code: 'SYNC_CONFLICT', message: 'Reload the latest passport.' } }, 409));
  await assert.rejects(cloudSave(profile, 'old'), (error) => error instanceof CloudError && error.status === 409 && error.code === 'SYNC_CONFLICT');
});

test('delete requires the latest revision and passes its conditional header', async (t) => {
  assert.throws(() => cloudDelete(null), (error) => error.status === 428);
  let requested;
  t.mock.method(globalThis, 'fetch', async (path, options) => { requested = options; return response({ ...state, profile: null, revision: 'deleted' }); });
  const deleted = await cloudDelete('current');
  assert.equal(deleted.profile, null);
  assert.equal(requested.method, 'DELETE');
  assert.equal(requested.headers['If-Match'], '"current"');
});

test('network failures, expired sign-ins and malformed service responses stay visible', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await assert.rejects(cloudLoad(), (error) => error.code === 'NETWORK_ERROR');
  globalThis.fetch.mock.mockImplementation(async () => response({}, 401));
  await assert.rejects(cloudSave(profile, 'r1'), (error) => error.status === 401);
  globalThis.fetch.mock.mockImplementation(async () => response({ user: { id: 'u1' } }));
  await assert.rejects(cloudLoad(), (error) => error.code === 'INVALID_RESPONSE');
});
