(function() {
  if (location.search) history.replaceState(null, '', location.pathname);
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.onclick = function() {
      var isDark = window.ociTheme.toggle() === 'dark';
      themeBtn.textContent = isDark ? '☀️' : '🌙';
      themeBtn.title = isDark ? 'Modo claro' : 'Modo oscuro';
    };
    (function() {
      var isDark = window.ociTheme && window.ociTheme.get() === 'dark';
      themeBtn.textContent = isDark ? '☀️' : '🌙';
      themeBtn.title = isDark ? 'Modo claro' : 'Modo oscuro';
    })();
  }
  fetch('/api/me', { credentials: 'include' }).then(r => { if (r.ok) location.replace('/'); }).catch(function(){});
  var emailInp = document.getElementById('loginEmail');
  var passInp = document.getElementById('loginPassword');
  var err = document.getElementById('loginError');
  var btn = document.getElementById('btnEntrar');
  var loginStep = document.getElementById('loginStep');
  var tfaStep = document.getElementById('tfaStep');
  var tfaCodeInp = document.getElementById('tfaCode');
  var tfaErr = document.getElementById('tfaError');
  var btnTfaVerify = document.getElementById('btnTfaVerify');
  var btnTfaBack = document.getElementById('btnTfaBack');
  function showStep(step) {
    if (step === 'login') {
      loginStep.classList.remove('hidden');
      tfaStep.classList.add('hidden');
    } else {
      loginStep.classList.add('hidden');
      tfaStep.classList.remove('hidden');
      tfaCodeInp.value = '';
      tfaCodeInp.focus();
      tfaErr.classList.add('hidden');
    }
  }
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
        } else if (data.requires2fa) {
          showStep('tfa');
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
  function doTfaVerify() {
    var code = tfaCodeInp.value.trim();
    if (!code) { tfaErr.textContent = 'Ingresá el código'; tfaErr.classList.remove('hidden'); return; }
    tfaErr.classList.add('hidden');
    btnTfaVerify.disabled = true;
    fetch('/api/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify({ code: code })
    }).then(function(res) {
      return res.json().then(function(data) {
        btnTfaVerify.disabled = false;
        if (!res.ok) {
          tfaErr.textContent = data.error || 'Código inválido';
          tfaErr.classList.remove('hidden');
        } else {
          sessionStorage.setItem('oci-vm-authed', '1');
          location.replace('/');
        }
      }, function() { btnTfaVerify.disabled = false; tfaErr.textContent = 'Error'; tfaErr.classList.remove('hidden'); });
    }).catch(function() { btnTfaVerify.disabled = false; tfaErr.textContent = 'Error de conexión'; tfaErr.classList.remove('hidden'); });
  }
  btn.onclick = doLogin;
  btnTfaVerify.onclick = doTfaVerify;
  btnTfaBack.onclick = function() { showStep('login'); };
  emailInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
  passInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
  tfaCodeInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doTfaVerify(); } });
})();
