'use strict';

var selectedType = null;

var stepType   = document.getElementById('step-type');
var stepStart  = document.getElementById('step-start');
var stepActive = document.getElementById('step-active');
var subText    = document.getElementById('sub-text');
var backBtn    = document.getElementById('back-btn');
var testerName = document.getElementById('tester-name');
var startBtn   = document.getElementById('start-btn');
var stopBtn    = document.getElementById('stop-btn');
var statusEl   = document.getElementById('status');
var activeTesterEl     = document.getElementById('active-tester');
var activeTypeLabelEl  = document.getElementById('active-type-label');
var activeInstructions = document.getElementById('active-instructions');

function showStep(id) {
  ['step-type','step-start','step-active'].forEach(function (s) {
    document.getElementById(s).classList.remove('active');
  });
  document.getElementById(id).classList.add('active');
}

function setStatus(msg, type) {
  statusEl.textContent = msg || '';
  statusEl.className = type || '';
}

/* ---- On open: check if a session is already running ---- */
chrome.runtime.sendMessage({ action: 'get-state' }, function (state) {
  if (state && state.running) {
    showActiveSession(state);
  }
});

function showActiveSession(state) {
  activeTesterEl.textContent = state.testerName || 'Anonymous';
  activeTypeLabelEl.textContent =
    state.testType === 'exploratory' ? 'Exploratory Test Recording' : 'First Click Test Active';
  activeInstructions.textContent =
    state.testType === 'exploratory'
      ? 'Click freely in the prototype tab. Press "I think I completed the task" when done.'
      : 'Waiting for the first click in the prototype tab.';
  showStep('step-active');
  subText.textContent = 'Session in progress.';
}

/* ---- Step 1: pick test type ---- */
document.querySelectorAll('.type-card').forEach(function (card) {
  card.addEventListener('click', function () {
    selectedType = card.getAttribute('data-type');
    subText.textContent = selectedType === 'exploratory'
      ? 'Exploratory test - records every click.'
      : 'First-click test - captures the first click.';
    showStep('step-start');
    setStatus('');
  });
});

backBtn.addEventListener('click', function () {
  showStep('step-type');
  subText.textContent = 'Choose a test type to begin.';
  setStatus('');
});

/* ---- Step 2: start ---- */
startBtn.addEventListener('click', function () {
  startBtn.disabled = true;
  setStatus('Starting...', 'info');

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) {
      setStatus('Could not find the active tab.', 'error');
      startBtn.disabled = false;
      return;
    }
    var tab = tabs[0];
    var url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      setStatus('Cannot run on this page. Go to your prototype tab first.', 'error');
      startBtn.disabled = false;
      return;
    }

    chrome.runtime.sendMessage({
      action: 'start-session',
      tabId: tab.id,
      testType: selectedType,
      testerName: testerName.value.trim()
    }, function (resp) {
      startBtn.disabled = false;
      if (!resp || !resp.ok) {
        setStatus('Error: ' + (resp && resp.error ? resp.error : 'Unknown error'), 'error');
        return;
      }
      showActiveSession({ running: true, testType: selectedType, testerName: testerName.value.trim() });
      setStatus('');
    });
  });
});

/* ---- Stop / discard ---- */
stopBtn.addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'stop-session' }, function () {
    showStep('step-type');
    subText.textContent = 'Choose a test type to begin.';
    setStatus('Session discarded.', '');
  });
});
