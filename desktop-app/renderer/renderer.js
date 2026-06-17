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

  var figmaUrlInput  = document.getElementById('figma-url');
  var testerNameFigma = document.getElementById('tester-name-figma');
  var loadFigmaBtn   = document.getElementById('load-figma-btn');

  var resetBtn       = document.getElementById('reset-btn');
  var statusEl       = document.getElementById('status');
  var spinner        = document.getElementById('spinner');

  var tabBtns        = document.querySelectorAll('.tab-btn');
  var panelFile      = document.getElementById('panel-file');
  var panelUrl       = document.getElementById('panel-url');
  var panelFigma     = document.getElementById('panel-figma');

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
      panelFigma.classList.toggle('active', tab === 'figma');
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

  function showSpinner(on) {
    spinner.classList.toggle('show', !!on);
  }

  function lockUI() {
    loadFileBtn.disabled = true;
    loadUrlBtn.disabled = true;
    loadFigmaBtn.disabled = true;
    resetBtn.style.display = 'block';
  }

  function unlockUI() {
    loadFileBtn.disabled = !selectedFilePath;
    loadUrlBtn.disabled = !protoUrlInput.value.trim();
    loadFigmaBtn.disabled = !figmaUrlInput.value.trim();
  }

  /* ---- URL / Figma inputs enable/disable their load buttons ---- */
  protoUrlInput.addEventListener('input', function () {
    loadUrlBtn.disabled = !protoUrlInput.value.trim();
  });
  figmaUrlInput.addEventListener('input', function () {
    loadFigmaBtn.disabled = !figmaUrlInput.value.trim();
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
  async function runLoad(invokePromise) {
    lockUI();
    showSpinner(true);
    setStatus('Loading prototype…');
    var result = await invokePromise;
    if (!result.ok) {
      showSpinner(false);
      setStatus('Error: ' + result.error, 'error');
      unlockUI();
      resetBtn.style.display = 'none';
    }
    // On success, the main process drives further status via onStatusUpdate.
  }

  loadFileBtn.addEventListener('click', function () {
    if (!selectedFilePath) return;
    runLoad(window.fctApi.loadPrototype(selectedFilePath, testerNameFile.value.trim()));
  });

  /* ---- Load via URL ---- */
  loadUrlBtn.addEventListener('click', function () {
    var rawUrl = protoUrlInput.value.trim();
    if (!rawUrl) return;
    runLoad(window.fctApi.loadPrototypeUrl(rawUrl, testerNameUrl.value.trim()));
  });

  /* ---- Load via Figma ---- */
  loadFigmaBtn.addEventListener('click', function () {
    var rawUrl = figmaUrlInput.value.trim();
    if (!rawUrl) return;
    runLoad(window.fctApi.loadPrototypeFigma(rawUrl, testerNameFigma.value.trim()));
  });

  /* ---- Close prototype window / reset ---- */
  resetBtn.addEventListener('click', function () {
    window.fctApi.resetSession();
    setSelectedFile(null);
    testerNameFile.value = '';
    protoUrlInput.value = '';
    testerNameUrl.value = '';
    figmaUrlInput.value = '';
    testerNameFigma.value = '';
    showSpinner(false);
    setStatus('');
    resetBtn.style.display = 'none';
    loadUrlBtn.disabled = true;
    loadFigmaBtn.disabled = true;
  });

  /* ---- Status updates from main process ---- */
  window.fctApi.onStatusUpdate(function (payload) {
    showSpinner(!!payload.loading);
    setStatus(payload.message, payload.done ? 'success' : (payload.error ? 'error' : ''));
    if (payload.done || payload.error || payload.closed) {
      unlockUI();
    }
    if (payload.closed || payload.error) {
      resetBtn.style.display = 'none';
    }
  });
})();
