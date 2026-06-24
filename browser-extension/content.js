'use strict';

(function () {
  /* Only inject once per page load */
  if (window.__fctContentLoaded) return;
  window.__fctContentLoaded = true;

  var armed = false;
  var testType = 'first-click';
  var sessionStart = null;

  var END_BTN_ID = '__fct_end_button__';
  var exploratoryBound = false;

  /* ---- Selector builder ---- */
  function buildSelector(el) {
    if (!el || !el.tagName) return '';
    var sel = el.tagName.toLowerCase();
    if (el.id) {
      sel += '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
      var first = el.className.trim().split(/\s+/)[0];
      if (first) sel += '.' + first;
    }
    return sel;
  }

  /* ---- Build click payload ---- */
  function buildClickPayload(e) {
    var x = e.clientX, y = e.clientY;
    var vw = window.innerWidth, vh = window.innerHeight;
    var text = '';
    try { text = (e.target.innerText || '').trim().slice(0, 100); } catch (err) {}
    return {
      wallMs: Date.now(),
      perfMs: performance.now(),
      x: x, y: y,
      xPct: (x / vw) * 100,
      yPct: (y / vh) * 100,
      viewportW: vw,
      viewportH: vh,
      targetSelector: buildSelector(e.target),
      targetText: text
    };
  }

  /* ---- First-click handler ---- */
  function onFirstClick(e) {
    document.removeEventListener('click', onFirstClick, true);
    chrome.runtime.sendMessage({ action: 'first-click-captured', click: buildClickPayload(e) });
    armed = false;
  }

  /* ---- Exploratory handlers ---- */
  function onExploratoryClick(e) {
    var node = e.target;
    while (node) {
      if (node.id === END_BTN_ID) return;
      node = node.parentNode;
    }
    chrome.runtime.sendMessage({ action: 'exploratory-click', click: buildClickPayload(e) });
  }

  function installExploratoryListener() {
    if (exploratoryBound) return;
    exploratoryBound = true;
    document.addEventListener('click', onExploratoryClick, true);
  }

  /* ---- End button (exploratory) ---- */
  function showEndButton() {
    if (document.getElementById(END_BTN_ID)) return;
    var root = document.documentElement || document.body;
    if (!root) return;
    var btn = document.createElement('button');
    btn.id = END_BTN_ID;
    btn.type = 'button';
    btn.textContent = 'I think I completed the task ✓';
    btn.setAttribute('style', [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'padding:10px 16px', 'font-size:13px', 'font-weight:700',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'color:#fff', 'background:#1a8040', 'border:none', 'border-radius:8px',
      'box-shadow:0 4px 14px rgba(0,0,0,0.3)', 'cursor:pointer'
    ].join(';'));
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.style.background = '#888';
      btn.style.cursor = 'default';
      document.removeEventListener('click', onExploratoryClick, true);
      exploratoryBound = false;
      chrome.runtime.sendMessage({ action: 'exploratory-end', endWallMs: Date.now(), endPerfMs: performance.now() });
      setTimeout(function () {
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      }, 1500);
    }, true);
    root.appendChild(btn);
  }

  function removeEndButton() {
    var btn = document.getElementById(END_BTN_ID);
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  /* ---- Message handler from background ---- */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

    if (msg.action === 'get-perf-now') {
      sendResponse({ perfMs: performance.now() });
      return true;
    }

    if (msg.action === 'session-armed') {
      armed = true;
      testType = msg.testType || 'first-click';
      sessionStart = msg.sessionStart;
      if (testType === 'exploratory') {
        installExploratoryListener();
        showEndButton();
      } else {
        document.addEventListener('click', onFirstClick, true);
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'session-reset') {
      armed = false;
      exploratoryBound = false;
      document.removeEventListener('click', onFirstClick, true);
      document.removeEventListener('click', onExploratoryClick, true);
      removeEndButton();
      sendResponse({ ok: true });
      return true;
    }
  });

})();
