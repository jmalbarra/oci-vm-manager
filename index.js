require('dotenv').config();
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const https = require('https');
const { Client } = require('ssh2');
const caddy = require('./src/caddy');
const backups = require('./src/backups');
const logger = require('./src/logger');
const tfa = require('./src/tfa');

const app = express();
app.set('trust proxy', 1); // Para que las cookies funcionen detrás de Caddy/reverse proxy
const PORT = process.env.PORT || 3080;
const isProd = process.env.NODE_ENV === 'production';

const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === 'change-me-in-production')) {
  console.error('Fatal: SESSION_SECRET debe estar configurado en producción');
  process.exit(1);
}

function safeError(err, defaultMsg = 'Error interno') {
  return isProd ? defaultMsg : (err?.message || defaultMsg);
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
  return res.redirect('/login.html');
}

// CSRF: state-changing API requests (POST/PUT/DELETE) must come from our frontend
function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const safe = req.get('X-Requested-With') === 'XMLHttpRequest' || req.get('Sec-Fetch-Dest') === 'empty';
  if (safe) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Solicitud no permitida' });
  next();
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: process.env.FORCE_SECURE_COOKIE === '1'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Demasiados intentos. Esperá 15 min.' }, validate: { xForwardedForHeader: false } });
const deployLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Demasiados deploys. Esperá 1 min.' }, validate: { xForwardedForHeader: false } });

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: sessionSecret || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  name: 'oci-vm-manager.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.FORCE_SECURE_COOKIE === '1',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));
app.use(requireCsrf);

app.get('/login.html', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login.html', (req, res) => {
  // Si el form se envía sin JS (method=post, action=""), redirigir a GET
  res.redirect('/login.html');
});

app.get('/', (req, res) => {
  if (!req.session?.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const expectedEmail = process.env.ADMIN_EMAIL;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedHash || !expectedEmail || !email || !password) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  if (password.length > 256 || email.length > 254) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  if (email.trim().toLowerCase() !== expectedEmail.toLowerCase()) {
    logger.logLoginFail(email);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!bcrypt.compareSync(password, expectedHash)) {
    logger.logLoginFail(email);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  if (tfa.is2faEnabled()) {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Error de sesión' });
      req.session.pending2fa = { email: expectedEmail };
      res.json({ requires2fa: true });
    });
    return;
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.user = { email: expectedEmail };
    res.json({ ok: true });
  });
});

app.post('/api/2fa/verify', loginLimiter, (req, res) => {
  const { code } = req.body || {};
  if (!req.session?.pending2fa || !code || typeof code !== 'string') {
    return res.status(401).json({ error: 'Código inválido' });
  }
  if (!tfa.verifyToken(code)) {
    logger.logLoginFail(req.session.pending2fa.email);
    return res.status(401).json({ error: 'Código inválido o expirado' });
  }
  const email = req.session.pending2fa.email;
  delete req.session.pending2fa;
  req.session.user = { email };
  res.json({ ok: true });
});

app.get('/api/2fa/status', requireAuth, (req, res) => {
  res.json({ enabled: tfa.is2faEnabled() });
});

app.post('/api/2fa/setup', requireAuth, async (req, res) => {
  if (tfa.is2faEnabled()) return res.status(400).json({ error: '2FA ya está activo' });
  const email = req.session?.user?.email || process.env.ADMIN_EMAIL || 'admin';
  const secret = tfa.generateSecret(email);
  tfa.saveTfaSecret(secret, false);
  const qr = await tfa.getQRDataUrl(secret);
  res.json({ qr, secret: secret.base32 });
});

app.post('/api/2fa/confirm', requireAuth, (req, res) => {
  if (tfa.is2faEnabled()) return res.status(400).json({ error: '2FA ya está activo' });
  const { code } = req.body || {};
  const cfg = tfa.getTfaConfig();
  if (!cfg?.secret) return res.status(400).json({ error: 'Ejecutá setup primero' });
  if (!tfa.verifyToken(code)) return res.status(401).json({ error: 'Código inválido' });
  tfa.enable2fa({ base32: cfg.secret });
  res.json({ ok: true });
});

app.post('/api/2fa/disable', requireAuth, (req, res) => {
  const { password } = req.body || {};
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedHash || !bcrypt.compareSync(password || '', expectedHash)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  tfa.disable2fa();
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({});
  res.json(req.session.user);
});

// SSRF protection: block internal/private hosts + DNS rebinding (OWASP)
const BLOCKED_HOSTNAMES = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|metadata\.|.*\.local$|.*\.internal$|.*\.localhost$)$/i;
const BLOCKED_IPS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^224\./, /^240\./, /^fc00:/i, /^fe80:/i, /^::1$/i, /^fd[0-9a-f]{2}:/i
];
function isPrivateIP(ip) {
  if (!ip) return true;
  return BLOCKED_IPS.some(r => r.test(ip));
}
// Block decimal IP (2130706433=127.0.0.1) and 0x7f... hex
function isDecimalOrHexPrivate(str) {
  const s = str.toLowerCase();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 2130706433 && n <= 2130706433 + 0xffffff) return true; // 127.x.x.x
    if (n >= 167772160 && n <= 184549375) return true;   // 10.0.0.0/8
    if (n >= 2886729728 && n <= 2886795263) return true; // 172.16.0.0/12
    if (n >= 3232235520 && n <= 3232301055) return true; // 192.168.0.0/16
  }
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = parseInt(s, 16);
    if (n >= 0x7f000001 && n <= 0x7fffffff) return true; // 127.0.0.1-127.255.255.255
    if (n >= 0x0a000000 && n <= 0x0affffff) return true; // 10.0.0.0/8
    if (n >= 0xac100000 && n <= 0xac1fffff) return true; // 172.16.0.0/12
    if (n >= 0xc0a80000 && n <= 0xc0a8ffff) return true; // 192.168.0.0/16
  }
  return false;
}
async function validateHostForSSRF(host) {
  const h = host.split(/[/?#]/)[0].split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h.length > 253) return null;
  if (BLOCKED_HOSTNAMES.test(h)) return null;
  if (isDecimalOrHexPrivate(h)) return null;
  try {
    const family = net.isIP(h);
    if (family) return isPrivateIP(h) ? null : { ip: h, family, hostname: h };
    const [addr, fam] = await dns.lookup(h, { verbatim: true });
    if (isPrivateIP(addr)) return null;
    return { ip: addr, family: fam || 4, hostname: h };
  } catch (_) { return null; }
}

const checkDomainLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { ok: false }, validate: { xForwardedForHeader: false } });
app.get('/api/check-domain', requireAuth, checkDomainLimiter, async (req, res) => {
  const domain = (req.query.domain || '').toString().trim().replace(/^https?:\/\//, '').split(/[/?#]/)[0].split(':')[0];
  if (!domain || domain.length > 253) return res.status(400).json({ ok: false, error: 'Dominio inválido' });
  const resolved = await validateHostForSSRF(domain);
  if (!resolved) return res.status(400).json({ ok: false, error: 'Dominio no permitido (SSRF)' });
  const { ip, family, hostname } = resolved;
  const ociHost = process.env.OCI_HOST;
  // Hairpin NAT: si el dominio resuelve a nuestro servidor, conectar a localhost (la VM no puede alcanzar su propia IP pública)
  const connectHost = (ociHost && ip === ociHost.trim()) ? '127.0.0.1' : ip;
  const lookup = (ociHost && ip === ociHost.trim()) ? undefined : (host, opts, cb) => cb(null, ip, family);
  const opts = {
    host: connectHost,
    hostname,
    port: 443,
    path: '/',
    method: 'HEAD',
    servername: hostname,
  };
  if (lookup) opts.lookup = lookup;
  const clientReq = https.request(opts, (r) => {
    r.resume();
    if (!res.headersSent) res.json({ ok: r.statusCode >= 200 && r.statusCode < 400 });
  });
  clientReq.on('error', () => { if (!res.headersSent) res.json({ ok: false }); });
  clientReq.on('timeout', () => { clientReq.destroy(); if (!res.headersSent) res.json({ ok: false }); });
  clientReq.setTimeout(8000);
  clientReq.end();
});

app.get('/api/sites', requireAuth, (req, res) => {
  try {
    res.json({ sites: caddy.getSites() });
  } catch (e) {
    res.status(500).json({ error: safeError(e, 'Error al cargar sitios') });
  }
});

const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
function validateSites(sites) {
  if (!Array.isArray(sites) || sites.length > 50) return 'sites debe ser un array (máx 50)';
  for (const s of sites) {
    if (!s || typeof s !== 'object') return 'Cada sitio debe ser un objeto';
    if (typeof s.domain !== 'string' || s.domain.length > 253) return 'domain inválido';
    const domain = s.domain.trim();
    if (!domain || !DOMAIN_REGEX.test(domain)) return `Dominio inválido: ${domain}`;
    const port = typeof s.port === 'number' ? s.port : parseInt(s.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) return `Puerto inválido: ${s.port}`;
  }
  return null;
}

app.put('/api/sites', requireAuth, (req, res) => {
  const { sites } = req.body || {};
  const err = validateSites(sites);
  if (err) return res.status(400).json({ error: err });
  const sanitized = sites.map(s => ({
    domain: s.domain.trim(),
    port: Math.floor(typeof s.port === 'number' ? s.port : parseInt(s.port, 10)),
    redirectWww: Boolean(s.redirectWww),
  }));
  try {
    caddy.saveSites(sanitized);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeError(e, 'Error al guardar') });
  }
});

app.get('/api/backups', requireAuth, (req, res) => {
  try {
    res.json({ backups: backups.listBackups() });
  } catch (e) {
    res.status(500).json({ error: safeError(e, 'Error al listar backups') });
  }
});

app.post('/api/backups/restore', requireAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Backup inválido' });
  if (!backups.restoreBackup(id)) return res.status(400).json({ error: 'Backup no encontrado' });
  res.json({ ok: true });
});

app.post('/api/caddy/deploy', requireAuth, deployLimiter, async (req, res) => {
  const host = process.env.OCI_HOST;
  const isLocal = !host || host === '127.0.0.1' || host === 'localhost';

  let content;
  try {
    content = fs.readFileSync(caddy.CADDYFILE_PATH, 'utf8');
  } catch (e) {
    return res.status(400).json({ error: 'No hay Caddyfile. Guardá los sitios primero.' });
  }

  try {
    backups.createBackup(content);
    backups.pruneOldBackups();
  } catch (_) {}

  if (isLocal) {
    try {
      fs.writeFileSync('/tmp/caddyfile-deploy', content);
      const { execSync } = require('child_process');
      execSync('sudo cp /tmp/caddyfile-deploy /etc/caddy/Caddyfile && sudo systemctl reload caddy');
      logger.logDeploy('ok');
      return res.json({ ok: true });
    } catch (e) {
      logger.logDeploy('fail', safeError(e, 'Deploy falló'));
      return res.status(500).json({ error: safeError(e, 'Deploy falló') });
    }
  }

  const user = process.env.OCI_USER;
  const keyPath = process.env.OCI_SSH_KEY_PATH?.replace(/^~/, process.env.HOME || '');
  const keyContent = process.env.OCI_SSH_PRIVATE_KEY;
  if (!user) return res.status(500).json({ error: 'Configurar OCI_USER en .env' });

  let key = keyContent;
  if (!key && keyPath && fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, 'utf8');
  if (!key) return res.status(500).json({ error: 'Configurar OCI_SSH_KEY_PATH o OCI_SSH_PRIVATE_KEY' });

  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const conn = new Client();
  const sendErr = (msg) => { if (!res.headersSent) res.status(500).json({ error: msg }); };
  const sshTimeout = setTimeout(() => { conn.destroy(); sendErr('Deploy timeout (30s)'); }, 30000);
  conn.on('ready', () => {
    conn.exec('echo ' + b64 + ' | base64 -d | sudo tee /etc/caddy/Caddyfile > /dev/null && sudo systemctl reload caddy', (err, stream) => {
      if (err) {
        clearTimeout(sshTimeout);
        conn.end();
        return sendErr(safeError(err, 'Deploy falló'));
      }
      let stderr = '';
      stream.stderr.on('data', d => { stderr += d.toString(); });
      stream.on('close', (code) => {
        clearTimeout(sshTimeout);
        conn.end();
        if (res.headersSent) return;
        if (code !== 0) {
          logger.logDeploy('fail', stderr || 'Deploy falló');
          return res.status(500).json({ error: isProd ? 'Deploy falló' : (stderr || 'Deploy falló') });
        }
        logger.logDeploy('ok');
        res.json({ ok: true });
      });
    });
  }).connect({ host, port: 22, username: user, privateKey: key });
  conn.on('error', (err) => { clearTimeout(sshTimeout); logger.logDeploy('fail', err.message); sendErr(safeError(err, 'Deploy falló')); });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OCI VM Manager en http://localhost:${PORT}`);
});
