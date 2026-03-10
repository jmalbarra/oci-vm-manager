# 🖥️ OCI VM Manager

Panel web para administrar la VM compartida (Caddy, dominios, etc.). Requiere login.

---

## ⚡ Empezar en 3 pasos

```bash
cd oci-vm-manager
cp .env.example .env          # 👈 Obligatorio: crear tu .env
npm install
npm start
```

Abrí **http://localhost:3080** en el navegador.

---

## 🔐 Login

| Campo | Valor |
|-------|-------|
| 📧 Email | El configurado en `ADMIN_EMAIL` |
| 🔑 Contraseña | La que corresponde al hash en `ADMIN_PASSWORD_HASH` |

> ⚠️ Las credenciales se configuran en `.env`. No hay credenciales por defecto en el código.

---

## 📋 Qué hace

| Acción | Descripción |
|--------|-------------|
| ✏️ **Editar dominios** | Agregás/editás dominios con puerto y opción "Redirigir www" |
| 🔵 **Previsualizar** | Abre el dominio en una pestaña nueva |
| ✔️ **Verificar** | Comprueba si el dominio responde (luz verde/roja) |
| 🗑️ **Eliminar** | Borra un dominio (pide confirmar escribiendo el nombre) |
| 💾 **Guardar** | Persiste la config en `config/sites.json` y `config/Caddyfile` |
| 🚀 **Desplegar a VM** | Sube el Caddyfile por SSH, copia a `/etc/caddy/` y recarga Caddy |

---

## ⚙️ Configuración (.env)

Copiá `.env.example` a `.env` y editá:

```
# Obligatorios para el login (el hash se genera con la pass que elijas)
ADMIN_EMAIL=tu-email@ejemplo.com
ADMIN_PASSWORD_HASH=  # bcrypt hash. Generar con: node -e "console.log(require('bcryptjs').hashSync('tu-pass', 10))"

# Obligatorio para que las sesiones no se rompan entre reinicios
SESSION_SECRET=inventá-cualquier-texto-largo-y-random

# Obligatorios para desplegar a la VM
OCI_HOST=IP_DEL_SERVIDOR
OCI_USER=ubuntu
OCI_SSH_KEY_PATH=~/.ssh/id_ed25519

# Detrás de HTTPS (Caddy, nginx, etc.): activar para cookies Secure
FORCE_SECURE_COOKIE=1
```

### 🔑 SSH: dos opciones

**Opción A — Path a la llave (la más fácil)**  
Dejá `OCI_SSH_KEY_PATH` apuntando a tu archivo, ej: `~/.ssh/id_ed25519` o `~/.ssh/id_rsa`.

**Opción B — Contenido de la llave**  
Si preferís no usar path, agregá:
```
OCI_SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
... todo el contenido de la llave ...
-----END OPENSSH PRIVATE KEY-----
```
(En una sola línea con `\n` donde van los saltos, o probá pegar literal)

> ❌ **Error típico:** "Configurar OCI_SSH_KEY_PATH o OCI_SSH_PRIVATE_KEY"  
> → No encontró la llave. Revisá que el path sea correcto y que el archivo exista.

### Resumen: qué hay que configurar

| Dónde | Qué |
|-------|-----|
| **Servidor** (`/opt/oci-vm-manager/.env`) | `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY_PATH` (o `OCI_SSH_PRIVATE_KEY`). Si está detrás de HTTPS: `FORCE_SECURE_COOKIE=1` |
| **GitHub Actions** (Secrets) | `SSH_PRIVATE_KEY`, `SERVER_IP` |
| **Local** (para desarrollar) | `cp .env.example .env` → mismo esquema que servidor |

---

## 🏗️ Estructura del proyecto

```
oci-vm-manager/
├── config/
│   ├── sites.json    ← Config de dominios (generado)
│   └── Caddyfile    ← Generado desde sites.json
├── public/
│   ├── css/          ← Estilos
│   ├── js/           ← login.js, dashboard.js (CSP exige scripts externos)
│   ├── login.html
│   ├── dashboard.html
│   └── favicon.svg
├── index.js          ← Servidor Express
├── .env              ← TU config (no subir a git)
├── .env.example      ← Plantilla
└── README.md
```

---

## 🚨 Problemas frecuentes

| Síntoma | Solución |
|---------|----------|
| "Credenciales inválidas" | Verificá `ADMIN_EMAIL` y que `ADMIN_PASSWORD_HASH` sea el bcrypt de tu contraseña |
| No pasa nada al hacer clic en Entrar | Los scripts están en archivos externos (`/js/login.js`). Si falla la carga, verificá que no haya bloqueos (CSP, adblocker). |
| Login OK pero vuelve al login | Detrás de proxy HTTPS: agregá `FORCE_SECURE_COOKIE=1` y reiniciá `pm2 restart oci-vm-manager` |
| "No hay Caddyfile local" | Hacé "Guardar" antes de desplegar |
| "Configurar OCI_HOST y OCI_USER" | Completá esas variables en `.env` |
| Deploy falla con error SSH | La llave no tiene acceso al servidor. Probalo con `ssh -i TU_LLAVE ubuntu@TU_IP` |
| Puerto 3080 ocupado | Cambiá `PORT=3081` (o el que quieras) en `.env` |

---

## 🔒 Seguridad

- **Rate limiting**: 5 intentos de login / 15 min; 5 deploys / min; 30 verificaciones de dominio / min; 100 req / 15 min global
- **Helmet**: CSP (`script-src 'self'` — scripts solo desde archivos externos, no inline), X-Frame-Options, etc.
- **Trust proxy**: Activado para funcionar detrás de Caddy/reverse proxy
- **Validación estricta**: dominios (hostname válido), puertos (1-65535)
- **Session**: regeneración en login, SameSite=Lax, httpOnly, Secure cuando `FORCE_SECURE_COOKIE=1`
- **XSS**: escape de HTML en el dashboard
- **SSRF**: `/api/check-domain` bloquea localhost, IPs privadas, metadata (169.254.x), .local, .internal, IP decimal/hex (2130706433, 0x7f…); conexión fijada al IP resuelto (anti DNS rebinding)
- **CSRF**: peticiones POST/PUT/DELETE exigen header `X-Requested-With` (envío desde nuestro frontend)
- **Producción**: `SESSION_SECRET` obligatorio; `FORCE_SECURE_COOKIE=1` detrás de HTTPS

---

## 🚀 Deploy automático (GitHub Actions)

Cada merge a `main` despliega el manager al servidor. Workflow: `.github/workflows/deploy.yml`.

### Secrets en GitHub (Settings → Secrets and variables → Actions)

| Secret | Valor | Obligatorio |
|--------|-------|-------------|
| `SSH_PRIVATE_KEY` | Contenido completo de la llave privada SSH | Sí |
| `SERVER_IP` | IP del servidor (ej: `137.131.152.248`) | Sí |

### Si falla el push de archivos en `.github/workflows/`

GitHub exige el scope `workflow` para modificar workflows. Si el push rechaza:

```bash
gh auth refresh -s workflow
# Abrí la URL en el navegador, autorizá, y después:
git push origin tu-rama
```

---

## 📌 Resumen

1. **Primera vez:** `cp .env.example .env` y editá lo necesario
2. **Arrancar:** `npm start`
3. **Usar:** login → editar dominios → Guardar → Desplegar a VM
4. **Cerrar sesión:** botón "Cerrar sesión" arriba a la derecha

---

*Hecho por [jmalbarra](https://github.com/jmalbarra)*
