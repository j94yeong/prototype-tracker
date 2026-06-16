/*
 * App UI logic (runs in the app window's renderer). Talks to main only via
 * the `fctApi` bridge exposed by preload-app.js - no direct Node/IPC access.
 */

'use strict';

(function () {
  const dropZone = document.getElementById('drop-zone');
  const fileNameEl = document.getElementById('file-name');
  const testerNameInput = document.getElementById('tester-name');
  const loadBtn = document.getElementById('load-prototype-btn');
  const resetBtn = document.getElementById('reset-btn');
  const statusEl = document.getElementById('status');

  let selectedFilePath = null;

  function setSelectedFile(filePath) {
    selectedFilePath = filePath;
    fileNameEl.textContent = filePath || '';
    loadBtn.disabled = !filePath;
  }

  function setStatus(message, success) {
    statusEl.textContent = message || '';
    statusEl.classList.toggle('success', !!success);
  }

  /* ---- Drag and drop ---- */
  dropZone.addEventListener('click', async () => {
    const result = await window.fctApi.pickPrototypeFile();
    if (!result.canceled && result.filePath) {
      setSelectedFile(result.filePath);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      // Electron exposes the real filesystem path on dropped File objects.
      const filePath = files[0].path;
      if (filePath) {
        setSelectedFile(filePath);
      }
    }
  });

  /* ---- Load prototype ---- */
  loadBtn.addEventListener('click', async () => {
    if (!selectedFilePath) return;
    loadBtn.disabled = true;
    setStatus('Loading prototype...');

    const testerName = testerNameInput.value.trim();
    const result = await window.fctApi.loadPrototype(selectedFilePath, testerName);

    if (!result.ok) {
      setStatus('Error: ' + result.error);
      loadBtn.disabled = false;
      return;
    }

    resetBtn.style.display = 'block';
    setStatus('Prototype window opened. Waiting for the first click...');
  });

  /* ---- Reset / load another prototype ---- */
  resetBtn.addEventListener('click', () => {
    window.fctApi.resetSession();
    setSelectedFile(null);
    testerNameInput.value = '';
    setStatus('');
    resetBtn.style.display = 'none';
    loadBtn.disabled = true;
  });

  /* ---- Status updates pushed from main ---- */
  window.fctApi.onStatusUpdate((payload) => {
    setStatus(payload.message, !!payload.done);
    if (payload.done) {
      loadBtn.disabled = false;
    }
  });
})();
