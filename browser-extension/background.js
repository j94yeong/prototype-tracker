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
function getShot() {
  return chrome.storage.session.get(SHOT_KEY).then(function (o) {
    return o[SHOT_KEY] || '';
  });
}
function putShot(dataUrl) {
  var rec = {}; rec[SHOT_KEY] = dataUrl;
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
    target: { tabId: tabId },
    files: ['lib/sha256.js', 'lib/canonical.js', 'content.js']
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
    var reshoot = (s.testType === 'first-click') || (s.exploratoryClicks.length === 0);
    var step = reshoot
      ? captureTab(s.tabId).then(putShot).catch(function () { /* keep old shot */ })
      : Promise.resolve();
    return step.then(function () { return sendArmed(s); });
  });
}

/* ---- Sign and download a .fct file ----
 * pageName is used only for the download filename; it is NOT part of the
 * signed data, so the signed field set matches viewer.html exactly. */
function saveSession(data, pageName) {
  var sig = sha256hex(canonicalJSON(data) + '|' + SECRET);
  data.integrity = { alg: 'sha256', sig: sig };
  var json = JSON.stringify(data, null, 2);
  var b64 = btoa64(json);
  var dataUrl = 'data:application/octet-stream;base64,' + b64;
  var filename = buildFilename(data.testerName, pageName || '', data.sessionStart.wallMs);
  chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

/* ---- Async message handler ---- */
function handleMessage(msg) {

  /* Popup: get current state */
  if (msg.action === 'get-state') {
    return getSession().then(function (s) {
      return s ? { running: true, testType: s.testType, testerName: s.testerName }
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
              return putShot(info.shot)
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
      return getShot().then(function (shot) {
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
      s.exploratoryClicks.push(msg.click);
      return putSession(s).then(function () { return { ok: true }; });
    });
  }

  /* Content script: exploratory session ended */
  if (msg.action === 'exploratory-end') {
    return getSession().then(function (s) {
      if (!s || s.testType !== 'exploratory') return { ok: false };
      return getShot().then(function (shot) {
        return clearAll().then(function () {
          var endWallMs = msg.endWallMs || Date.now();
          var endPerfMs = msg.endPerfMs || 0;
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
            clicks: s.exploratoryClicks,
            screenshot: {
              dataURI: shot,
              width: (s.exploratoryClicks[0] && s.exploratoryClicks[0].viewportW) || 0,
              height: (s.exploratoryClicks[0] && s.exploratoryClicks[0].viewportH) || 0,
              dpr: 1
            }
          };
          saveSession(data, s.pageName);
          return { ok: true };
        });
      });
    });
  }

  return Promise.resolve(undefined);
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  handleMessage(msg).then(sendResponse, function () { sendResponse(undefined); });
  return true; // keep the message channel open for the async response
});

/* ---- Re-arm when the session tab finishes loading a new page ---- */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status !== 'complete') return;
  getSession().then(function (s) {
    if (!s || s.tabId !== tabId) return;
    ensureContentScript(tabId).then(rearmAfterNavigation);
  });
});

/* ---- Re-arm when the session tab finishes loading a new page ---- */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (!session || session.tabId !== tabId) return;
  if (changeInfo.status !== 'complete') return;
  // The manifest auto-injects content.js on the new page; make sure it is
  // there, then re-arm so the listener / End button come back.
  ensureContentScript(tabId).then(rearmAfterNavigation);
});

/* ---- Clean up if the session tab is closed ---- */
chrome.tabs.onRemoved.addListener(function (tabId) {
  getSession().then(function (s) {
    if (s && s.tabId === tabId) clearAll();
  });
});
