const fs = require('fs');
const path = require('path');
const { PID_PATH } = require('./postman-data-paths.cjs');

function live(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function read() {
  try {
    const n = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function claim() {
  const existing = read();
  if (existing && live(existing) && existing !== process.pid) {
    console.error(`[cdp] already running (pid ${existing})`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
  fs.writeFileSync(PID_PATH, String(process.pid));
}

function release() {
  if (read() !== process.pid) return;
  try { fs.unlinkSync(PID_PATH); } catch { /* gone */ }
}

module.exports = { live, read, claim, release };
