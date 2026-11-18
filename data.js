/** Browser-only passport storage. No data is sent to a server. */
export const ACTIVE_PROFILE_KEY = 'golf-passport-active-profile';
export const BACKUP_VERSION = 1;
const DB_NAME = 'the-golf-passport';
const STORE = 'profiles';
const MAX_COURSES = 500;
const MAX_BUCKET = 1000;
const MAX_PHOTOS = 12;
const MAX_PHOTO_LENGTH = 3 * 1024 * 1024;
let databasePromise;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function text(value, label, maxLength, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must be text.`);
  }
  const result = String(value).trim();
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > maxLength) throw new Error(`${label} is too long (maximum ${maxLength} characters).`);
  return result;
}

function id(value) {
  if (value === undefined || value === null || value === '') {
    return globalThis.crypto?.randomUUID?.() || `golf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return text(value, 'Record ID', 100, true);
}

function timestamp(value, label, fallback = new Date().toISOString()) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is not a valid date.`);
  }
  return new Date(value).toISOString();
}

function playedDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new Error('Date played is not a valid date.');
  }
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Date played is not a valid date.');
  }
  return date;
}

function photos(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_PHOTOS) {
    throw new Error(`A course can have up to ${MAX_PHOTOS} photos.`);
  }
  return input.map((photo) => {
    record(photo, 'Photo');
    const dataUrl = photo.dataUrl;
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PHOTO_LENGTH ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
      throw new Error('Photos must be JPEG, PNG, or WebP images smaller than 2.25 MB.');
    }
    return { id: id(photo.id), dataUrl, name: text(photo.name, 'Photo name', 200) || 'Course photo' };
  });
}

/** Strict normalization is used for both forms and imported backups. */
export function normalizeCourse(input) {
  record(input, 'Course');
  const rating = input.rating === undefined || input.rating === '' ? 0 : Number(input.rating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isInteger(rating * 2)) {
    throw new Error('Rating must be between 0 and 5 in half-star steps.');
  }
  return {
    id: id(input.id),
    name: text(input.name, 'Course name', 160, true),
    location: text(input.location, 'Location', 160),
    score: text(input.score, 'Score', 40),
    favoriteHoles: text(input.favoriteHoles, 'Favorite holes', 400),
    rating,
    comments: text(input.comments, 'Comments', 10000),
    photos: photos(input.photos),
    playedAt: playedDate(input.playedAt),
    createdAt: timestamp(input.createdAt, 'Created date'),
  };
}

export function normalizeBucket(input) {
  record(input, 'Bucket-list course');
  return {
    id: id(input.id),
    name: text(input.name, 'Course name', 160, true),
    location: text(input.location, 'Location', 160),
    createdAt: timestamp(input.createdAt, 'Created date'),
  };
}

/** Returns a new ranking; the caller's array is never mutated. */
export function moveCourse(courses, courseId, toIndex) {
  if (!Array.isArray(courses)) throw new Error('Courses must be a list.');
  if (!Number.isInteger(toIndex)) throw new Error('Ranking position must be a whole number.');
  const fromIndex = courses.findIndex((course) => course.id === courseId);
  if (fromIndex === -1) return courses.slice();
  const result = courses.slice();
  const [course] = result.splice(fromIndex, 1);
  result.splice(Math.max(0, Math.min(toIndex, result.length)), 0, course);
  return result;
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${label} contains duplicate record IDs.`);
    ids.add(item.id);
  }
}

/** Accept a profile or the app's {version:1, profile} backup envelope. */
export function validateBackup(input) {
  const envelope = record(input, 'Passport backup');
  if ('version' in envelope && envelope.version !== BACKUP_VERSION) {
    throw new Error('This backup version is not supported.');
  }
  const profile = record('profile' in envelope ? envelope.profile : envelope, 'Passport');
  if (!Array.isArray(profile.courses) || profile.courses.length > MAX_COURSES) {
    throw new Error(`A passport must contain a courses list with up to ${MAX_COURSES} courses.`);
  }
  if (!Array.isArray(profile.bucket) || profile.bucket.length > MAX_BUCKET) {
    throw new Error(`A passport must contain a bucket list with up to ${MAX_BUCKET} courses.`);
  }
  const courses = profile.courses.map(normalizeCourse);
  const bucket = profile.bucket.map(normalizeBucket);
  uniqueIds(courses, 'Courses list');
  uniqueIds(bucket, 'Bucket list');
  return {
    id: id(profile.id),
    name: text(profile.name, 'Passport name', 80, true),
    createdAt: timestamp(profile.createdAt, 'Passport created date'),
    courses,
    bucket,
  };
}

export async function openStore() {
  if (databasePromise) return databasePromise;
  if (!globalThis.indexedDB) {
    throw new Error('Your browser cannot save passports. Please use a browser with IndexedDB enabled.');
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onerror = () => { databasePromise = undefined; reject(new Error('Could not open passport storage. Check your browser’s privacy or storage settings.')); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('Close other Golf Passport tabs and try again.')); };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
  });
  return databasePromise;
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('This browser is out of storage. Export a backup, then remove some photos and try again.');
  }
  return new Error('Your changes could not be saved. Keep this tab open and export a backup before trying again.');
}

export async function loadProfiles() {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(storageError(request.error));
  });
}

export async function saveProfile(input) {
  const profile = validateBackup(input);
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(profile);
    transaction.oncomplete = () => resolve(profile);
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

export async function deleteProfile(profileId) {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(profileId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}
