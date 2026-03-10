const msg = (t, ok) => {
  const el = document.getElementById('msg');
  el.textContent = t;
  el.className = 'msg ' + (ok ? 'success' : 'error');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
};
document.getElementById('userEmail').textContent = 'Cargando…';
const fetcho = (url, opts) => fetch(url, { ...opts, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', ...opts?.headers } });
const checkAuth = r => { if (r.status === 401) { sessionStorage.removeItem('oci-vm-authed'); location.replace('/login.html'); return null; } return r; };
fetcho('/api/me').then(checkAuth).then(r => r && r.json()).then(u => { if (u) document.getElementById('userEmail').textContent = u.email || ''; });

let sites = [];
const container = document.getElementById('sitesList');
const preview = document.getElementById('caddyPreview');

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function renderSite(site, i) {
  const div = document.createElement('div');
  div.className = 'site-row';
  div.innerHTML = `
    <div class="site-fields">
      <input type="text" class="site-domain" placeholder="dominio.ejemplo.com" value="${esc(site.domain || '')}">
      <div class="site-fields-row">
        <input type="number" class="site-port" placeholder="3000" min="1" max="65535" value="${site.port || 3000}">
        <label class="site-www">
          <input type="checkbox" class="site-redirect-www" ${site.redirectWww ? 'checked' : ''}>
          Redirigir www
        </label>
      </div>
      <div class="site-status" data-idx="${i}">
        <span class="status-dot status-pending" title="Sin verificar"></span>
        <span class="status-msg" aria-live="polite"></span>
      </div>
    </div>
    <div class="site-meta">
      <div class="site-actions">
        <button type="button" class="btn btn-check" data-idx="${i}" title="Verificar si responde">Verificar</button>
        <button type="button" class="btn btn-secondary btn-preview" data-idx="${i}">Previsualizar</button>
        <button type="button" class="btn btn-ghost btn-remove" data-idx="${i}">Eliminar</button>
      </div>
    </div>
  `;
  return div;
}

function collectSites() {
  return Array.from(container.querySelectorAll('.site-row')).map(row => ({
    domain: row.querySelector('.site-domain').value.trim(),
    port: parseInt(row.querySelector('.site-port').value, 10) || 3000,
    redirectWww: row.querySelector('.site-redirect-www').checked
  })).filter(s => s.domain);
}

let pendingDeleteIdx = null;
function showDeleteModal(idx, domain) {
  if (!domain) { msg('El dominio está vacío', false); return; }
  pendingDeleteIdx = idx;
  document.getElementById('modalDeleteDomain').textContent = domain;
  document.getElementById('modalDeleteText').textContent = 'Escribí el dominio exacto para confirmar que querés eliminarlo.';
  document.getElementById('modalDeleteConfirm').value = '';
  document.getElementById('modalDeleteError').classList.add('hidden');
  document.getElementById('modalDelete').classList.remove('hidden');
  document.getElementById('modalDeleteConfirm').focus();
}
function hideDeleteModal() {
  pendingDeleteIdx = null;
  document.getElementById('modalDelete').classList.add('hidden');
}
function confirmDelete() {
  const domain = document.getElementById('modalDeleteDomain').textContent;
  const input = document.getElementById('modalDeleteConfirm').value.trim();
  const errEl = document.getElementById('modalDeleteError');
  if (input !== domain) {
    errEl.textContent = 'El dominio no coincide. Escribilo exactamente.';
    errEl.classList.remove('hidden');
    return;
  }
  if (pendingDeleteIdx != null) {
    sites.splice(pendingDeleteIdx, 1);
    render();
    updatePreview();
  }
  hideDeleteModal();
}

function updatePreview() {
  const s = collectSites();
  if (!s.length) { preview.textContent = '# Agregá dominios arriba'; return; }
  let out = '';
  s.forEach(({ domain, port, redirectWww }) => {
    out += `${domain} {\n    reverse_proxy 127.0.0.1:${port}\n}\n\n`;
    if (redirectWww) out += `www.${domain} {\n    redir https://${domain}{uri} permanent\n}\n\n`;
  });
  preview.textContent = out.trim() || '# Sin configuración';
}

function render() {
  container.innerHTML = '';
  sites.forEach((site, i) => {
    const el = renderSite(site, i);
    container.appendChild(el);
    el.querySelector('.btn-preview').onclick = () => {
      const domain = el.querySelector('.site-domain').value.trim();
      if (!domain) { msg('Ingresá un dominio para previsualizar', false); return; }
      const a = document.createElement('a');
      a.href = 'https://' + domain.replace(/^https?:\/\//, '');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    el.querySelector('.btn-remove').onclick = () => showDeleteModal(i, el.querySelector('.site-domain').value.trim());
    el.querySelector('.btn-check').onclick = () => checkDomain(el);
    el.querySelectorAll('input').forEach(inp => inp.oninput = updatePreview);
  });
  updatePreview();
  container.querySelectorAll('.site-row').forEach(row => {
    const domain = row.querySelector('.site-domain')?.value?.trim();
    if (domain) checkDomain(row);
  });
}

async function checkDomain(rowEl) {
  const domain = rowEl.querySelector('.site-domain')?.value?.trim();
  const port = parseInt(rowEl.querySelector('.site-port')?.value, 10) || 3000;
  if (!domain) return;
  const statusEl = rowEl.querySelector('.status-dot');
  const msgEl = rowEl.querySelector('.status-msg');
  const btnEl = rowEl.querySelector('.btn-check');
  statusEl.className = 'status-dot status-checking';
  statusEl.title = '';
  if (msgEl) msgEl.textContent = 'Verificando…';
  btnEl.disabled = true;
  try {
    const r = await fetcho('/api/check-domain?domain=' + encodeURIComponent(domain) + '&port=' + port);
    const d = await r.json();
    statusEl.className = 'status-dot ' + (d.ok ? 'status-ok' : 'status-fail');
    statusEl.title = d.ok ? 'Caddy configurado y visible desde internet' : '';
    if (msgEl) msgEl.textContent = d.ok ? 'Caddy OK, visible' : (d.error || 'No responde');
    if (msgEl) msgEl.className = 'status-msg ' + (d.ok ? 'status-msg-ok' : 'status-msg-fail');
  } catch (_) {
    statusEl.className = 'status-dot status-fail';
    statusEl.title = '';
    if (msgEl) { msgEl.textContent = 'Error al verificar'; msgEl.className = 'status-msg status-msg-fail'; }
  }
  btnEl.disabled = false;
}

document.getElementById('btnAddSite').onclick = () => {
  sites.push({ domain: '', port: 3000, redirectWww: true });
  render();
  container.lastElementChild?.querySelector('.site-domain')?.focus();
};

document.getElementById('btnSave').onclick = async () => {
  const data = collectSites();
  if (!data.length) { msg('Agregá al menos un dominio', false); return; }
  const res = await fetcho('/api/sites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sites: data }) });
  const d = await res.json();
  if (res.ok) { sites = data; msg('Guardado', true); } else msg(d.error || 'Error', false);
};

document.getElementById('btnDeploy').onclick = async () => {
  const data = collectSites();
  if (!data.length) { msg('Agregá al menos un dominio', false); return; }
  await fetcho('/api/sites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sites: data }) });
  document.getElementById('btnDeploy').disabled = true;
  const res = await fetcho('/api/caddy/deploy', { method: 'POST' });
  const d = await res.json();
  document.getElementById('btnDeploy').disabled = false;
  if (res.ok) msg('Caddy desplegado y recargado', true);
  else msg(d.error || 'Error', false);
};

document.querySelectorAll('[data-dismiss]').forEach(el => el.addEventListener('click', hideDeleteModal));
document.getElementById('modalDeleteBtn').onclick = confirmDelete;
document.getElementById('modalDeleteConfirm').onkeydown = (e) => {
  if (e.key === 'Enter') confirmDelete();
  if (e.key === 'Escape') hideDeleteModal();
};

document.getElementById('themeToggle').onclick = () => {
  const isDark = window.ociTheme.toggle() === 'dark';
  document.getElementById('themeToggle').textContent = isDark ? '☀️' : '🌙';
  document.getElementById('themeToggle').title = isDark ? 'Modo claro' : 'Modo oscuro';
};
(function setToggleIcon() {
  const isDark = window.ociTheme?.get() === 'dark';
  const el = document.getElementById('themeToggle');
  if (el) { el.textContent = isDark ? '☀️' : '🌙'; el.title = isDark ? 'Modo claro' : 'Modo oscuro'; }
})();

document.getElementById('btnLogout').onclick = async () => {
  await fetcho('/api/logout', { method: 'POST' });
  sessionStorage.removeItem('oci-vm-authed');
  location.replace('/login.html');
};

function loadBackups() {
  fetcho('/api/backups').then(checkAuth).then(r => r && r.json()).then(d => {
    const sel = document.getElementById('backupSelect');
    sel.innerHTML = '<option value="">— Elegir backup —</option>';
    (d?.backups || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.label + ' (' + b.id + ')';
      sel.appendChild(opt);
    });
    sel.onchange = () => { document.getElementById('btnRestore').disabled = !sel.value; };
  });
}

document.getElementById('btnRestore').onclick = async () => {
  const id = document.getElementById('backupSelect').value;
  if (!id) return;
  const label = document.getElementById('backupSelect').selectedOptions[0]?.textContent || id;
  if (!confirm('¿Restaurar este backup?\n\n' + label + '\n\nSe reemplazará la configuración actual.')) return;
  const res = await fetcho('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const d = await res.json();
  const el = document.getElementById('backupMsg');
  el.classList.remove('hidden');
  el.className = 'msg ' + (res.ok ? 'success' : 'error');
  el.textContent = res.ok ? 'Backup restaurado. Recargando…' : (d.error || 'Error');
  if (res.ok) setTimeout(() => location.reload(), 1000);
};

function loadTfaStatus() {
  fetcho('/api/2fa/status').then(checkAuth).then(r => r && r.json()).then(d => {
    const enabled = d?.enabled;
    document.getElementById('tfaStatusText').textContent = enabled ? '2FA activo. Tu cuenta está más segura.' : '2FA no configurado. Configuralo para mayor seguridad.';
    document.getElementById('tfaSetup').classList.toggle('hidden', !!enabled);
    document.getElementById('tfaDisable').classList.toggle('hidden', !enabled);
    if (!enabled) startTfaSetup();
  });
}

function startTfaSetup() {
  fetcho('/api/2fa/setup', { method: 'POST' }).then(checkAuth).then(r => r && r.json()).then(d => {
    if (d?.qr) {
      const img = document.createElement('img');
      img.src = d.qr;
      img.alt = 'QR 2FA';
      document.getElementById('tfaQR').innerHTML = '';
      document.getElementById('tfaQR').appendChild(img);
    }
  });
}

document.getElementById('btnTfaConfirm').onclick = async () => {
  const code = document.getElementById('tfaConfirmCode').value.trim();
  if (!code) { msg('Ingresá el código', false); return; }
  const res = await fetcho('/api/2fa/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const d = await res.json();
  if (res.ok) { msg('2FA activado', true); loadTfaStatus(); } else msg(d.error || 'Error', false);
};

document.getElementById('btnTfaDisable').onclick = async () => {
  const password = document.getElementById('tfaDisablePassword').value;
  const res = await fetcho('/api/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const d = await res.json();
  if (res.ok) { msg('2FA desactivado', true); loadTfaStatus(); } else msg(d.error || 'Error', false);
};

fetcho('/api/sites').then(checkAuth).then(r => r && r.json()).then(d => {
  if (d && d.sites && d.sites.length) sites = d.sites;
  else sites = [{ domain: 'turnero-cobra.duckdns.org', port: 3000, redirectWww: true }, { domain: 'fauricarnes.duckdns.org', port: 3001, redirectWww: true }];
  render();
});
loadBackups();
loadTfaStatus();
