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

/* ---- Loading overlay ----
 * Shown immediately (before the prototype is interactive) so the tester
 * can't click anything until the session is armed — the screenshot is
 * taken and the click listener is ready. Appended to <html> so it survives
 * the page replacing <body>, and covers the whole viewport. */
const LOADING_ID = '__fct_loading_overlay__';

function showLoadingOverlay() {
  if (document.getElementById(LOADING_ID)) return;
  const root = document.documentElement || document.body;
  if (!root) return;
  const ov = document.createElement('div');
  ov.id = LOADING_ID;
  ov.setAttribute('style', [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
    'z-index:2147483647', 'background:#0e1116', 'color:#cdd6e3',
    'display:flex', 'flex-direction:column', 'align-items:center',
    'justify-content:center',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'
  ].join(';'));
  ov.innerHTML =
    '<div style="width:34px;height:34px;border:3px solid #2a3340;' +
    'border-top-color:#4f8ef7;border-radius:50%;' +
    'animation:__fctspin 0.7s linear infinite"></div>' +
    '<div style="margin-top:16px;font-size:14px">Preparing test… please wait</div>' +
    '<style>@keyframes __fctspin{to{transform:rotate(360deg)}}</style>';
  root.appendChild(ov);
}

function removeLoadingOverlay() {
  const ov = document.getElementById(LOADING_ID);
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

// Show the overlay as early as possible, and again once the DOM is ready
// (in case the page rebuilt the document after preload ran).
showLoadingOverlay();
document.addEventListener('DOMContentLoaded', showLoadingOverlay);

// Main process tells us once the screenshot + sessionStart have been
// captured, so we don't start listening for clicks before that's ready.
ipcRenderer.on('session-armed', () => {
  armed = true;
  removeLoadingOverlay();
  installClickListener();
});

// Expose a tiny, harmless bridge in case the renderer wants to check
// armed-state (not required by the prototype, kept minimal/optional).
contextBridge.exposeInMainWorld('__fctBridge', {
  isArmed: () => armed
});
