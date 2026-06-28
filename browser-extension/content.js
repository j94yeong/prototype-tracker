'use strict';

(function () {
  /* Only inject once per frame load */
  if (window.__fctContentLoaded) return;
  window.__fctContentLoaded = true;

  /* This script runs in EVERY frame (manifest all_frames). The top frame talks
   * to the background and owns the screenshot's coordinate space; sub-frames
   * (including cross-origin iframes such as Figma embeds) can't reach the
   * background's click coordinates meaningfully on their own, so they forward
   * each click UP to their parent via postMessage. Each parent adds the child
   * iframe's on-screen offset, so by the time a click reaches the top frame it
   * is expressed in top-viewport coordinates that line up with the capture. */
  var isTop = (window === window.top);

  var armed = false;
  var testType = 'first-click';

  var END_BTN_ID = '__fct_end_button__';
  var firstClickPending = false; // guards against double-send while awaiting ack
  var FCT_MSG = '__fct_click__';

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

  /* ---- Build click payload (coordinates relative to THIS frame) ---- */
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
   * fires on press — a beat before navigation starts. Only the primary button
   * (0) counts; right / middle clicks and multi-touch are ignored. */
  function isPrimary(e) {
    return e.button === 0 || e.button === undefined;
  }

  /* ---- Load Work Sans (600 + 700) from Google Fonts once ---- */
  function ensureFont() {
    if (document.getElementById('__fct_worksans__')) return;
    var link = document.createElement('link');
    link.id = '__fct_worksans__';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@600;700&display=swap';
    (document.head || document.documentElement).appendChild(link);
  }

  /* ---- Snackbar notification ---- */
  function showSnackbar(message) {
    ensureFont();
    var bar = document.createElement('div');
    bar.setAttribute('style', [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'padding:14px 22px', 'font-size:14px', 'font-weight:700',
      'font-family:Work Sans,sans-serif', 'letter-spacing:0.02em',
      'text-transform:uppercase',
      'color:#fff', 'background:#000', 'border:2px solid #fff', 'border-radius:0',
      'box-shadow:6px 6px 0 #E5322B',
      'transition:opacity 0.4s ease', 'opacity:1', 'pointer-events:none'
    ].join(';'));
    bar.textContent = message;
    (document.documentElement || document.body).appendChild(bar);
    setTimeout(function () { bar.style.opacity = '0'; }, 2000);
    setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 2500);
  }

  /* ---- Top frame: deliver a finished payload to the background ----
   * For first-click, keep listening until the background confirms it saved:
   * the service worker may be cold-started by this very message and drop it,
   * so detaching first would silently lose the only click. */
  function deliverFirstClick(payload) {
    if (firstClickPending) return;
    firstClickPending = true;
    chrome.runtime.sendMessage(
      { action: 'first-click-captured', click: payload },
      function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          firstClickPending = false; // delivery failed — allow a retry
          return;
        }
        armed = false; // captured; stop accepting clicks from any frame
        showSnackbar('✓ First click captured successfully');
      }
    );
  }

  function routeTopPayload(payload) {
    if (!armed) return;
    if (testType === 'first-click') deliverFirstClick(payload);
    else chrome.runtime.sendMessage({ action: 'exploratory-click', click: payload });
  }

  /* ---- Emit a payload upward: to the background if top, else to the parent
   * frame, which will add this frame's offset and continue up the chain. ---- */
  function emitPayload(payload) {
    if (isTop) {
      routeTopPayload(payload);
    } else {
      try { window.parent.postMessage({ __fct: FCT_MSG, payload: payload }, '*'); } catch (e) { /* noop */ }
    }
  }

  /* ---- Local pointerdown in THIS frame ---- */
  function onPoint(e) {
    if (!armed) return;
    if (!isPrimary(e)) return;
    // Never record clicks on our own End button.
    var node = e.target;
    while (node) {
      if (node.id === END_BTN_ID) return;
      node = node.parentNode;
    }
    emitPayload(buildClickPayload(e));
  }

  /* ---- Relay clicks bubbling up from child frames ----
   * Translate the child's frame-relative coordinates into this frame's
   * coordinates by adding the child iframe element's content-box offset, then
   * pass it further up. Only accept messages whose source is one of our own
   * child frames (unknown senders are ignored). ---- */
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__fct !== FCT_MSG || !d.payload) return;

    var rect = null, cs = null;
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      var cw;
      try { cw = frames[i].contentWindow; } catch (err) { cw = null; }
      if (cw && cw === ev.source) {
        rect = frames[i].getBoundingClientRect();
        try { cs = window.getComputedStyle(frames[i]); } catch (err2) { cs = null; }
        break;
      }
    }
    if (!rect) return; // not from a frame we own

    // Content origin sits inside the border + padding of the iframe element.
    var bl = cs ? (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0) : 0;
    var bt = cs ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) : 0;

    var p = d.payload;
    p.x = p.x + rect.left + bl;
    p.y = p.y + rect.top + bt;
    p.viewportW = window.innerWidth;
    p.viewportH = window.innerHeight;
    p.xPct = (p.x / p.viewportW) * 100;
    p.yPct = (p.y / p.viewportH) * 100;
    emitPayload(p);
  }, false);

  /* ---- Arm / disarm this frame ----
   * addEventListener with the same function reference is idempotent, so
   * arming more than once (broadcast + self-arm) is harmless. ---- */
  function armFrame(type) {
    armed = true;
    testType = type || 'first-click';
    firstClickPending = false;
    document.addEventListener('pointerdown', onPoint, true);
    if (isTop && testType === 'exploratory') showEndButton();
  }

  function disarmFrame() {
    armed = false;
    firstClickPending = false;
    document.removeEventListener('pointerdown', onPoint, true);
    removeEndButton();
  }

  /* ---- End button (top frame only, exploratory) ---- */
  function showEndButton() {
    if (!isTop) return;
    if (document.getElementById(END_BTN_ID)) return;
    var root = document.documentElement || document.body;
    if (!root) return;
    var btn = document.createElement('button');
    btn.id = END_BTN_ID;
    btn.type = 'button';
    btn.textContent = 'I think I completed the task ✓';
    ensureFont();
    btn.setAttribute('style', [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'padding:12px 18px', 'font-size:13px', 'font-weight:700',
      'font-family:Work Sans,sans-serif', 'letter-spacing:0.02em',
      'text-transform:uppercase',
      'color:#fff', 'background:#000', 'border:2px solid #fff', 'border-radius:0',
      'box-shadow:6px 6px 0 #E5322B', 'cursor:pointer'
    ].join(';'));
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.style.background = '#444';
      btn.style.boxShadow = '6px 6px 0 #444';
      btn.style.cursor = 'default';
      armed = false; // stop recording while the save is in flight
      chrome.runtime.sendMessage(
        { action: 'exploratory-end', endWallMs: Date.now(), endPerfMs: performance.now() },
        function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            // Save did not go through (e.g. the worker dropped the message on a
            // cold start). Re-arm so the tester can finish again rather than
            // losing the whole session silently.
            armed = true;
            btn.disabled = false;
            btn.textContent = 'I think I completed the task ✓';
            btn.style.background = '#000';
            btn.style.boxShadow = '6px 6px 0 #E5322B';
            btn.style.cursor = 'pointer';
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
      armFrame(msg.testType);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'session-reset') {
      disarmFrame();
      sendResponse({ ok: true });
      return true;
    }
  });

  /* ---- Self-arm on load ----
   * A frame can miss the session-armed broadcast — most importantly a
   * cross-origin or lazily-loaded iframe that attaches after the session
   * started — so ask the background whether a session is active. Idempotent
   * with the broadcast. ---- */
  try {
    chrome.runtime.sendMessage({ action: 'frame-check' }, function (state) {
      if (chrome.runtime.lastError) return;
      if (state && state.running) armFrame(state.testType);
    });
  } catch (e) { /* extension context not available */ }

})();
