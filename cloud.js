import { validateBackup } from './data.js';

export class CloudError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

async function requestCloud(path, options = {}, allowLocal = false) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...options.headers },
    });
  } catch {
    throw new CloudError('Your passport could not sync. Check your connection, keep this tab open, and try again.');
  }
  if (allowLocal && response.status === 404) return { local: true };
  if (response.status === 401) {
    if (allowLocal) return null;
    throw new CloudError('Your sign-in expired. Sign in again before syncing your passport.', 401, 'SIGN_IN_REQUIRED');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (allowLocal && response.ok) return { local: true };
    throw new CloudError('The sync service returned an unexpected response. Please try again.', response.status, 'INVALID_RESPONSE');
  }
  let body;
  try { body = await response.json(); }
  catch { throw new CloudError('The sync service returned an unreadable response. Please try again.', response.status, 'INVALID_RESPONSE'); }
  if (!response.ok) {
    throw new CloudError(body.error?.message || 'Your passport could not sync. Please try again.', response.status, body.error?.code || 'SYNC_ERROR');
  }
  if (!body.user?.id || !('profile' in body) || !('revision' in body)) {
    throw new CloudError('The sync service returned an incomplete passport. Please try again.', response.status, 'INVALID_RESPONSE');
  }
  if (body.profile !== null) body.profile = validateBackup(body.profile);
  return body;
}

export function getSession() {
  return requestCloud('/api/session', {}, true);
}

export function cloudLoad() {
  return requestCloud('/api/passport', {}, true);
}

export function cloudSave(profile, revision = null) {
  const normalized = validateBackup(profile);
  return requestCloud('/api/passport', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(revision ? { 'If-Match': `"${revision}"` } : { 'If-None-Match': '*' }),
    },
    body: JSON.stringify({ profile: normalized }),
  });
}

export function cloudDelete(revision) {
  if (!revision) throw new CloudError('Reload your passport before deleting it.', 428, 'REVISION_REQUIRED');
  return requestCloud('/api/passport', {
    method: 'DELETE',
    headers: { 'If-Match': `"${revision}"` },
  });
}
