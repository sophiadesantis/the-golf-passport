import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourse, normalizeBucket, moveCourse, validateBackup } from '../data.js';

// Export the same cases so environments without a node CLI can run assertions.
export const testCases = [];
const test = (name, run) => testCases.push({ name, run });

const course = (name, extra = {}) => normalizeCourse({ id: name, name, ...extra });
const profile = (extra = {}) => ({
  id: 'passport-one', name: 'Test golfer', createdAt: '2026-01-01T00:00:00Z', courses: [], bucket: [], ...extra,
});

test('a course retains golfer details and every allowed half-star rating', () => {
  for (let rating = 0; rating <= 5; rating += 0.5) {
    const entry = normalizeCourse({ name: '  Links Course  ', score: 82, favoriteHoles: '3, 7 & 18', rating, comments: 'A great walk.', playedAt: '2026-11-18' });
    assert.equal(entry.name, 'Links Course');
    assert.equal(entry.score, '82');
    assert.equal(entry.rating, rating);
    assert.equal(entry.favoriteHoles, '3, 7 & 18');
    assert.equal(entry.playedAt, '2026-11-18');
    assert.ok(entry.id);
  }
});

test('invalid ratings, blank names, impossible dates, and oversized comments fail', () => {
  for (const rating of [-0.5, 5.5, 2.3, NaN, Infinity]) assert.throws(() => course('Links', { rating }), /Rating/);
  assert.throws(() => normalizeCourse({ name: '  ' }), /Course name is required/);
  assert.throws(() => course('Links', { playedAt: '2026-02-30' }), /valid date/);
  assert.throws(() => course('Links', { comments: 'x'.repeat(10001) }), /too long/);
});

test('photos accept local raster images and reject active or remote content', () => {
  const photo = { id: 'photo1', name: 'My shot', dataUrl: 'data:image/jpeg;base64,/9j/AA==' };
  assert.deepEqual(course('Links', { photos: [photo] }).photos, [photo]);
  for (const dataUrl of ['https://example.com/photo.jpg', 'data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', 'data:image/jpeg;base64,abc<>']) {
    assert.throws(() => course('Links', { photos: [{ dataUrl }] }), /Photos must/);
  }
  assert.throws(() => course('Links', { photos: Array(13).fill(photo) }), /up to 12/);
});

test('rankings move in both directions without changing course details or original list', () => {
  const original = [course('A'), course('B'), course('C'), course('D')];
  const moved = moveCourse(original, 'A', 2);
  assert.deepEqual(moved.map((entry) => entry.id), ['B', 'C', 'A', 'D']);
  assert.deepEqual(original.map((entry) => entry.id), ['A', 'B', 'C', 'D']);
  assert.equal(moved[2], original[0]);
  assert.deepEqual(moveCourse(moved, 'D', 0).map((entry) => entry.id), ['D', 'B', 'C', 'A']);
  assert.deepEqual(moveCourse(original, 'B', 999).map((entry) => entry.id), ['A', 'C', 'D', 'B']);
  assert.deepEqual(moveCourse(original, 'B', -1).map((entry) => entry.id), ['B', 'A', 'C', 'D']);
  assert.deepEqual(moveCourse(original, 'missing', 0), original);
});

test('bucket-list records preserve course names and have no made-up golf details', () => {
  const bucket = normalizeBucket({ name: 'My future course', location: 'Scotland' });
  assert.equal(bucket.name, 'My future course');
  assert.equal(bucket.location, 'Scotland');
  assert.equal(bucket.rating, undefined);
  assert.equal(bucket.score, undefined);
});

test('backup round trips rankings, photos, and bucket-list entries', () => {
  const input = profile({ courses: [course('C'), course('B'), course('A')], bucket: [normalizeBucket({ name: 'Future Links' })] });
  const restored = validateBackup(JSON.parse(JSON.stringify({ version: 1, profile: input })));
  assert.deepEqual(restored.courses.map((entry) => entry.name), ['C', 'B', 'A']);
  assert.equal(restored.bucket[0].name, 'Future Links');
  assert.equal(restored.id, input.id);
  assert.equal(restored.name, input.name);
});

test('malformed and future backups fail rather than silently corrupt data', () => {
  assert.throws(() => validateBackup({ version: 2, profile: profile() }), /not supported/);
  assert.throws(() => validateBackup(profile({ courses: 'not a list' })), /courses list/);
  assert.throws(() => validateBackup(profile({ courses: [course('Duplicate'), course('Duplicate')] })), /duplicate record IDs/);
  assert.throws(() => validateBackup(profile({ bucket: new Array(1001).fill({ name: 'A' }) })), /up to 1000/);
  assert.throws(() => validateBackup(profile({ name: '' })), /Passport name is required/);
  assert.throws(() => validateBackup(null), /must be an object/);
});

test('backup normalization drops unknown fields including injected object properties', () => {
  const restored = validateBackup({ ...profile(), password: 'should not exist', courses: [{ name: '<script>alert(1)</script>', admin: true }] });
  assert.equal(restored.password, undefined);
  assert.equal(restored.courses[0].admin, undefined);
  // User text is retained as text; the renderer must use textContent rather than HTML.
  assert.equal(restored.courses[0].name, '<script>alert(1)</script>');
});

for (const { name, run } of testCases) nodeTest(name, run);
