// Development loop without a dev server: Vite rebuilds into dist/ on every
// save, and the Electron main process reloads the window when dist/ changes.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const index = path.join(root, 'dist', 'renderer', 'index.html');
const started = Date.now();

const vite = spawn(path.join(root, 'node_modules', '.bin', 'vite'), ['build', '--watch', '--mode', 'development'], {
  cwd: root,
  stdio: 'inherit',
});

// Wait for the first build to land before opening the window.
const wait = setInterval(() => {
  if (!fs.existsSync(index) || fs.statSync(index).mtimeMs < started) return;
  clearInterval(wait);
  const electron = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit' });
  electron.on('exit', (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}, 200);

process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});
