'use strict';

importScripts('lib/sha256.js', 'lib/canonical.js');

const SECRET = 'TRACKER_SECRET_v1';

/* ---- Session state ---- */
var session = null; // null when idle

function resetSession() {
  session = null;
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
  var bytes = unescape(encodeURIComponent(str));
  return btoa(bytes);
}

/* ---- Capture screenshot of active tab ---- */
function captureTab(tabId) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError || !tab) {
        return reject(new Error('Tab not found'));
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

/* ---- Inject content script into tab (in case it missed the declarative injection) ---- */
function ensureContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['lib/sha256.js', 'lib/canonical.js', 'content.js']
  }).catch(function () { /* already injected */ });
}

/* ---- Sign and download a .fct file ---- */
function saveSession(data) {
  var sig = sha256hex(canonicalJSON(data) + '|' + SECRET);
  data.integrity = { alg: 'sha256', sig: sig };
  var json = JSON.stringify(data, null, 2);
  var b64 = btoa64(json);
  var dataUrl = 'data:application/octet-stream;base64,' + b64;
  var filename = buildFilename(data.testerName, data.pageName || '', data.sessionStart.wallMs);
  chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

/* ---- Message router ---- */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {

  /* Popup: get current state */
  if (msg.action === 'get-state') {
    sendResponse(session ? {
      running: true,
      testType: session.testType,
      testerName: session.testerName
    } : { running: false });
    return true;
  }

  /* Popup: start a new session */
  if (msg.action === 'start-session') {
    if (session) {
      sendResponse({ ok: false, error: 'A session is already running.' });
      return true;
    }

    var tabId = msg.tabId;
    var testType = msg.testType || 'first-click';
    var testerName = msg.testerName || '';

    ensureContentScript(tabId).then(function () {
      return captureTab(tabId);
    }).then(function (screenshotDataUrl) {
      return new Promise(function (resolve, reject) {
        chrome.tabs.get(tabId, function (tab) {
          if (chrome.runtime.lastError) return reject(new Error('Tab gone'));
          resolve({ screenshotDataUrl: screenshotDataUrl, title: tab.title || '' });
        });
      });
    }).then(function (info) {
      var wallMs = Date.now();
      session = {
        sessionId: uuidv4(),
        tabId: tabId,
        testType: testType,
        testerName: testerName,
        pageName: info.title,
        sessionStart: { wallMs: wallMs, perfMs: 0 },
        screenshotDataUrl: info.screenshotDataUrl,
        exploratoryClicks: []
      };

      /* Ask the content script for its perfNow, then arm it */
      chrome.tabs.sendMessage(tabId, { action: 'get-perf-now' }, function (resp) {
        if (session) {
          session.sessionStart.perfMs = (resp && resp.perfMs) ? resp.perfMs : 0;
          chrome.tabs.sendMessage(tabId, {
            action: 'session-armed',
            sessionId: session.sessionId,
            sessionStart: session.sessionStart,
            testType: testType
          });
        }
      });

      sendResponse({ ok: true });
    }).catch(function (err) {
      sendResponse({ ok: false, error: err.message });
    });

    return true; // async
  }

  /* Popup: stop/discard */
  if (msg.action === 'stop-session') {
    if (session) {
      var tabId = session.tabId;
      resetSession();
      chrome.tabs.sendMessage(tabId, { action: 'session-reset' }).catch(function () {});
    }
    sendResponse({ ok: true });
    return true;
  }

  /* Content script: first click captured */
  if (msg.action === 'first-click-captured') {
    if (!session || session.testType !== 'first-click') return;
    var s = session;
    resetSession();

    var data = {
      schemaVersion: 1,
      sessionId: s.sessionId,
      testerName: s.testerName,
      pageName: s.pageName,
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
        dataURI: s.screenshotDataUrl,
        width: msg.click.viewportW,
        height: msg.click.viewportH,
        dpr: 1
      }
    };
    saveSession(data);
    sendResponse({ ok: true });
    return true;
  }

  /* Content script: exploratory click */
  if (msg.action === 'exploratory-click') {
    if (!session || session.testType !== 'exploratory') return;
    session.exploratoryClicks.push(msg.click);
    sendResponse({ ok: true });
    return true;
  }

  /* Content script: exploratory session ended */
  if (msg.action === 'exploratory-end') {
    if (!session || session.testType !== 'exploratory') return;
    var s = session;
    resetSession();

    var endWallMs = msg.endWallMs || Date.now();
    var data = {
      schemaVersion: 1,
      testType: 'exploratory',
      sessionId: s.sessionId,
      testerName: s.testerName,
      pageName: s.pageName,
      sessionStart: s.sessionStart,
      sessionEnd: { wallMs: endWallMs },
      durationMs: endWallMs - s.sessionStart.wallMs,
      clicks: s.exploratoryClicks,
      screenshot: {
        dataURI: s.screenshotDataUrl,
        width: (s.exploratoryClicks[0] && s.exploratoryClicks[0].viewportW) || 0,
        height: (s.exploratoryClicks[0] && s.exploratoryClicks[0].viewportH) || 0,
        dpr: 1
      }
    };
    saveSession(data);
    sendResponse({ ok: true });
    return true;
  }
});

/* ---- Clean up if the session tab is closed ---- */
chrome.tabs.onRemoved.addListener(function (tabId) {
  if (session && session.tabId === tabId) {
    resetSession();
  }
});
