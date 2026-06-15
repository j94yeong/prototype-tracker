/*
 * First-Click Test Tracker
 * Inject before </body> after loading lib/sha256.js, lib/canonical.js, lib/html2canvas.min.js
 */
(function () {
  'use strict';

  /* ---- Utilities ---- */

  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function buildSelector(el) {
    if (!el || !el.tagName) return '';
    var sel = el.tagName.toLowerCase();
    if (el.id) {
      sel += '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
      var firstClass = el.className.trim().split(/\s+/)[0];
      if (firstClass) sel += '.' + firstClass;
    }
    return sel;
  }

  function btoa64(str) {
    // Use built-in btoa, encoding UTF-8 first
    var bytes = unescape(encodeURIComponent(str));
    return btoa(bytes);
  }

  /* ---- Overlay styles ---- */

  var OVERLAY_STYLE = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'z-index:999999',
    'background:rgba(0,0,0,0.65)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
  ].join(';');

  var BOX_STYLE = [
    'background:#fff',
    'border-radius:12px',
    'padding:40px 48px',
    'max-width:480px',
    'width:90%',
    'box-shadow:0 24px 64px rgba(0,0,0,0.3)',
    'text-align:center'
  ].join(';');

  /* ---- State ---- */

  var sessionId = null;
  var testerName = '';
  var sessionStart = null;
  var screenshotData = null;
  var overlay = null;
  var clickHandlerBound = false;

  /* ---- Show start overlay ---- */

  function showStartOverlay() {
    overlay = document.createElement('div');
    overlay.setAttribute('style', OVERLAY_STYLE);
    overlay.setAttribute('id', '__fct_overlay__');

    var box = document.createElement('div');
    box.setAttribute('style', BOX_STYLE);

    // Title
    var title = document.createElement('h2');
    title.setAttribute('style', 'margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111;');
    title.textContent = 'First-Click Test';

    // Subtitle
    var sub = document.createElement('p');
    sub.setAttribute('style', 'margin:0 0 28px 0;font-size:14px;color:#666;line-height:1.5;');
    sub.textContent = 'When you\'re ready, click Start. Then click the first thing you would naturally interact with.';

    // Name label
    var nameLabel = document.createElement('label');
    nameLabel.setAttribute('style', 'display:block;text-align:left;font-size:13px;color:#444;margin-bottom:6px;font-weight:500;');
    nameLabel.textContent = 'Your name (optional)';

    // Name input
    var nameInput = document.createElement('input');
    nameInput.setAttribute('type', 'text');
    nameInput.setAttribute('placeholder', 'e.g. Jane Smith');
    nameInput.setAttribute('style', [
      'width:100%',
      'box-sizing:border-box',
      'padding:10px 14px',
      'font-size:15px',
      'border:1.5px solid #ddd',
      'border-radius:8px',
      'outline:none',
      'margin-bottom:20px',
      'color:#111',
      'transition:border-color 0.15s'
    ].join(';'));
    nameInput.addEventListener('focus', function () {
      nameInput.style.borderColor = '#4f8ef7';
    });
    nameInput.addEventListener('blur', function () {
      nameInput.style.borderColor = '#ddd';
    });

    // Start button
    var startBtn = document.createElement('button');
    startBtn.textContent = 'Start Test';
    startBtn.setAttribute('style', [
      'width:100%',
      'padding:13px',
      'font-size:16px',
      'font-weight:600',
      'background:#4f8ef7',
      'color:#fff',
      'border:none',
      'border-radius:8px',
      'cursor:pointer',
      'margin-bottom:14px',
      'transition:background 0.15s'
    ].join(';'));
    startBtn.addEventListener('mouseover', function () {
      startBtn.style.background = '#3a7ae0';
    });
    startBtn.addEventListener('mouseout', function () {
      startBtn.style.background = '#4f8ef7';
    });

    // Skip link
    var skipLink = document.createElement('a');
    skipLink.textContent = 'Skip name and start';
    skipLink.setAttribute('href', '#');
    skipLink.setAttribute('style', 'display:block;font-size:13px;color:#999;text-decoration:none;');
    skipLink.addEventListener('mouseover', function () {
      skipLink.style.color = '#666';
    });
    skipLink.addEventListener('mouseout', function () {
      skipLink.style.color = '#999';
    });

    function doStart() {
      testerName = nameInput.value.trim();
      onStartTest();
    }

    startBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      doStart();
    });

    skipLink.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      nameInput.value = '';
      doStart();
    });

    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        doStart();
      }
    });

    box.appendChild(title);
    box.appendChild(sub);
    box.appendChild(nameLabel);
    box.appendChild(nameInput);
    box.appendChild(startBtn);
    box.appendChild(skipLink);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  /* ---- Show done overlay ---- */

  function showDoneOverlay() {
    var doneOverlay = document.createElement('div');
    doneOverlay.setAttribute('style', OVERLAY_STYLE);

    var box = document.createElement('div');
    box.setAttribute('style', BOX_STYLE);

    var icon = document.createElement('div');
    icon.setAttribute('style', 'font-size:48px;margin-bottom:16px;');
    icon.textContent = '✓';

    var title = document.createElement('h2');
    title.setAttribute('style', 'margin:0 0 12px 0;font-size:22px;font-weight:700;color:#111;');
    title.textContent = 'Test Complete!';

    var msg = document.createElement('p');
    msg.setAttribute('style', 'margin:0;font-size:15px;color:#555;line-height:1.6;');
    msg.textContent = 'Thank you! Please send the downloaded .fct file back to the study owner.';

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(msg);
    doneOverlay.appendChild(box);
    document.body.appendChild(doneOverlay);
  }

  /* ---- Start test ---- */

  function onStartTest() {
    // Record session start
    var wallMs = Date.now();
    var perfMs = performance.now();
    sessionId = uuidv4();
    sessionStart = { wallMs: wallMs, perfMs: perfMs };

    // Capture screenshot before removing overlay
    var dpr = window.devicePixelRatio || 1;

    // Remove overlay first so it doesn't appear in screenshot
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
      overlay = null;
    }

    html2canvas(document.body, { scale: dpr, useCORS: true, allowTaint: true }).then(function (canvas) {
      var dataURI = canvas.toDataURL('image/png');
      screenshotData = {
        dataURI: dataURI,
        width: canvas.width,
        height: canvas.height,
        dpr: dpr
      };

      // Now install one-time click listener
      installClickListener();
    }).catch(function () {
      screenshotData = {
        dataURI: '',
        width: 0,
        height: 0,
        dpr: dpr
      };
      installClickListener();
    });
  }

  /* ---- Click listener ---- */

  function installClickListener() {
    if (clickHandlerBound) return;
    clickHandlerBound = true;
    document.addEventListener('click', onFirstClick, true);
  }

  function onFirstClick(e) {
    // Remove listener immediately
    document.removeEventListener('click', onFirstClick, true);
    clickHandlerBound = false;

    var clickWallMs = Date.now();
    var clickPerfMs = performance.now();

    var x = e.clientX;
    var y = e.clientY;
    var viewportW = window.innerWidth;
    var viewportH = window.innerHeight;

    var targetText = '';
    try {
      targetText = (e.target.innerText || '').trim().slice(0, 100);
    } catch (err) {
      targetText = '';
    }

    var data = {
      schemaVersion: 1,
      sessionId: sessionId,
      testerName: testerName,
      sessionStart: {
        wallMs: sessionStart.wallMs,
        perfMs: sessionStart.perfMs
      },
      click: {
        wallMs: clickWallMs,
        perfMs: clickPerfMs,
        timeToClickMs: clickWallMs - sessionStart.wallMs,
        x: x,
        y: y,
        xPct: (x / viewportW) * 100,
        yPct: (y / viewportH) * 100,
        viewportW: viewportW,
        viewportH: viewportH,
        targetSelector: buildSelector(e.target),
        targetText: targetText
      },
      screenshot: {
        dataURI: screenshotData ? screenshotData.dataURI : '',
        width: screenshotData ? screenshotData.width : 0,
        height: screenshotData ? screenshotData.height : 0,
        dpr: screenshotData ? screenshotData.dpr : (window.devicePixelRatio || 1)
      }
    };

    // Sign
    var sig = sha256hex(canonicalJSON(data) + '|TRACKER_SECRET_v1');

    data.integrity = {
      sig: sig,
      secret: 'TRACKER_SECRET_v1'
    };

    // Encode and trigger download
    var jsonStr = JSON.stringify(data);
    var b64 = btoa64(jsonStr);
    var filename = 'session_' + sessionId.replace(/-/g, '').slice(0, 8) + '.fct';

    var a = document.createElement('a');
    a.setAttribute('href', 'data:text/plain;base64,' + b64);
    a.setAttribute('download', filename);
    a.setAttribute('style', 'display:none');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Show done overlay
    showDoneOverlay();
  }

  /* ---- Init ---- */

  function init() {
    showStartOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
