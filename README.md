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
| 📧 Email | `jmalbarracinhc@gmail.com` |
| 🔑 Contraseña | `DR.Phuck42!` |

> ⚠️ Si no funciona el login, revisá que `.env` exista y tenga `ADMIN_EMAIL` y `ADMIN_PASSWORD_HASH` correctos.

---

## 📋 Qué hace

| Acción | Descripción |
|--------|-------------|
| ✏️ **Editar Caddyfile** | Modificás la config de Caddy (dominios, proxy, etc.) |
| 💾 **Guardar local** | Guarda en `config/Caddyfile` — solo en tu máquina |
| 🚀 **Desplegar a VM** | Sube el Caddyfile por SSH, copia a `/etc/caddy/` y recarga Caddy |

---

## ⚙️ Configuración (.env)

Copiá `.env.example` a `.env` y editá:

```
# Obligatorios para el login
ADMIN_EMAIL=jmalbarracinhc@gmail.com
ADMIN_PASSWORD_HASH=$2b$10$vIzNBE6ZpMlsiFKstsFCL.4mekOqbXMOAmksUcVcPHtDy9cYlJ5D2

# Obligatorio para que las sesiones no se rompan entre reinicios
SESSION_SECRET=inventá-cualquier-texto-largo-y-random

# Obligatorios para desplegar a la VM
OCI_HOST=137.131.152.248      # IP del servidor
OCI_USER=ubuntu
OCI_SSH_KEY_PATH=~/.ssh/id_ed25519   # Path a tu llave SSH privada
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

---

## 🏗️ Estructura del proyecto

```
oci-vm-manager/
├── config/
│   └── Caddyfile     ← Acá vive la config que editás
├── public/           ← HTML, CSS, JS del panel
├── index.js          ← Servidor
├── .env              ← TU config (no subir a git)
├── .env.example      ← Plantilla
└── README.md         ← Estás acá
```

---

## 🚨 Problemas frecuentes

| Síntoma | Solución |
|---------|----------|
| "Credenciales inválidas" | Verificá email y contraseña. El hash en `.env` debe ser el de `DR.Phuck42!` |
| "No hay Caddyfile local" | Hacé "Guardar local" antes de desplegar |
| "Configurar OCI_HOST y OCI_USER" | Completá esas variables en `.env` |
| Deploy falla con error SSH | La llave no tiene acceso al servidor. Probalo con `ssh -i ~/.ssh/id_ed25519 ubuntu@137.131.152.248` |
| Puerto 3080 ocupado | Cambiá `PORT=3081` (o el que quieras) en `.env` |

---

## 🔒 Seguridad

- **Rate limiting**: 5 intentos de login / 15 min; 5 deploys / min; 100 req / 15 min global
- **Helmet**: CSP, X-Frame-Options, etc.
- **Validación estricta**: dominios (hostname válido), puertos (1-65535)
- **Session**: regeneración en login, SameSite=Lax, httpOnly
- **XSS**: escape de HTML en el dashboard
- **Producción**: `SESSION_SECRET` obligatorio; `FORCE_SECURE_COOKIE=1` detrás de HTTPS

---

## 🚀 Deploy automático (GitHub Actions)

Cada merge a `main` despliega el manager y actualiza Caddy en el servidor.

**Secrets en GitHub** (Settings → Secrets → Actions):

| Secret | Descripción |
|--------|-------------|
| `SSH_PRIVATE_KEY` | Llave privada SSH para el servidor |
| `SERVER_IP` | IP del servidor (ej: 137.131.152.248) |

---

## 📌 Resumen

1. **Primera vez:** `cp .env.example .env` y editá lo necesario
2. **Arrancar:** `npm start`
3. **Usar:** login → editar Caddyfile → Guardar local → Desplegar a VM
4. **Cerrar sesión:** botón "Cerrar sesión" arriba a la derecha
