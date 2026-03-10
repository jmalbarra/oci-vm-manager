#!/usr/bin/env node
/**
 * Troubleshooting script para check-domain / SSRF.
 * Ejecutar en el servidor: node scripts/troubleshoot-check-domain.js <dominio>
 * Ej: node scripts/troubleshoot-check-domain.js mipagina.duckdns.org
 */
const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|metadata\.|.*\.local$|.*\.internal$|.*\.localhost$)$/i;
const BLOCKED_IPS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^224\./, /^240\./, /^fc00:/i, /^fe80:/i, /^::1$/i, /^fd[0-9a-f]{2}:/i
];
function isPrivateIP(ip) {
  if (!ip) return true;
  return BLOCKED_IPS.some(r => r.test(ip));
}
function isDecimalOrHexPrivate(str) {
  const s = String(str || '').toLowerCase();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 2130706433 && n <= 2130706433 + 0xffffff) return true;
    if (n >= 167772160 && n <= 184549375) return true;
    if (n >= 2886729728 && n <= 2886795263) return true;
    if (n >= 3232235520 && n <= 3232301055) return true;
  }
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = parseInt(s, 16);
    if (n >= 0x7f000001 && n <= 0x7fffffff) return true;
    if (n >= 0x0a000000 && n <= 0x0affffff) return true;
    if (n >= 0xac100000 && n <= 0xac1fffff) return true;
    if (n >= 0xc0a80000 && n <= 0xc0a8ffff) return true;
  }
  return false;
}

async function validateHostForSSRF(host) {
  const raw = String(host || '').split(/[/?#]/)[0].split(':')[0].toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const h = raw.trim();
  if (!h || h.length > 253) return { err: 'empty_or_long' };
  if (BLOCKED_HOSTNAMES.test(h)) return { err: 'blocked_hostname', host: h };
  if (isDecimalOrHexPrivate(h)) return { err: 'decimal_hex_private' };
  try {
    const family = net.isIP(h);
    if (family) return isPrivateIP(h) ? { err: 'private_ip' } : { ip: h, family, hostname: h };
    let result;
    try {
      result = await dns.lookup(h, { verbatim: true });
    } catch (dnsErr) {
      try {
        result = await dns.lookup(h, { all: false });
      } catch (e2) {
        return { err: 'dns_failed', detail: (dnsErr && dnsErr.message) || 'unknown' };
      }
    }
    const addr = result && result.address;
    const fam = result && result.family;
    return { ip: addr, family: fam || 4, hostname: h };
  } catch (e) {
    return { err: 'unexpected', detail: (e && e.message) || 'unknown' };
  }
}

async function main() {
  const domain = process.argv[2] || 'example.com';
  console.log('Input dominio:', JSON.stringify(domain));
  console.log('---');
  const r = await validateHostForSSRF(domain);
  console.log('Resultado:', JSON.stringify(r, null, 2));
  if (r.err) {
    console.log('---');
    console.log('Falló con:', r.err);
    process.exit(1);
  }
  console.log('OK - resuelto a', r.ip);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
