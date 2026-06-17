/*
 * First Click Tracker - Electron main process
 *
 * Replaces the "inject a script into the prototype" approach with a native
 * desktop app. The owner loads any static index.html into a real Chromium
 * BrowserWindow, we capture a start-state screenshot, wait for the first
 * click (captured via preload-target.js using contextBridge/ipcRenderer -
 * the prototype's own files are never modified), then build + sign the
 * exact same session JSON schema as tracker.js and write a .fct file that
 * the existing viewer.html can verify without any changes.
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const { sha256hex } = require('./lib/sha256.js');
const { canonicalJSON } = require('./lib/canonical.js');

const SECRET = 'TRACKER_SECRET_v1';

let appWindow = null;
let targetWindow = null;

/* ---- State for the in-flight session ---- */
let sessionId = null;
let testerName = '';
let sessionStart = null; // { wallMs, perfMs }
let screenshotData = null; // { dataURI, width, height, dpr }
let pageName = '';
let captured = false; // ensures exactly one capture per session

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---- Build a friendly default filename: tester_page_YYYYMMDD_HHMM.fct ---- */
function slug(s) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function buildFilename(tester, page, wallMs) {
  const d = new Date(wallMs || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const date = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const time = pad(d.getHours()) + pad(d.getMinutes());
  const t = slug(tester) || 'anonymous';
  const p = slug(page) || 'prototype';
  return t + '_' + p + '_' + date + '_' + time + '.fct';
}

/* ---- UUID v4, identical algorithm to tracker.js so format matches ---- */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---- Base64 encoding of a UTF-8 JSON string (Node Buffer, matches the
 * browser's unescape(encodeURIComponent(str)) + btoa approach used by
 * tracker.js / viewer.html, since both ultimately produce base64 of the
 * UTF-8 byte sequence of the JSON string). ---- */
function btoa64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/* ---- Create the app's own UI window ---- */
function createAppWindow() {
  appWindow = new BrowserWindow({
    width: 560,
    height: 480,
    resizable: true,
    title: 'First Click Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload-app.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  appWindow.setMenuBarVisibility(false);
  appWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  appWindow.on('closed', () => {
    appWindow = null;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.close();
    }
  });
}

/* ---- Reset in-flight session state ---- */
function resetSessionState() {
  sessionId = null;
  testerName = '';
  sessionStart = null;
  screenshotData = null;
  pageName = '';
  captured = false;
}

function sendStatus(message, extra) {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.webContents.send('status-update', Object.assign({ message: message }, extra || {}));
  }
}

/* ---- Figma (or any cross-origin iframe) capture ----
 * Clicks inside a cross-origin iframe (how Figma embeds its prototype) are
 * routed to a separate renderer process, so neither the in-page preload's
 * document listener nor the webContents 'input-event' reliably sees them.
 *
 * Instead we inject a transparent full-window overlay into the TOP frame
 * (figma.com itself, same-origin to executeJavaScript). The overlay sits
 * above the iframe, so the tester's first click lands on it — giving us
 * window-relative coordinates that line up exactly with the start-state
 * screenshot. The overlay reports the click by stamping document.title,
 * which fires 'page-title-updated' on the webContents. For a first-click
 * test, swallowing that single click is fine — the test ends on it anyway. */
const FIGMA_CLICK_PREFIX = '__FCT_CLICK__';

function installFigmaCapture(wc) {
  const titleHandler = (event, title) => {
    if (captured) return;
    if (typeof title !== 'string' || title.indexOf(FIGMA_CLICK_PREFIX) !== 0) return;
    captured = true;
    try { wc.removeListener('page-title-updated', titleHandler); } catch (e) { /* noop */ }

    let info = {};
    try { info = JSON.parse(title.slice(FIGMA_CLICK_PREFIX.length)); } catch (e) { /* noop */ }

    const x = info.x || 0, y = info.y || 0, vw = info.w || 0, vh = info.h || 0;
    finalizeCapture({
      wallMs: Date.now(),
      perfMs: info.t || 0,
      x: x,
      y: y,
      xPct: vw ? (x / vw) * 100 : 0,
      yPct: vh ? (y / vh) * 100 : 0,
      viewportW: vw,
      viewportH: vh,
      targetSelector: 'figma-prototype',
      targetText: ''
    });
  };
  wc.on('page-title-updated', titleHandler);

  const inject =
    '(function(){' +
    'var ov=document.createElement("div");' +
    'ov.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;cursor:crosshair;background:transparent";' +
    'ov.addEventListener("click",function(e){' +
    'var d={x:e.clientX,y:e.clientY,w:window.innerWidth,h:window.innerHeight,t:performance.now()};' +
    'document.title="' + FIGMA_CLICK_PREFIX + '"+JSON.stringify(d);' +
    'if(ov.parentNode)ov.parentNode.removeChild(ov);' +
    '},{once:true,capture:true});' +
    '(document.body||document.documentElement).appendChild(ov);' +
    'return true;})();';
  wc.executeJavaScript(inject).catch(() => {
    sendStatus('Could not arm Figma capture in the page.', { error: true });
  });
}

/* ---- Shared: open a fresh target BrowserWindow and arm it ----
 * mode: 'file' | 'url' | 'figma' */
function openTargetWindow(loadFn, testerNameValue, mode) {
  resetSessionState();
  testerName = testerNameValue || '';
  mode = mode || 'file';

  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.close();
    targetWindow = null;
  }

  targetWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Prototype Under Test',
    webPreferences: {
      preload: path.join(__dirname, 'preload-target.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false   // needed so file:// resources load inside URL-loaded pages
    }
  });

  targetWindow.setMenuBarVisibility(false);

  sendStatus('Loading prototype…', { loading: true });

  let armed = false;
  async function arm() {
    if (armed) return;
    armed = true;
    try {
      // Settle delay: Figma renders its prototype asynchronously well after
      // the DOM is ready; other pages just need a short paint settle.
      const settle = (mode === 'figma') ? 3000 : 400;
      if (mode === 'figma') {
        sendStatus('Preparing Figma prototype… (a few seconds)', { loading: true });
      }
      await delay(settle);
      if (!targetWindow || targetWindow.isDestroyed()) return;

      const wallMs = Date.now();
      const perfMs = await targetWindow.webContents.executeJavaScript('performance.now()');
      sessionId = uuidv4();
      sessionStart = { wallMs: wallMs, perfMs: perfMs };
      pageName = targetWindow.webContents.getTitle() || '';

      const image = await targetWindow.webContents.capturePage();
      const size = image.getSize();
      const dpr = screen.getPrimaryDisplay().scaleFactor || 1;

      screenshotData = {
        dataURI: 'data:image/png;base64,' + image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
        dpr: dpr
      };

      // Always notify the in-page preload so it removes its loading overlay.
      // For file/url that same signal installs the DOM click listener; for
      // figma the cross-origin click is captured by the injected overlay
      // instead (the preload's document listener can't see iframe clicks).
      targetWindow.webContents.send('session-armed', { sessionId, sessionStart });
      if (mode === 'figma') {
        installFigmaCapture(targetWindow.webContents);
      }
      sendStatus('Ready — make your first click in the prototype window.', { armed: true });
    } catch (err) {
      sendStatus('Error preparing session: ' + err.message, { error: true });
    }
  }

  // dom-ready fires as soon as the document is interactive — sooner than
  // did-finish-load (which waits for every sub-resource), so the window arms
  // promptly instead of feeling laggy on heavier pages.
  targetWindow.webContents.once('dom-ready', arm);

  // If the page can't load (offline, wrong port, bad/dead link), report it
  // instead of leaving the spinner running forever. Main-frame errors only;
  // ignore sub-resource failures and user-initiated aborts (code -3).
  let loadFailed = false;
  targetWindow.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    loadFailed = true;
    sendStatus('Could not load: ' + (errorDesc || 'error ' + errorCode) +
      (validatedURL ? ' (' + validatedURL + ')' : ''), { error: true });
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.close();
    }
  });

  loadFn(targetWindow);

  targetWindow.on('closed', () => {
    targetWindow = null;
    // If the window closed before a click was captured, let the app UI
    // recover (re-enable inputs, hide the close button) instead of staying
    // stuck on "Ready…". Skip if a load error was already reported, so we
    // don't overwrite the useful error message.
    if (!captured && !loadFailed) {
      resetSessionState();
      sendStatus('Prototype window closed.', { closed: true });
    }
  });
}

/* ---- Load a prototype's index.html (or image) via file path ---- */
ipcMain.handle('load-prototype', async (event, payload) => {
  const filePath = payload && payload.filePath;

  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found: ' + filePath };
  }

  const ext = path.extname(filePath).toLowerCase();
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

  openTargetWindow(function (win) {
    if (imageExts.indexOf(ext) !== -1) {
      // Wrap a bare image in a minimal full-screen HTML page
      const imgUrl = url.format({ pathname: filePath, protocol: 'file:', slashes: true });
      const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<style>*{margin:0;padding:0;box-sizing:border-box}' +
        'body{background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
        'img{max-width:100%;max-height:100vh;display:block}</style></head>' +
        '<body><img src="' + imgUrl + '"></body></html>';
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    } else {
      win.loadURL(url.format({ pathname: filePath, protocol: 'file:', slashes: true }));
    }
  }, (payload && payload.testerName) || '', 'file');

  return { ok: true };
});

/* ---- Load a prototype via URL (localhost, any live web page) ---- */
ipcMain.handle('load-prototype-url', async (event, payload) => {
  const protoUrl = payload && payload.url;

  if (!protoUrl || !/^https?:\/\/.+/.test(protoUrl.trim())) {
    return { ok: false, error: 'Please enter a valid URL starting with http:// or https://' };
  }

  openTargetWindow(function (win) {
    win.loadURL(protoUrl.trim());
  }, (payload && payload.testerName) || '', 'url');

  return { ok: true };
});

/* ---- Load a Figma prototype (cross-origin iframe; OS-level click capture) ---- */
ipcMain.handle('load-prototype-figma', async (event, payload) => {
  const protoUrl = payload && payload.url;

  if (!protoUrl || !/^https?:\/\/.*figma\.com\/.+/.test(protoUrl.trim())) {
    return { ok: false, error: 'Please enter a valid Figma link (figma.com/proto/... or /file/...).' };
  }

  openTargetWindow(function (win) {
    win.loadURL(protoUrl.trim());
  }, (payload && payload.testerName) || '', 'figma');

  return { ok: true };
});

/* ---- Receive the first click from preload-target.js (file/url modes) ---- */
ipcMain.on('first-click-captured', (event, clickInfo) => {
  if (captured) return;
  captured = true;
  finalizeCapture(clickInfo);
});

/* ---- Build + sign + save the session from a captured click ---- */
function finalizeCapture(clickInfo) {
  if (!sessionStart || !sessionId) {
    return; // stray event, ignore
  }

  try {
    const data = {
      schemaVersion: 1,
      sessionId: sessionId,
      testerName: testerName,
      sessionStart: {
        wallMs: sessionStart.wallMs,
        perfMs: sessionStart.perfMs
      },
      click: {
        wallMs: clickInfo.wallMs,
        perfMs: clickInfo.perfMs,
        timeToClickMs: clickInfo.wallMs - sessionStart.wallMs,
        x: clickInfo.x,
        y: clickInfo.y,
        xPct: clickInfo.xPct,
        yPct: clickInfo.yPct,
        viewportW: clickInfo.viewportW,
        viewportH: clickInfo.viewportH,
        targetSelector: clickInfo.targetSelector,
        targetText: clickInfo.targetText
      },
      screenshot: {
        dataURI: screenshotData ? screenshotData.dataURI : '',
        width: screenshotData ? screenshotData.width : 0,
        height: screenshotData ? screenshotData.height : 0,
        dpr: screenshotData ? screenshotData.dpr : 1
      }
    };

    // Sign using the exact same canonicalJSON + sha256hex + secret scheme
    // as tracker.js, so viewer.html can verify this file unmodified.
    const sig = sha256hex(canonicalJSON(data) + '|' + SECRET);

    data.integrity = {
      sig: sig,
      secret: SECRET
    };

    const jsonStr = JSON.stringify(data);
    const b64 = btoa64(jsonStr);
    const defaultFilename = buildFilename(testerName, pageName, clickInfo.wallMs);

    saveFctFile(b64, defaultFilename);
  } catch (err) {
    sendStatus('Error capturing click: ' + err.message, { error: true });
  }
}

async function saveFctFile(b64Content, defaultFilename) {
  if (!appWindow || appWindow.isDestroyed()) return;

  const result = await dialog.showSaveDialog(appWindow, {
    title: 'Save First-Click session',
    defaultPath: defaultFilename,
    filters: [{ name: 'First Click Tracker session', extensions: ['fct'] }]
  });

  if (result.canceled || !result.filePath) {
    sendStatus('Click captured, but save was cancelled. You can retry by loading the prototype again.');
    return;
  }

  fs.writeFileSync(result.filePath, b64Content, 'utf8');

  const savedName = path.basename(result.filePath);
  sendStatus('Click captured — saved as ' + savedName, { done: true, filename: savedName });
}

/* ---- IPC: app version (read from package.json by main, not sandboxed) ---- */
ipcMain.handle('get-version', () => app.getVersion());

/* ---- IPC: open file picker for index.html ---- */
ipcMain.handle('pick-prototype-file', async () => {
  if (!appWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(appWindow, {
    title: 'Choose prototype file',
    properties: ['openFile'],
    filters: [
      { name: 'Prototype files', extensions: ['html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});

/* ---- IPC: reset / load another prototype ---- */
ipcMain.on('reset-session', () => {
  resetSessionState();
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.close();
    targetWindow = null;
  }
});

app.whenReady().then(createAppWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createAppWindow();
  }
});
