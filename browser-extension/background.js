'use strict';

importScripts('lib/sha256.js', 'lib/canonical.js');

const SECRET = 'TRACKER_SECRET_v1';

/* ---- Session state ----
 * In Manifest V3 the background is a service worker that Chrome terminates
 * after ~30s of inactivity, wiping any in-memory variable. A test session
 * can easily span longer than that (a tester reading the page before their
 * first click, or pausing mid-exploration), so the session MUST be persisted
 * in chrome.storage.session, which survives worker restarts. The large start
 * screenshot is kept under a separate key so per-click writes stay cheap. */
const STORE_KEY = 'fct_session';
const SHOT_KEY = 'fct_shot';

function getSession() {
  return chrome.storage.session.get(STORE_KEY).then(function (o) {
    return o[STORE_KEY] || null;
  });
}
function putSession(s) {
  var rec = {}; rec[STORE_KEY] = s;
  return chrome.storage.session.set(rec);
}
/* Screenshots are stored as an ARRAY of data URIs, one per page the tester
 * visits during an exploratory session, so clicks made after an in-prototype
 * navigation are shown on the page they actually happened on. First-click
 * sessions only ever use a single-element array. */
function getShots() {
  return chrome.storage.session.get(SHOT_KEY).then(function (o) {
    return o[SHOT_KEY] || [];
  });
}
function putShots(arr) {
  var rec = {}; rec[SHOT_KEY] = arr;
  return chrome.storage.session.set(rec);
}
function clearAll() {
  return chrome.storage.session.remove([STORE_KEY, SHOT_KEY]);
}

/* ---- Helpers ---- */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function slug(s) {
  return (s || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

function buildFilename(tester, page, wallMs) {
  var d = new Date(wallMs || Date.now());
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var date = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  var time = pad(d.getHours()) + pad(d.getMinutes());
  var t = slug(tester) || 'anonymous';
  var p = slug(page) || 'prototype';
  return t + '_' + p + '_' + date + '_' + time + '.fct';
}

function btoa64(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/* ---- Capture screenshot of the session tab ----
 * captureVisibleTab grabs the visible tab of the window, so only capture
 * when the target tab is actually the active tab of its window; otherwise
 * we would screenshot whatever else the user switched to. */
function captureTab(tabId) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab) {
        return reject(new Error('Tab not found'));
      }
      if (!tab.active) {
        return reject(new Error('Tab not active'));
      }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, function (dataUrl) {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(dataUrl);
      });
    });
  });
}

/* ---- Inject content script (in case it missed the declarative injection) ---- */
function ensureContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },
    files: ['content.js']
  }).catch(function () { /* already injected */ });
}

/* ---- Tell the content script to arm itself ---- */
function sendArmed(s) {
  return chrome.tabs.sendMessage(s.tabId, {
    action: 'session-armed',
    sessionId: s.sessionId,
    sessionStart: s.sessionStart,
    testType: s.testType
  }).catch(function () { /* content not ready yet */ });
}

/* ---- Re-arm after an in-prototype navigation ----
 * A navigation loads a fresh, un-armed content script, so for exploratory
 * the End button + click listener would vanish (tester stuck) and for
 * first-click the new page would not capture. Re-arm on every completed
 * navigation. Re-take the start screenshot only when it still represents the
 * start state: always for first-click (no click yet), and for exploratory
 * only before the first click, so hotspots stay aligned to their page. */
function rearmAfterNavigation() {
  return getSession().then(function (s) {
    if (!s) return;

    var update;
    if (s.testType === 'first-click') {
      // The single click lands on the final page, so always keep one shot of
      // the current page.
      update = captureTab(s.tabId).then(function (shot) { return putShots([shot]); });
    } else {
      // Exploratory: capture the new page. Append it as a new page only if the
      // page we just left actually received a click; otherwise (a splash/login
      // redirect, or any page the tester passed through without clicking)
      // replace the last shot so we don't accumulate empty pages.
      update = captureTab(s.tabId).then(function (shot) {
        return getShots().then(function (shots) {
          if (shots.length === 0) {
            shots = [shot];
          } else {
            var lastIndex = shots.length - 1;
            var clickedLast = s.exploratoryClicks.some(function (c) {
              return c.screenshotIndex === lastIndex;
            });
            if (clickedLast) shots.push(shot);
            else shots[lastIndex] = shot;
          }
          return putShots(shots);
        });
      });
    }

    return update.catch(function () { /* keep old shots */ })
      .then(function () { return sendArmed(s); });
  });
}

/* ---- Sign and download a .fct file ----
 * pageName is used only for the download filename; it is NOT part of the
 * signed data, so the signed field set matches viewer.html exactly. */
function saveSession(data, pageName) {
  var sig = sha256hex(canonicalJSON(data) + '|' + SECRET);
  data.integrity = { alg: 'sha256', sig: sig };
  var json = JSON.stringify(data, null, 2);
  // The .fct file must CONTAIN the base64 of the JSON as text, exactly like
  // the desktop app, so viewer.html can decode it. A `;base64,` data: URL is
  // decoded by the downloader before writing, which would put raw JSON on
  // disk and break the viewer's atob(). So we base64 the base64 string: the
  // download decodes one layer, leaving the base64 text (b64) in the file.
  // b64 is pure ASCII, so plain btoa is safe here.
  var b64 = btoa64(json);
  var dataUrl = 'data:application/octet-stream;base64,' + btoa(b64);
  var filename = buildFilename(data.testerName, pageName || '', data.sessionStart.wallMs);
  chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

/* ---- Is this message from a frame of the session's own tab? ----
 * Click and end messages, and a frame's self-arm check, must be scoped to the
 * tab under test. The session is global, so without this a frame in another
 * tab could arm itself and record clicks into the running session. Messages
 * from the popup have no sender.tab and never match. */
function fromSessionTab(s, sender) {
  return !!(s && sender && sender.tab && sender.tab.id === s.tabId);
}

/* ---- Async message handler ---- */
function handleMessage(msg, sender) {

  /* Popup: get current state (not tab-scoped — the popup drives any tab) */
  if (msg.action === 'get-state') {
    return getSession().then(function (s) {
      return s ? { running: true, testType: s.testType, testerName: s.testerName }
               : { running: false };
    });
  }

  /* Content frame: should I arm? Only if I belong to the session's tab. */
  if (msg.action === 'frame-check') {
    return getSession().then(function (s) {
      return fromSessionTab(s, sender)
        ? { running: true, testType: s.testType }
        : { running: false };
    });
  }

  /* Popup: start a new session */
  if (msg.action === 'start-session') {
    return getSession().then(function (existing) {
      if (existing) return { ok: false, error: 'A session is already running.' };

      var tabId = msg.tabId;
      return ensureContentScript(tabId)
        .then(function () { return captureTab(tabId); })
        .then(function (shot) {
          return chrome.tabs.get(tabId).then(function (tab) {
            return { shot: shot, title: (tab && tab.title) || '' };
          });
        })
        .then(function (info) {
          // Best-effort perfMs from the page clock; tolerate a missing reply.
          return chrome.tabs.sendMessage(tabId, { action: 'get-perf-now' })
            .catch(function () { return null; })
            .then(function (resp) {
              var s = {
                sessionId: uuidv4(),
                tabId: tabId,
                testType: msg.testType || 'first-click',
                testerName: msg.testerName || '',
                pageName: info.title,
                sessionStart: { wallMs: Date.now(), perfMs: (resp && resp.perfMs) ? resp.perfMs : 0 },
                exploratoryClicks: []
              };
              return putShots([info.shot])
                .then(function () { return putSession(s); })
                .then(function () { return sendArmed(s); })
                .then(function () { return { ok: true }; });
            });
        })
        .catch(function (err) { return { ok: false, error: err.message }; });
    });
  }

  /* Popup: stop/discard */
  if (msg.action === 'stop-session') {
    return getSession().then(function (s) {
      if (!s) return { ok: true };
      return clearAll().then(function () {
        chrome.tabs.sendMessage(s.tabId, { action: 'session-reset' }).catch(function () {});
        return { ok: true };
      });
    });
  }

  /* Content script: first click captured */
  if (msg.action === 'first-click-captured') {
    return getSession().then(function (s) {
      if (!s || s.testType !== 'first-click') return { ok: false };
      if (!fromSessionTab(s, sender)) return { ok: false };
      return getShots().then(function (shots) {
        var shot = shots[0] || '';
        return clearAll().then(function () {
          var data = {
            schemaVersion: 1,
            sessionId: s.sessionId,
            testerName: s.testerName,
            sessionStart: s.sessionStart,
            click: {
              wallMs: msg.click.wallMs,
              perfMs: msg.click.perfMs,
              timeToClickMs: msg.click.wallMs - s.sessionStart.wallMs,
              x: msg.click.x,
              y: msg.click.y,
              xPct: msg.click.xPct,
              yPct: msg.click.yPct,
              viewportW: msg.click.viewportW,
              viewportH: msg.click.viewportH,
              targetSelector: msg.click.targetSelector,
              targetText: msg.click.targetText
            },
            screenshot: {
              dataURI: shot,
              width: msg.click.viewportW,
              height: msg.click.viewportH,
              dpr: 1
            }
          };
          saveSession(data, s.pageName);
          return { ok: true };
        });
      });
    });
  }

  /* Content script: exploratory click */
  if (msg.action === 'exploratory-click') {
    return getSession().then(function (s) {
      if (!s || s.testType !== 'exploratory') return { ok: false };
      if (!fromSessionTab(s, sender)) return { ok: false };
      return getShots().then(function (shots) {
        // Tag the click with the page it happened on and its time offset, so
        // the viewer can place it on the right screenshot and label it.
        msg.click.screenshotIndex = shots.length > 0 ? shots.length - 1 : 0;
        msg.click.timeSinceStartMs = msg.click.wallMs - s.sessionStart.wallMs;
        s.exploratoryClicks.push(msg.click);
        return putSession(s).then(function () { return { ok: true }; });
      });
    });
  }

  /* Content script: exploratory session ended */
  if (msg.action === 'exploratory-end') {
    return getSession().then(function (s) {
      if (!s || s.testType !== 'exploratory') return { ok: false };
      if (!fromSessionTab(s, sender)) return { ok: false };
      return getShots().then(function (shots) {
        return clearAll().then(function () {
          var endWallMs = msg.endWallMs || Date.now();
          var endPerfMs = msg.endPerfMs || 0;
          var clicks = s.exploratoryClicks;

          // Build one screenshot object per visited page. Dimensions come from
          // the first click recorded on that page (the viewer positions
          // hotspots by percentage, so exact pixels aren't required).
          function firstClickOnPage(idx) {
            for (var i = 0; i < clicks.length; i++) {
              if (clicks[i].screenshotIndex === idx) return clicks[i];
            }
            return null;
          }
          var screenshots = shots.map(function (dataURI, idx) {
            var fc = firstClickOnPage(idx);
            return {
              dataURI: dataURI,
              width: (fc && fc.viewportW) || 0,
              height: (fc && fc.viewportH) || 0,
              dpr: 1
            };
          });
          if (screenshots.length === 0) {
            screenshots = [{ dataURI: '', width: 0, height: 0, dpr: 1 }];
          }

          var data = {
            schemaVersion: 1,
            testType: 'exploratory',
            sessionId: s.sessionId,
            testerName: s.testerName,
            sessionStart: s.sessionStart,
            sessionEnd: {
              wallMs: endWallMs,
              perfMs: endPerfMs,
              durationMs: endWallMs - s.sessionStart.wallMs
            },
            clicks: clicks,
            // screenshot (singular) stays as the first page for any older
            // viewer; screenshots (plural) is the full per-page list.
            screenshot: screenshots[0],
            screenshots: screenshots
          };
          saveSession(data, s.pageName);
          return { ok: true };
        });
      });
    });
  }

  return Promise.resolve(undefined);
}

/* ---- Serialize all session mutations ----
 * Every handler does an async read-modify-write on storage. Without
 * serialization, two rapid exploratory clicks can both read the same
 * snapshot and the second write clobbers the first (a lost click). A single
 * in-memory promise chain forces operations to run one at a time. Rapid
 * events always arrive within one service-worker wake period, so the chain
 * covers them; across worker restarts events are seconds apart and never
 * overlap, so nothing is lost when the chain resets. */
var opChain = Promise.resolve();
function serialize(fn) {
  var result = opChain.then(fn, fn);
  opChain = result.then(function () {}, function () {});
  return result;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  serialize(function () { return handleMessage(msg, sender); })
    .then(sendResponse, function () { sendResponse(undefined); });
  return true; // keep the message channel open for the async response
});

/* ---- Re-arm when the session tab finishes loading a new page ---- */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status !== 'complete') return;
  serialize(function () {
    return getSession().then(function (s) {
      if (!s || s.tabId !== tabId) return;
      return ensureContentScript(tabId).then(rearmAfterNavigation);
    });
  });
});

/* ---- Clean up if the session tab is closed ---- */
chrome.tabs.onRemoved.addListener(function (tabId) {
  serialize(function () {
    return getSession().then(function (s) {
      if (s && s.tabId === tabId) return clearAll();
    });
  });
});
