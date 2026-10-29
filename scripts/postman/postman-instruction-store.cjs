const fs = require('fs');
const path = require('path');

function readNonEmpty(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.trim() ? text : null;
  } catch (e) {
    return null;
  }
}

function loadInstruction(sourcePaths) {
  for (const p of sourcePaths) {
    const text = readNonEmpty(p);
    if (text) return text;
  }
  return '';
}

function renderInstruction(text, identity) {
  return text.replaceAll('{serverId}', identity.key).replaceAll('{prefix}', identity.prefix);
}

function saveInstruction(userPath, text) {
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, String(text), 'utf8');
}

function copyDefaultIfMissing(destPath, srcPath) {
  if (readNonEmpty(destPath)) return;
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

module.exports = { loadInstruction, renderInstruction, saveInstruction, copyDefaultIfMissing };
