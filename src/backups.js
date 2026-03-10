const fs = require('fs');
const path = require('path');
const caddy = require('./caddy');

const BACKUPS_DIR = path.join(__dirname, '..', 'config', 'backups');
const MAX_BACKUPS = 30;

function ensureDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function formatTimestamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function createBackup(content) {
  ensureDir();
  const now = new Date();
  const name = `Caddyfile.${formatTimestamp(now)}.bak`;
  const filePath = path.join(BACKUPS_DIR, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return { id: name, date: now.toISOString(), label: formatLabel(now) };
}

function formatLabel(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function listBackups() {
  ensureDir();
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.bak'))
    .map(f => {
      const m = f.match(/^Caddyfile\.(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.bak$/);
      if (!m) return null;
      const [, y, M, d, h, min, s] = m;
      const date = new Date(y, parseInt(M, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), parseInt(s, 10));
      return { id: f, date: date.toISOString(), label: formatLabel(date) };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return files.slice(0, MAX_BACKUPS);
}

function getBackupContent(id) {
  if (!/^Caddyfile\.\d{4}-\d{2}-\d{2}_\d{6}\.bak$/.test(id)) return null;
  const filePath = path.join(BACKUPS_DIR, id);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function restoreBackup(id) {
  const content = getBackupContent(id);
  if (!content) return false;
  caddy.restoreFromCaddyfile(content);
  return true;
}

function pruneOldBackups() {
  const list = listBackups();
  if (list.length <= MAX_BACKUPS) return;
  list.slice(MAX_BACKUPS).forEach(b => {
    const p = path.join(BACKUPS_DIR, b.id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}

module.exports = { createBackup, listBackups, restoreBackup, getBackupContent, pruneOldBackups };
