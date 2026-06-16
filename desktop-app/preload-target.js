/*
 * Preload script for the TARGET window (the owner's loaded prototype).
 *
 * This is injected from the Electron side via webPreferences.preload — the
 * prototype's own HTML/JS/CSS files are never touched. contextIsolation is
 * enabled, but preload scripts run in an isolated JS world that still has
 * direct access to the loaded page's DOM (isolation separates JS globals,
 * not DOM access), so we can attach a capture-phase click listener directly
 * to `document` here, then relay the result to the main process over IPC.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let clickHandlerBound = false;
let armed = false;

function buildSelector(el) {
  if (!el || !el.tagName) return '';
  let sel = el.tagName.toLowerCase();
  if (el.id) {
    sel += '#' + el.id;
  } else if (el.className && typeof el.className === 'string') {
    const firstClass = el.className.trim().split(/\s+/)[0];
    if (firstClass) sel += '.' + firstClass;
  }
  return sel;
}

function onFirstClick(e) {
  document.removeEventListener('click', onFirstClick, true);
  clickHandlerBound = false;

  const wallMs = Date.now();
  const perfMs = performance.now();

  const x = e.clientX;
  const y = e.clientY;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let targetText = '';
  try {
    targetText = (e.target.innerText || '').trim().slice(0, 100);
  } catch (err) {
    targetText = '';
  }

  ipcRenderer.send('first-click-captured', {
    wallMs: wallMs,
    perfMs: perfMs,
    x: x,
    y: y,
    xPct: (x / viewportW) * 100,
    yPct: (y / viewportH) * 100,
    viewportW: viewportW,
    viewportH: viewportH,
    targetSelector: buildSelector(e.target),
    targetText: targetText
  });
}

function installClickListener() {
  if (clickHandlerBound) return;
  clickHandlerBound = true;
  document.addEventListener('click', onFirstClick, true);
}

// Main process tells us once the screenshot + sessionStart have been
// captured, so we don't start listening for clicks before that's ready.
ipcRenderer.on('session-armed', () => {
  armed = true;
  installClickListener();
});

// Expose a tiny, harmless bridge in case the renderer wants to check
// armed-state (not required by the prototype, kept minimal/optional).
contextBridge.exposeInMainWorld('__fctBridge', {
  isArmed: () => armed
});
