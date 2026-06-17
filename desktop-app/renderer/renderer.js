'use strict';

(function () {
  /* ---- Elements ---- */
  var dropZone       = document.getElementById('drop-zone');
  var fileNameEl     = document.getElementById('file-name');
  var testerNameFile = document.getElementById('tester-name-file');
  var loadFileBtn    = document.getElementById('load-file-btn');

  var protoUrlInput  = document.getElementById('proto-url');
  var testerNameUrl  = document.getElementById('tester-name-url');
  var loadUrlBtn     = document.getElementById('load-url-btn');

  var resetBtn       = document.getElementById('reset-btn');
  var statusEl       = document.getElementById('status');

  var tabBtns        = document.querySelectorAll('.tab-btn');
  var panelFile      = document.getElementById('panel-file');
  var panelUrl       = document.getElementById('panel-url');

  var selectedFilePath = null;

  /* ---- Show app version in header (best-effort; never block listeners) ---- */
  var versionEl = document.getElementById('app-version');
  if (versionEl && window.fctApi && window.fctApi.getVersion) {
    window.fctApi.getVersion().then(function (v) {
      if (v) versionEl.textContent = 'v' + v;
    }).catch(function () { /* ignore */ });
  }

  /* ---- Tab switching ---- */
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.getAttribute('data-tab');
      panelFile.classList.toggle('active', tab === 'file');
      panelUrl.classList.toggle('active', tab === 'url');
      setStatus('');
    });
  });

  /* ---- Helpers ---- */
  function setSelectedFile(filePath) {
    selectedFilePath = filePath;
    fileNameEl.textContent = filePath ? filePath.split(/[\\/]/).pop() : '';
    loadFileBtn.disabled = !filePath;
  }

  function setStatus(message, type) {
    statusEl.textContent = message || '';
    statusEl.className = type || '';
  }

  function lockUI() {
    loadFileBtn.disabled = true;
    loadUrlBtn.disabled = true;
    resetBtn.style.display = 'block';
  }

  function unlockUI() {
    loadFileBtn.disabled = !selectedFilePath;
    loadUrlBtn.disabled = !protoUrlInput.value.trim();
  }

  /* ---- URL input enables/disables load button ---- */
  protoUrlInput.addEventListener('input', function () {
    loadUrlBtn.disabled = !protoUrlInput.value.trim();
  });

  /* ---- Drop zone: click to browse ---- */
  dropZone.addEventListener('click', async function () {
    var result = await window.fctApi.pickPrototypeFile();
    if (!result.canceled && result.filePath) {
      setSelectedFile(result.filePath);
    }
  });

  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    var files = e.dataTransfer.files;
    if (files && files.length > 0 && files[0].path) {
      setSelectedFile(files[0].path);
    }
  });

  /* ---- Load via file ---- */
  loadFileBtn.addEventListener('click', async function () {
    if (!selectedFilePath) return;
    lockUI();
    setStatus('Loading prototype...');

    var testerName = testerNameFile.value.trim();
    var result = await window.fctApi.loadPrototype(selectedFilePath, testerName);

    if (!result.ok) {
      setStatus('Error: ' + result.error, 'error');
      unlockUI();
      resetBtn.style.display = 'none';
      return;
    }

    setStatus('Prototype window opened. Waiting for the first click...');
  });

  /* ---- Load via URL ---- */
  loadUrlBtn.addEventListener('click', async function () {
    var rawUrl = protoUrlInput.value.trim();
    if (!rawUrl) return;
    lockUI();
    setStatus('Loading prototype...');

    var testerName = testerNameUrl.value.trim();
    var result = await window.fctApi.loadPrototypeUrl(rawUrl, testerName);

    if (!result.ok) {
      setStatus('Error: ' + result.error, 'error');
      unlockUI();
      resetBtn.style.display = 'none';
      return;
    }

    setStatus('Prototype window opened. Waiting for the first click...');
  });

  /* ---- Reset ---- */
  resetBtn.addEventListener('click', function () {
    window.fctApi.resetSession();
    setSelectedFile(null);
    testerNameFile.value = '';
    protoUrlInput.value = '';
    testerNameUrl.value = '';
    setStatus('');
    resetBtn.style.display = 'none';
    loadUrlBtn.disabled = true;
  });

  /* ---- Status updates from main process ---- */
  window.fctApi.onStatusUpdate(function (payload) {
    setStatus(payload.message, payload.done ? 'success' : (payload.error ? 'error' : ''));
    if (payload.done) {
      unlockUI();
    }
  });
})();
