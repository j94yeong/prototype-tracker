# First-Click Tracker

A local-only, no-server first-click test harness for prototypes. The owner opens a native desktop app, loads a prototype, and testers click once — a `.fct` results file is saved automatically. The owner drags all returned files into the viewer to see where everyone clicked.

---

## What's Included

| File / Folder | What it is |
|---|---|
| `desktop-app/` | Native desktop app (macOS + Windows) — the main way to run tests |
| `viewer.html` | Standalone results viewer — drag in `.fct` files to review clicks |
| `tracker.js` + `lib/` | Legacy script-injection method (plain HTML only, no app needed) |

---

## Desktop App (Recommended)

The desktop app loads any prototype in an embedded real browser window and captures the first click from the outside — **no changes to your prototype files needed**.

### Supported prototype types

| Type | How to load |
|---|---|
| Built HTML (`dist/index.html`) | File / Image tab → browse or drag |
| Image (PNG, JPG, GIF, SVG) | File / Image tab → browse or drag |
| Vite / dev server | URL tab → paste `http://localhost:5173/` |
| Figma shared link | URL tab → paste the Figma prototype URL |

> For Figma: set the prototype share to **"Anyone with the link can view"** before sending.

### Owner — setting up a test

1. Open the **First Click Tracker** app
2. Choose a tab:
   - **File / Image** — drag or browse for an `index.html` or image file
   - **URL / Localhost** — paste a localhost URL or Figma shared link
3. Enter a tester name (optional)
4. Click **Load Prototype**
5. The prototype opens in a separate window

### Tester — taking the test

1. The prototype opens — it looks and behaves exactly like a normal browser window
2. Click once on whatever you would click first
3. A save dialog appears → save the `session_XXXXXXXX.fct` file
4. Send that file back to the owner

> One click only. Subsequent clicks are ignored.

### Owner — reviewing results

1. Open `viewer.html` by double-clicking it
2. Drag in one or many `.fct` files (or click **Load .fct files**)
3. Each session appears in the sidebar with tester name, time-to-click, and a validity badge
4. The screenshot shows a **ring+dot hotspot** for each click
5. Hover a hotspot for details — tester name, clicked element, element text, time
6. Click a session in the sidebar to highlight its hotspot

---

## Building the Desktop App

You need Node.js installed. Run once to install dependencies:

```bash
cd desktop-app
npm install
```

**Run in development:**
```bash
npm run dev
```

**Build installer:**
```bash
npm run build:mac    # → dist/First Click Tracker-x.x.x-arm64.dmg  (run on Mac)
npm run build:win    # → dist/First Click Tracker Setup x.x.x.exe   (run on Windows)
```

> **Unsigned builds:** macOS shows a Gatekeeper warning on first launch. Testers right-click the app → **Open** → **Open** to bypass it (once only). Windows shows a SmartScreen prompt — click **Run anyway**.

---

## Legacy: Script-Injection Method

For plain HTML prototypes when you don't want to use the desktop app.

### Setup

1. Copy these files into the same folder as your prototype:
   ```
   tracker.js
   lib/sha256.js
   lib/canonical.js
   lib/html2canvas.min.js
   ```

2. Paste this snippet just before `</body>` in your prototype HTML:
   ```html
   <script src="lib/sha256.js"></script>
   <script src="lib/canonical.js"></script>
   <script src="lib/html2canvas.min.js"></script>
   <script src="tracker.js"></script>
   ```

3. Zip the folder (including `lib/` and `tracker.js`) and send to testers.

### Tester flow

1. Unzip and double-click the `.html` file
2. Enter name (optional) and click **Start Test**
3. Click once — a `.fct` file downloads automatically
4. Send the `.fct` file back

> Screenshot quality may be limited on complex pages (SVG foreignObject browser restriction).

---

## Viewer Details

- Works under `file://` — no server needed, just double-click
- **Deduplication:** if the same tester submits multiple files, only the earliest session is kept
- **Validity badge:** ⚠ means the file's signature doesn't match — advisory only, never auto-rejected. You decide whether to include the session.

---

## Notes

- `.fct` files are base64-encoded JSON containing click coordinates, timing, element info, and a start-state screenshot
- Nothing is sent anywhere — all data stays local
- Integrity signing is friction, not cryptographic security. The secret ships in the code, so a motivated tester could forge a valid signature. Use it to flag accidental corruption or obvious tampering.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| App won't open on Mac | Right-click the app → **Open** → **Open** (Gatekeeper bypass for unsigned builds) |
| Prototype window is blank | Check the URL is correct and the dev server is running |
| Figma link shows login wall | Set the Figma prototype share to "Anyone with the link can view" |
| `.fct` file not saving | Don't cancel the save dialog — click anywhere to close if it appeared behind another window |
| Viewer shows no hotspot | Session may have no screenshot. Click data is still shown in the sidebar. |
| ⚠ on every session | `tracker.js` and `viewer.html` may be from different repo versions — re-copy from the same checkout |
| Legacy: screenshot is blank | Some browsers restrict SVG foreignObject capture. Click data is still recorded correctly. |
