# First-Click Tracker

A local-only, no-server first-click test harness for exported HTML prototypes. Testers double-click an HTML file, click once, and a results file is saved. You load those files into the viewer to see where everyone clicked.

---

## How It Works

1. You **inject** the tracker into your prototype HTML.
2. Testers **open** the HTML file by double-clicking it — no server needed.
3. They enter their name (optional) and click **Start Test**, then click once on the prototype.
4. A `.fct` file downloads automatically. They send it back to you.
5. You open **viewer.html**, drag in all the `.fct` files, and see every click plotted on a screenshot.

---

## File Layout

```
your-prototype/
├── index.html              ← your prototype (edit to add the snippet)
├── tracker.js              ← copy from this repo
├── lib/
│   ├── sha256.js           ← copy from this repo
│   ├── canonical.js        ← copy from this repo
│   └── html2canvas.min.js  ← copy from this repo
└── ...

viewer.html                 ← keep this separately; open to review results
```

---

## Setup (Owner)

### Step 1 — Copy the tracker files

Copy these files from this repo **into the same folder as your prototype**:

```
tracker.js
lib/sha256.js
lib/canonical.js
lib/html2canvas.min.js
```

### Step 2 — Add the snippet to your prototype HTML

Open your prototype's `.html` file and paste the following **just before `</body>`**:

```html
<script src="lib/sha256.js"></script>
<script src="lib/canonical.js"></script>
<script src="lib/html2canvas.min.js"></script>
<script src="tracker.js"></script>
```

Save the file. That's it — the tracker is injected.

### Step 3 — Send the folder to testers

Zip the entire prototype folder (including the `lib/` subfolder and `tracker.js`) and send it to testers. They only need to unzip and double-click the HTML file.

> **Do not send `viewer.html`** to testers — they don't need it.

---

## Running a Test (Tester)

1. Unzip the folder you received.
2. Double-click the `.html` file to open it in a browser.
3. A small overlay will appear — enter your name (optional) and click **Start Test**.
4. The prototype loads normally. Click on whatever you would click first.
5. A file named `session_XXXXXXXX.fct` downloads automatically.
6. A "Done" screen appears. Send the `.fct` file back to the study owner.

> The test captures **one click only**. Subsequent clicks are ignored.

---

## Reviewing Results (Owner)

1. Open `viewer.html` by double-clicking it (no server needed).
2. Drag one or more `.fct` files onto the drop zone, or click **Load .fct files**.
3. Each session appears in the left sidebar with:
   - Tester name
   - Time-to-click (ms)
   - Validity badge (✓ Valid or ⚠ Signature mismatch)
4. The screenshot shows a **ring+dot hotspot** for each click, positioned accurately.
5. Hover a hotspot to see the tester name, clicked element, element text, and time.
6. Click a session in the sidebar to highlight its hotspot.

### Deduplication

If the same tester submits multiple `.fct` files, the viewer keeps only the **earliest session** (by start time) and discards the rest.

### Validity flags

The ⚠ flag means the file's signature doesn't match — the data may have been edited. This is **advisory only**; you decide whether to include or ignore that session.

---

## Notes

- Works entirely under `file://` — no Node.js, no server, no internet connection required.
- Session data stays local. Nothing is sent anywhere.
- The `.fct` file is a base64-encoded JSON envelope containing the click data and a screenshot of the prototype at test start.
- Integrity checking is friction, not cryptographic security. The secret ships in `tracker.js`, so a determined tester could forge a valid signature. Use it to flag accidental corruption or obvious tampering.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Tracker overlay doesn't appear | Make sure `lib/` folder and `tracker.js` are in the same folder as the HTML file and the paths in the snippet match. |
| Screenshot is blank | Some browsers restrict `SVG foreignObject` capture for complex pages. The click data is still recorded correctly. |
| `.fct` file doesn't download | Check that the browser isn't blocking downloads from local files. In Chrome, allow downloads from the address bar prompt. |
| Viewer shows no hotspot | The session may have no screenshot. Click data is still shown in the sidebar. |
| ⚠ on every session | The `tracker.js` and `viewer.html` may be from different versions. Re-copy from the same repo checkout. |
