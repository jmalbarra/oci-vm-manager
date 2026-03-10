const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'config', 'security.log');
const LOG_DIR = path.dirname(LOG_FILE);

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(level, event, data = {}) {
  ensureDir();
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function logLoginFail(email) {
  log('warn', 'login_fail', { email: email ? String(email).slice(0, 3) + '***' : '(empty)' });
}

function logDeploy(result, error) {
  log(result === 'ok' ? 'info' : 'error', 'deploy', { result, error: error || undefined });
}

module.exports = { log, logLoginFail, logDeploy };
