'use strict';

(function () {
  /* Only inject once per page load */
  if (window.__fctContentLoaded) return;
  window.__fctContentLoaded = true;

  var armed = false;
  var testType = 'first-click';

  var END_BTN_ID = '__fct_end_button__';
  var exploratoryBound = false;
  var firstClickPending = false; // guards against double-send while awaiting ack

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

  /* ---- We capture on pointerdown, not click ----
   * A click event only completes on button release, which is the same moment
   * the browser begins navigating to the next page. The content script (and
   * its pending sendMessage) is then torn down before the message is
   * delivered, so clicks that navigate get silently dropped. pointerdown
   * fires on press — a beat before navigation starts — giving the message
   * time to reach the background. Only the primary button (0) counts; right /
   * middle clicks and multi-touch are ignored. */
  function isPrimary(e) {
    return e.button === 0 || e.button === undefined;
  }

  /* ---- First-click handler ----
   * Keep the listener installed until the background confirms it saved the
   * click. The service worker may be cold-started by this very message and
   * occasionally drop it; detaching first (as before) would silently lose the
   * only click and strand the session. On a failed/empty ack we leave the
   * listener armed so the next click retries; on success we detach. */
  function onFirstClick(e) {
    if (!armed || testType !== 'first-click') return;
    if (!isPrimary(e)) return;
    if (firstClickPending) return;
    firstClickPending = true;
    chrome.runtime.sendMessage(
      { action: 'first-click-captured', click: buildClickPayload(e) },
      function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          firstClickPending = false; // delivery failed — allow a retry
          return;
        }
        armed = false;
        document.removeEventListener('pointerdown', onFirstClick, true);
      }
    );
  }

  /* ---- Exploratory handlers ---- */
  function onExploratoryClick(e) {
    if (!armed || testType !== 'exploratory') return;
    if (!isPrimary(e)) return;
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
    document.addEventListener('pointerdown', onExploratoryClick, true);
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
      document.removeEventListener('pointerdown', onExploratoryClick, true);
      exploratoryBound = false;
      chrome.runtime.sendMessage(
        { action: 'exploratory-end', endWallMs: Date.now(), endPerfMs: performance.now() },
        function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            // Save did not go through (e.g. the worker dropped the message on a
            // cold start). Re-arm the button + click listener so the tester can
            // finish again rather than losing the whole session silently.
            btn.disabled = false;
            btn.textContent = 'I think I completed the task ✓';
            btn.style.background = '#1a8040';
            btn.style.cursor = 'pointer';
            if (!exploratoryBound) {
              exploratoryBound = true;
              document.addEventListener('pointerdown', onExploratoryClick, true);
            }
            return;
          }
          // Confirmed saved — remove the button.
          if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        }
      );
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
      if (testType === 'exploratory') {
        installExploratoryListener();
        showEndButton();
      } else {
        firstClickPending = false;
        document.addEventListener('pointerdown', onFirstClick, true);
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'session-reset') {
      armed = false;
      exploratoryBound = false;
      firstClickPending = false;
      document.removeEventListener('pointerdown', onFirstClick, true);
      document.removeEventListener('pointerdown', onExploratoryClick, true);
      removeEndButton();
      sendResponse({ ok: true });
      return true;
    }
  });

})();
