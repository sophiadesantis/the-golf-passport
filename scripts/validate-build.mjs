import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = new URL('../dist/server/index.js', import.meta.url);
const source = await readFile(entry, 'utf8');
assert.ok(!/^import\s/m.test(source), 'Worker must not require unresolved imports');
assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(source), 'Bundle must not contain recognizable credentials');
assert.deepEqual(
  JSON.parse(await readFile(resolve(root, 'dist/.openai/hosting.json'), 'utf8')),
  JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8')),
  'Packaged hosting configuration must match the source',
);
const { default: worker } = await import(entry.href + `?check=${Date.now()}`);
assert.equal(typeof worker?.fetch, 'function', 'Worker needs a default fetch handler');
let checks = 3;
const origin = 'https://golf-passport.example';
const request = (path, options) => worker.fetch(new Request(origin + path, options), {});
const assets = ['index.html', 'app.js', 'data.js', 'cloud.js', 'style.css',
  ...(await readdir(resolve(root, 'assets'))).filter((file) => /^[a-z0-9-]+\.svg$/i.test(file)).map((file) => `assets/${file}`),
];
for (const file of assets) {
  const response = await request('/' + file);
  assert.equal(response.status, 200, file);
  assert.ok(response.headers.get('content-type'), `${file}: content type`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', file);
  assert.equal(await response.text(), await readFile(resolve(root, file), 'utf8'), `${file}: exact public contents`);
  checks += 4;
}
assert.equal((await request('/')).status, 200);
assert.equal((await request('/?view=passport')).status, 200);
assert.equal((await request('/', { method: 'HEAD' })).status, 200);
assert.equal(await (await request('/', { method: 'HEAD' })).text(), '');
assert.equal((await request('/', { method: 'POST' })).status, 405);
checks += 5;
for (const path of ['/server/worker.js', '/.openai/hosting.json', '/tests/data.test.mjs', '/missing', '/assets/missing.svg', '/scripts/build.mjs']) {
  assert.equal((await request(path)).status, 404, `${path} must not be public`);
  checks++;
}
for (const path of ['/api/session', '/api/passport']) {
  const response = await request(path);
  assert.equal(response.status, 401, `${path} requires native authenticated identity`);
  assert.equal((await response.json()).error.code, 'SIGN_IN_REQUIRED');
  checks += 2;
}
assert.equal((await request('/api/missing')).status, 404);
checks++;
console.log(`Deployment bundle passed ${checks} checks: exact assets, restricted routes, credential scan, manifest, and unauthenticated API rejection.`);
