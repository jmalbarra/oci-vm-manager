const fs = require('fs');
const path = require('path');

const SITES_PATH = path.join(__dirname, '..', 'config', 'sites.json');
const CADDYFILE_PATH = path.join(__dirname, '..', 'config', 'Caddyfile');

const DEFAULT_SITES = [
  { domain: 'oci-vm-manager.duckdns.org', port: 3080, redirectWww: true },
  { domain: 'turnero-cobra.duckdns.org', port: 3000, redirectWww: true },
  { domain: 'fauricarnes.duckdns.org', port: 3001, redirectWww: true },
];

function parseCaddyfile(content) {
  const sites = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const domainMatch = line.match(/^([\w.-]+)\s*\{$/);
    if (domainMatch) {
      const domain = domainMatch[1];
      if (domain.startsWith('www.')) {
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('}')) i++;
        i++;
        continue;
      }
      let port = 3000;
      let redirectWww = false;
      i++;
      while (i < lines.length) {
        const inner = lines[i].trim();
        if (inner === '}') break;
        const proxyMatch = inner.match(/reverse_proxy\s+127\.0\.0\.1:(\d+)/);
        if (proxyMatch) port = parseInt(proxyMatch[1], 10);
        i++;
      }
      const wwwDomain = 'www.' + domain;
      let j = i;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith(wwwDomain + ' {') || nextLine.startsWith(wwwDomain + '{')) {
          redirectWww = true;
          break;
        }
        if (nextLine.match(/^[\w.-]+\s*\{$/)) break;
        j++;
      }
      sites.push({ domain, port, redirectWww });
    }
    i++;
  }
  return sites.length ? sites : null;
}

const SAFE_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

function generateCaddyfile(sites) {
  let out = '# OCI VM — Caddy multi-app (generado por OCI VM Manager)\n\n';
  for (const { domain, port, redirectWww } of sites) {
    const d = String(domain || '').trim();
    const p = Math.floor(Number(port)) || 3000;
    if (!d || !SAFE_DOMAIN.test(d) || p < 1 || p > 65535) continue;
    out += `${d} {\n    reverse_proxy 127.0.0.1:${p}\n}\n\n`;
    if (redirectWww) {
      out += `www.${d} {\n    redir https://${d}{uri} permanent\n}\n\n`;
    }
  }
  return out.trim();
}

function getSites() {
  if (fs.existsSync(SITES_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SITES_PATH, 'utf8'));
    } catch (_) {}
  }
  if (fs.existsSync(CADDYFILE_PATH)) {
    const parsed = parseCaddyfile(fs.readFileSync(CADDYFILE_PATH, 'utf8'));
    if (parsed) return parsed;
  }
  return DEFAULT_SITES;
}

function saveSites(sites) {
  const dir = path.dirname(SITES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2));
  fs.writeFileSync(CADDYFILE_PATH, generateCaddyfile(sites));
}

function restoreFromCaddyfile(content) {
  const sites = parseCaddyfile(content);
  if (!sites) return;
  const dir = path.dirname(SITES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CADDYFILE_PATH, content);
  fs.writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2));
}

module.exports = { getSites, saveSites, generateCaddyfile, restoreFromCaddyfile, parseCaddyfile, CADDYFILE_PATH };
