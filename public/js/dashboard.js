const msg = (t, ok) => {
  const el = document.getElementById('msg');
  el.textContent = t;
  el.className = 'msg ' + (ok ? 'success' : 'error');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
};
document.getElementById('userEmail').textContent = 'Cargando…';
const fetcho = (url, opts) => fetch(url, { credentials: 'include', ...opts });
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
      <input type="number" class="site-port" placeholder="3000" min="1" max="65535" value="${site.port || 3000}">
      <label class="site-www">
        <input type="checkbox" class="site-redirect-www" ${site.redirectWww ? 'checked' : ''}>
        Redirigir www
      </label>
    </div>
    <div class="site-status" data-idx="${i}">
      <span class="status-dot status-pending" title="Sin verificar"></span>
      <button type="button" class="btn btn-ghost btn-check" data-idx="${i}" title="Verificar si responde">Verificar</button>
    </div>
    <div class="site-actions">
      <button type="button" class="btn btn-secondary btn-preview" data-idx="${i}">Previsualizar</button>
      <button type="button" class="btn btn-ghost btn-remove" data-idx="${i}">Eliminar</button>
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
  if (!domain) return;
  const statusEl = rowEl.querySelector('.status-dot');
  const btnEl = rowEl.querySelector('.btn-check');
  statusEl.className = 'status-dot status-checking';
  statusEl.title = 'Verificando…';
  btnEl.disabled = true;
  try {
    const r = await fetcho('/api/check-domain?domain=' + encodeURIComponent(domain));
    const d = await r.json();
    statusEl.className = 'status-dot ' + (d.ok ? 'status-ok' : 'status-fail');
    statusEl.title = d.ok ? 'Funcionando' : 'No responde';
  } catch (_) {
    statusEl.className = 'status-dot status-fail';
    statusEl.title = 'Error al verificar';
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

document.getElementById('btnLogout').onclick = async () => {
  await fetcho('/api/logout', { method: 'POST' });
  sessionStorage.removeItem('oci-vm-authed');
  location.replace('/login.html');
};

fetcho('/api/sites').then(checkAuth).then(r => r && r.json()).then(d => {
  if (d && d.sites && d.sites.length) sites = d.sites;
  else sites = [{ domain: 'turnero-cobra.duckdns.org', port: 3000, redirectWww: true }, { domain: 'fauricarnes.duckdns.org', port: 3001, redirectWww: true }];
  render();
});
