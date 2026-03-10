(function() {
  if (location.search) history.replaceState(null, '', location.pathname);
  fetch('/api/me').then(r => { if (r.ok) location.replace('/'); }).catch(function(){});
  var emailInp = document.getElementById('loginEmail');
  var passInp = document.getElementById('loginPassword');
  var err = document.getElementById('loginError');
  var btn = document.getElementById('btnEntrar');
  function doLogin() {
    var email = emailInp.value.trim();
    var password = passInp.value;
    if (!email || !password) { err.textContent = 'Completá email y contraseña'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ email: email, password: password }),
      credentials: 'include'
    }).then(function(res) {
      return res.json().then(function(data) {
        btn.disabled = false;
        btn.textContent = 'Entrar';
        if (!res.ok) {
          err.textContent = data.error || (res.status === 429 ? 'Demasiados intentos. Esperá 15 min.' : 'Credenciales inválidas');
          err.classList.remove('hidden');
        } else {
          sessionStorage.setItem('oci-vm-authed', '1');
          location.replace('/');
        }
      }, function() { btn.disabled = false; btn.textContent = 'Entrar'; err.textContent = 'Respuesta inválida del servidor'; err.classList.remove('hidden'); });
    }).catch(function() {
      btn.disabled = false;
      btn.textContent = 'Entrar';
      err.textContent = 'Error de conexión. Revisá la red e intentá de nuevo.';
      err.classList.remove('hidden');
    });
  }
  btn.onclick = doLogin;
  emailInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
  passInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
})();
