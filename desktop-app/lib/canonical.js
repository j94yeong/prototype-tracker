/*
 * CommonJS adapter for the shared canonical JSON serializer.
 *
 * Reuses /lib/canonical.js from the repo root (which now also exports via
 * `module.exports` when loaded under Node/CommonJS) instead of duplicating
 * the algorithm here. This guarantees byte-for-byte identical canonical
 * serialization between the desktop app and the existing file:// harness /
 * viewer.html.
 *
 * In dev (`npm run dev`), the repo's /lib directory sits two levels up from
 * here. In a packaged build, electron-builder copies /lib into the app's
 * resources directory (see package.json "extraResources") so it ships
 * alongside the app instead of relying on a path outside the package.
 */
'use strict';

const path = require('path');
const fs = require('fs');

function resolveSharedLibPath(filename) {
  const devPath = path.join(__dirname, '..', '..', 'lib', filename);
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  // Packaged app: extraResources copies repo /lib -> resources/shared-lib
  return path.join(process.resourcesPath, 'shared-lib', filename);
}

module.exports = require(resolveSharedLibPath('canonical.js'));
