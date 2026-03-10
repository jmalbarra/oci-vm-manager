# Red Team Assessment — OCI VM Manager

Fecha: 2025-03 | Perspectiva: atacante externo/insider

---

## Vulnerabilidades encontradas y estado

### Críticas (corregidas)

| # | Vulnerabilidad | Impacto | Fix aplicado |
|---|----------------|---------|--------------|
| 1 | **DNS Rebinding en check-domain** | Atacante autenticado podía hacer rebinding: dominio público → resolución interna entre check y request. Conectar a 169.254.169.254, localhost, etc. | Conexión fijada al IP validado con `lookup` custom. No se permite nueva resolución DNS. |
| 2 | **IP decimal/hex para SSRF** | `2130706433`, `0x7f000001` = 127.0.0.1. Algunos clientes aceptan estas formas. | Bloqueo explícito de IPs decimales/hex en rangos privados. |

### Altas (corregidas)

| # | Vulnerabilidad | Impacto | Fix aplicado |
|---|----------------|---------|--------------|
| 3 | **Deploy SSH sin timeout** | Conexión colgada exhausta workers; DoS. | Timeout 30s; `conn.destroy()` si no hay respuesta. |
| 4 | **Doble respuesta en callbacks** | `res.json()` múltiple → `Cannot set headers after they are sent`. | Uso de `res.headersSent` antes de responder. |

### Medias (mitigadas / aceptadas)

| # | Vulnerabilidad | Estado |
|---|----------------|--------|
| 5 | **Info disclosure en 500** | ~~`e.message` puede exponer rutas~~ → `safeError()` en prod devuelve mensaje genérico |
| 6 | **ReDoS en regex BLOCKED_HOSTNAMES** | `.*\.local$` puede ser costosa con input largo. Baja probabilidad; límite de longitud 253 atenúa. |
| 7 | **Sesión 24h** | Tiempo elevado; aceptable para admin. Opcional: reducir o logout automático tras inactividad. |

---

## Vectores de ataque probados (sin éxito)

- **Bypass auth**: no hay rutas sensibles sin `requireAuth`.
- **CSRF**: SameSite=Lax + header `X-Requested-With` bloquean POST/PUT desde otros sitios.
- **Path traversal**: rutas de archivos fijas; no hay input en rutas de disco.
- **Command injection**: deploy usa contenido generado; base64 evita metachars.
- **XSS**: escape con `esc()` en datos renderizados; `textContent` para mensajes.
- **Prototype pollution**: se valida `sites` explícitamente; no se usa herencia de prototype.
- **Rate limit bypass**: `xForwardedForHeader: false` evita spoofing de IP.

---

## Checklist post-deploy

- [ ] `SESSION_SECRET` fuerte (≥32 bytes aleatorios)
- [ ] `ADMIN_PASSWORD_HASH` bcrypt cost ≥10
- [ ] `FORCE_SECURE_COOKIE=1` en HTTPS
- [ ] `.env` fuera del repo y con permisos restrictivos
- [ ] `npm audit` sin vulnerabilidades conocidas
- [ ] Logs de intentos de login fallidos y deploys
- [ ] Backup del Caddyfile antes de cada deploy
