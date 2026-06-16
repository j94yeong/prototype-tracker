# First Click Tracker — Desktop App

A native Electron app that replaces the "inject a script into the
prototype" approach. The owner loads any static `index.html` prototype into
a real embedded Chromium window, captures a start-state screenshot, waits
for the first click, then signs and saves a `.fct` session file using the
exact same schema and signing algorithm as the existing `tracker.js` /
`lib/canonical.js` / `lib/sha256.js` harness. The resulting `.fct` files
verify successfully in the repo's existing `viewer.html` with no changes.

The prototype's own files are never modified — the click listener is
injected purely from the Electron side via `webPreferences.preload`
(`preload-target.js`).

## Requirements

- Node.js (LTS) and npm
- macOS or Windows for building installable packages (mac builds require
  running on macOS; Windows builds require running on Windows or a
  configured cross-build environment)

## Setup

```bash
cd desktop-app
npm install
```

## Run in development

```bash
npm run dev
```

This launches the app via `electron .`. A small window opens with a drop
zone / file picker for the prototype's `index.html` and an optional tester
name field. Click "Load Prototype" to open the prototype in its own window;
the app screenshots it immediately, then waits for the first click. As soon
as a click happens, a native save dialog opens for the `.fct` file
(default name `session_<sessionId-first8>.fct`).

## Build installers

```bash
npm run build:mac    # produces a .dmg (must run on macOS)
npm run build:win    # produces an NSIS .exe installer (must run on Windows,
                      # or Windows cross-build tooling on Linux/macOS)
npm run build        # both, where supported
```

Build artifacts are written to `desktop-app/dist/`.

No code signing certificates are configured. Unsigned builds will trigger
Gatekeeper / SmartScreen warnings on first launch — that's expected for an
internal tool without a paid signing certificate.

### CI builds (GitHub Actions)

`.github/workflows/build-desktop-app.yml` builds both the macOS `.dmg` and
Windows `.exe` on their respective native runners, so you don't need either
machine yourself.

- **Tag push** (`git tag v1.0.0 && git push --tags`) — builds both installers
  and attaches them to a new GitHub Release automatically.
- **Manual run** — trigger it from the Actions tab ("Run workflow") to get
  build artifacts without cutting a release; they're attached to the run as
  downloadable artifacts.

## How schema compatibility is preserved

- `lib/sha256.js` and `lib/canonical.js` in `desktop-app/lib/` are thin
  CommonJS adapters that `require()` the **same** `../../lib/sha256.js` and
  `../../lib/canonical.js` files used by the browser-based harness (those
  files were given a `module.exports` guard so they work under both
  `<script>` tag and Node `require()`, without changing their browser
  behavior or the hashing/serialization algorithm itself).
- In a packaged app, electron-builder's `extraResources` config copies the
  repo's `/lib` directory into the app's `resources/shared-lib` folder so
  the same files ship with the installer; the adapters fall back to that
  path when the dev-relative path doesn't exist.
- `main.js` builds the session object with the identical field names and
  nesting as `tracker.js` (`schemaVersion`, `sessionId`, `testerName`,
  `sessionStart.{wallMs,perfMs}`, `click.{wallMs,perfMs,timeToClickMs,x,y,
  xPct,yPct,viewportW,viewportH,targetSelector,targetText}`,
  `screenshot.{dataURI,width,height,dpr}`), signs with
  `sha256hex(canonicalJSON(data) + '|TRACKER_SECRET_v1')`, and adds the
  same `integrity.{sig,secret}` fields before base64-encoding the JSON and
  writing it to a `.fct` file — matching `tracker.js` byte-for-byte in
  algorithm and field structure.

## Notes / deviations from a literal "browser tracker" port

- `dpr` (devicePixelRatio equivalent) is taken from
  `screen.getPrimaryDisplay().scaleFactor` rather than reading
  `window.devicePixelRatio` inside the prototype, since the screenshot is
  captured from the Electron main process via
  `webContents.capturePage()`, not from in-page JS. This is documented in
  a comment in `main.js`.
- `sessionStart.perfMs` is read via
  `webContents.executeJavaScript('performance.now()')` against the loaded
  prototype's own page context immediately after `did-finish-load`, so it
  uses the same monotonic clock the prototype's click event will later be
  timed against in `preload-target.js`.
