(function() {
  const KEY = 'oci-vm-theme';
  function get() { return localStorage.getItem(KEY) || 'light'; }
  function set(v) { localStorage.setItem(KEY, v); document.documentElement.setAttribute('data-theme', v); }
  function toggle() { const next = get() === 'dark' ? 'light' : 'dark'; set(next); return next; }
  set(get());
  window.ociTheme = { get, set, toggle };
})();
