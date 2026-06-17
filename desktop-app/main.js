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
}

function sendStatus(message, extra) {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.webContents.send('status-update', Object.assign({ message: message }, extra || {}));
  }
}

/* ---- Shared: open a fresh target BrowserWindow and arm it ---- */
function openTargetWindow(loadFn, testerNameValue) {
  resetSessionState();
  testerName = testerNameValue || '';

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

  targetWindow.webContents.once('did-finish-load', async () => {
    try {
      const wallMs = Date.now();
      const perfMs = await targetWindow.webContents.executeJavaScript('performance.now()');
      sessionId = uuidv4();
      sessionStart = { wallMs: wallMs, perfMs: perfMs };

      const image = await targetWindow.webContents.capturePage();
      const size = image.getSize();
      const dpr = screen.getPrimaryDisplay().scaleFactor || 1;

      screenshotData = {
        dataURI: 'data:image/png;base64,' + image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
        dpr: dpr
      };

      targetWindow.webContents.send('session-armed', { sessionId, sessionStart });
      sendStatus('Loaded. Waiting for first click in the prototype window...');
    } catch (err) {
      sendStatus('Error preparing session: ' + err.message);
    }
  });

  loadFn(targetWindow);

  targetWindow.on('closed', () => { targetWindow = null; });
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
      const escaped = filePath.replace(/\\/g, '/');
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
  }, (payload && payload.testerName) || '');

  return { ok: true };
});

/* ---- Load a prototype via URL (localhost, Figma, any live URL) ---- */
ipcMain.handle('load-prototype-url', async (event, payload) => {
  const protoUrl = payload && payload.url;

  if (!protoUrl || !/^https?:\/\/.+/.test(protoUrl.trim())) {
    return { ok: false, error: 'Please enter a valid URL starting with http:// or https://' };
  }

  openTargetWindow(function (win) {
    win.loadURL(protoUrl.trim());
  }, (payload && payload.testerName) || '');

  return { ok: true };
});

/* ---- Receive the first click from preload-target.js ---- */
ipcMain.on('first-click-captured', (event, clickInfo) => {
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
    const defaultFilename = 'session_' + sessionId.replace(/-/g, '').slice(0, 8) + '.fct';

    saveFctFile(b64, defaultFilename);
  } catch (err) {
    sendStatus('Error capturing click: ' + err.message);
  }
});

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
