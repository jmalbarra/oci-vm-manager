require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Client } = require('ssh2');
const caddy = require('./src/caddy');

const app = express();
const PORT = process.env.PORT || 3080;

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
  return res.redirect('/login.html');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.get('/login.html', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  if (!req.session?.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const expectedEmail = process.env.ADMIN_EMAIL || 'jmalbarracinhc@gmail.com';
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedHash || !email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  if (email.trim().toLowerCase() !== expectedEmail.toLowerCase()) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!bcrypt.compareSync(password, expectedHash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.session.user = { email: expectedEmail };
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

app.get('/api/sites', requireAuth, (req, res) => {
  try {
    res.json({ sites: caddy.getSites() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/sites', requireAuth, (req, res) => {
  const { sites } = req.body || {};
  if (!Array.isArray(sites)) return res.status(400).json({ error: 'sites requerido (array)' });
  const valid = sites.every(s => s && typeof s.domain === 'string' && typeof s.port === 'number');
  if (!valid) return res.status(400).json({ error: 'Cada sitio debe tener domain (string) y port (number)' });
  try {
    caddy.saveSites(sites);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/caddy/deploy', requireAuth, async (req, res) => {
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
