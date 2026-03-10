const fs = require('fs');
const path = require('path');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const TFA_PATH = path.join(__dirname, '..', 'config', 'tfa.json');
const APP_NAME = 'OCI VM Manager';

function getTfaConfig() {
  try {
    const data = fs.readFileSync(TFA_PATH, 'utf8');
    return JSON.parse(data);
  } catch (_) {
    return { enabled: false };
  }
}

function is2faEnabled() {
  const c = getTfaConfig();
  return !!c.enabled && !!c.secret;
}

function generateSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `${APP_NAME} (${email})`,
    length: 20,
  });
  return secret;
}

function saveTfaSecret(secret, enabled = false) {
  const dir = path.dirname(TFA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TFA_PATH, JSON.stringify({
    secret: secret.base32,
    enabled,
  }, null, 2), 'utf8');
}

function enable2fa(secret) {
  saveTfaSecret(secret, true);
}

async function getQRDataUrl(secret) {
  return QRCode.toDataURL(secret.otpauth_url);
}

function verifyToken(token) {
  const c = getTfaConfig();
  if (!c.secret) return false;
  return speakeasy.totp.verify({
    secret: c.secret,
    encoding: 'base32',
    token: String(token).replace(/\s/g, ''),
    window: 1,
  });
}

function disable2fa() {
  try {
    if (fs.existsSync(TFA_PATH)) fs.unlinkSync(TFA_PATH);
  } catch (_) {}
}

module.exports = { getTfaConfig, is2faEnabled, generateSecret, saveTfaSecret, enable2fa, disable2fa, getQRDataUrl, verifyToken };
