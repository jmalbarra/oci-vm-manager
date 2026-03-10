require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const https = require('https');
const { Client } = require('ssh2');
const caddy = require('./src/caddy');

const app = express();
const PORT = process.env.PORT || 3080;
const isProd = process.env.NODE_ENV === 'production';

const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret === 'change-me-in-production')) {
  console.error('Fatal: SESSION_SECRET debe estar configurado en producción');
  process.exit(1);
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
  return res.redirect('/login.html');
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: process.env.FORCE_SECURE_COOKIE === '1'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Demasiados intentos. Esperá 15 min.' } });
const deployLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Demasiados deploys. Esperá 1 min.' } });

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

app.get('/login.html', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
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
  if (email.trim().toLowerCase() !== expectedEmail.toLowerCase()) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!bcrypt.compareSync(password, expectedHash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.user = { email: expectedEmail };
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({});
  res.json(req.session.user);
});

const checkDomainLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { ok: false } });
app.get('/api/check-domain', requireAuth, checkDomainLimiter, (req, res) => {
  const domain = (req.query.domain || '').toString().trim().replace(/^https?:\/\//, '');
  if (!domain || domain.length > 253) return res.status(400).json({ ok: false, error: 'Dominio inválido' });
  const url = `https://${domain}/`;
  const clientReq = https.request(url, { method: 'HEAD' }, (r) => {
    r.resume(); // consume stream
    res.json({ ok: r.statusCode >= 200 && r.statusCode < 400 });
  });
  clientReq.on('error', () => res.json({ ok: false }));
  clientReq.on('timeout', () => { clientReq.destroy(); res.json({ ok: false }); });
  clientReq.setTimeout(8000);
  clientReq.end();
});

app.get('/api/sites', requireAuth, (req, res) => {
  try {
    res.json({ sites: caddy.getSites() });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/caddy/deploy', requireAuth, deployLimiter, async (req, res) => {
  const host = process.env.OCI_HOST;
  const isLocal = !host || host === '127.0.0.1' || host === 'localhost';

  if (isLocal) {
    try {
      let content;
      try {
        content = fs.readFileSync(caddy.CADDYFILE_PATH, 'utf8');
      } catch (e) {
        return res.status(400).json({ error: 'No hay Caddyfile. Guardá los sitios primero.' });
      }
      fs.writeFileSync('/tmp/caddyfile-deploy', content);
      const { execSync } = require('child_process');
      execSync('sudo cp /tmp/caddyfile-deploy /etc/caddy/Caddyfile && sudo systemctl reload caddy');
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Deploy falló' });
    }
  }

  const user = process.env.OCI_USER;
  const keyPath = process.env.OCI_SSH_KEY_PATH?.replace(/^~/, process.env.HOME || '');
  const keyContent = process.env.OCI_SSH_PRIVATE_KEY;
  if (!user) return res.status(500).json({ error: 'Configurar OCI_USER en .env' });

  let key = keyContent;
  if (!key && keyPath && fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, 'utf8');
  if (!key) return res.status(500).json({ error: 'Configurar OCI_SSH_KEY_PATH o OCI_SSH_PRIVATE_KEY' });

  let content;
  try {
    content = fs.readFileSync(caddy.CADDYFILE_PATH, 'utf8');
  } catch (e) {
    return res.status(400).json({ error: 'No hay Caddyfile. Guardá los sitios primero.' });
  }

  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const conn = new Client();
  conn.on('ready', () => {
    conn.exec('echo ' + b64 + ' | base64 -d | sudo tee /etc/caddy/Caddyfile > /dev/null && sudo systemctl reload caddy', (err, stream) => {
      if (err) {
        conn.end();
        return res.status(500).json({ error: err.message });
      }
      let stderr = '';
      stream.stderr.on('data', d => { stderr += d.toString(); });
      stream.on('close', (code) => {
        conn.end();
        if (code !== 0) return res.status(500).json({ error: stderr || 'Deploy falló' });
        res.json({ ok: true });
      });
    });
  }).connect({ host, port: 22, username: user, privateKey: key });
  conn.on('error', (err) => res.status(500).json({ error: err.message }));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OCI VM Manager en http://localhost:${PORT}`);
});
