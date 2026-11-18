# The Golf Passport

A colorful golf journal for the courses you have played and the courses you dream of playing. The app uses original SVG illustrations and plain browser modules, so there are no dependencies to install.

## Your passport

- Keep **Courses played** and **Bucket list** together in a responsive two-column clubhouse.
- Use either list’s **Update** button to add a course.
- Record a course name, location, score, date played, favorite holes, comments, and a rating from **0 to 5 in half-star steps**.
- Upload course photos; the browser resizes images before storing them.
- Place a newly logged course among your existing courses, then drag cards to reorder your personal ranking. Keyboard-friendly movement controls provide another way to rank them.
- Search your journal and sort by personal ranking, rating, date, or name.
- Check a bucket-list course when played, then log the round. Course names and locations carry into the round form.
- Revisit photos in the photo album.
- Export a JSON backup, restore a validated backup, or delete your passport from account controls.

The app starts with empty personal lists. Decorative course artwork is illustrative; no sample rounds are presented as your history.

## Accounts and saving

On the hosted Sites version, the platform’s **Sign in with ChatGPT** flow supplies authenticated identity to the Worker. Each signed-in account has a separate passport stored in a private R2 bucket. Photos are part of the saved passport. The app also keeps a browser copy in IndexedDB.

The browser never receives a public R2 object URL or storage key. The server derives a storage key from the account identity. Same-origin write checks and conditional revisions prevent cross-site changes and detect concurrent edits from another device. A conflict requires loading the latest passport before saving again. The maximum synced passport is 16 MB; export backups and remove photos if you reach this limit.

The platform must strip untrusted identity headers and provide its own trusted authentication headers. The Worker is intended to run behind that platform authentication layer; do not deploy its API as a standalone public service that trusts client-supplied identity headers.

**Local preview and GitHub Pages are browser-only.** They do not provide account authentication or cross-device sync. Preview passports are stored in that browser, and anyone with access to the browser profile can open them. Clearing website storage can erase the browser copy. Export a backup when you need a portable copy. A GitHub Pages deployment can host the frontend, but synced accounts require the Worker hosting described below.

## Local preview

Use a current Node.js release (Node 20 or later):

```sh
node server.mjs
```

Open the printed `http://127.0.0.1:4173` address. Override the port with the `PORT` environment variable if needed. The local server serves the frontend only; `/api/session` returns 404, allowing the app to identify browser-only preview mode.

## Checks and deployment build

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/validate-build.mjs
```

The build writes a self-contained ESM Worker to `dist/server/index.js`. It combines the strict data validation rules, account API, and an explicit allowlist of public frontend files. It also copies `.openai/hosting.json` into `dist/.openai/hosting.json`. It does not copy private records or browser storage. The validation script checks exact asset responses, API authentication rejection, non-public source routes, recognizable credential patterns, and matching hosting configuration.

For Sites publication, preserve the existing `project_id` in `.openai/hosting.json` and declare the private R2 binding as `BUCKET`. Sites must provision that binding and provide the native identity layer. Package and publish through the Sites source workflow; do not publish the source tree itself as a static directory. This repository does not contain a public deployment URL or claim that deployment has been completed.

## Project files

- `index.html`, `app.js`, `style.css`: interface and interactions.
- `assets/`: original golf illustrations and favicon.
- `data.js`: input validation, ranking operations, browser storage.
- `cloud.js`: same-origin account sync client.
- `server/worker.js`: authenticated, revision-aware private storage API.
- `server.mjs`: local frontend preview server.
- `scripts/build.mjs`: dependency-free Worker packaging.
- `scripts/validate-build.mjs`: deployment bundle checks.
- `tests/`: automated behavior, client, and server checks.

Do not add exported passports, personal photos, or private datasets to GitHub. The application code is separate from runtime user records.
