# Interviewee: Ashish Kedarisetti

# Interviewer: Jeff

A production-ready Next.js + Django starter app. Type in the bottom input and watch the center text mirror your keystrokes in real time, framed by a black/green hacker aesthetic with shimmering glow.

---

## 1. Project Overview

- **Frontend** (`/frontend`) — Next.js 15 (App Router) + React 19 + TypeScript (strict) + TailwindCSS. Renders a fullscreen dark "terminal" UI with a real-time text mirror, shimmer/glow animation, blinking cursor, dot-grid background, health badge, and Cmd/Ctrl+K focus shortcut.
- **Backend** (`/backend`) — Django 5 + Django REST Framework. Exposes `GET /api/health/` and emits structured request logs through a custom middleware.
- **Proxy** — Next.js rewrites `/api/*` → `http://localhost:8000/api/*` so the browser never sees the Django origin (`BACKEND_URL` is server-side only).

---

## 2. Tech Stack

| Layer       | Technology                                                  |
| ----------- | ----------------------------------------------------------- |
| Frontend    | Next.js 15, React 19, TypeScript 5 (strict), Tailwind 3.4   |
| Testing FE  | Jest 29, @testing-library/react, @testing-library/jest-dom  |
| Backend     | Django 5.1, Django REST Framework 3.15, django-cors-headers |
| Testing BE  | Django `TestCase` (built-in)                                |
| Lang/Runtime | Node 20+, Python 3.11+                                     |

All versions are the latest stable as of writing.

---

## 3. Folder Structure

```
rising-team-interview/
├── README.md
├── LICENSE
├── .gitignore
├── claude.md
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── asgi.py
│   └── core/
│       ├── __init__.py
│       ├── apps.py
│       ├── views.py
│       ├── urls.py
│       ├── middleware.py
│       ├── tests.py
│       └── migrations/
│           └── __init__.py
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── postcss.config.mjs
    ├── jest.config.ts
    ├── jest.setup.ts
    ├── .eslintrc.json
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   └── api/health/route.ts
    ├── components/
    │   ├── GridBackground.tsx
    │   ├── HealthBadge.tsx
    │   ├── MirrorDisplay.tsx
    │   └── TypingInput.tsx
    ├── lib/
    │   ├── api.ts
    │   └── logger.ts
    └── __tests__/
        ├── MirrorDisplay.test.tsx
        ├── HealthBadge.test.tsx
        └── api.test.ts
```

---

## 4. Setup Instructions

> Open **two terminals** — one for the backend, one for the frontend. Backend must be running for the health badge to flip from "checking" to "Healthy ✅".

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Backend now serves on `http://localhost:8000`.

> On Windows PowerShell, replace `source venv/bin/activate` with `venv\Scripts\Activate.ps1`.

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend now serves on `http://localhost:3000`. Open it in a browser and start typing.

---

## 5. Environment Notes

- Backend runs on: `http://localhost:8000`
- Frontend runs on: `http://localhost:3000`
- Browser sees only `/api/...` (same-origin); the Django URL is hidden via `next.config.ts` rewrites.
- Override the backend target by exporting `BACKEND_URL` before `npm run dev` (e.g. `BACKEND_URL=http://localhost:9000 npm run dev`).
- Override Django defaults (dev only): `DJANGO_DEBUG`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS`, `DJANGO_LOG_LEVEL`.

---

## 6. Testing

### Frontend

```bash
cd frontend
npm run test
```

Covers `MirrorDisplay` rendering (empty + typed states), `HealthBadge` for all three states, and `fetchHealth` (success, failure, abort signal forwarding).

### Backend

```bash
cd backend
source venv/bin/activate
python manage.py test
```

Covers `/api/health/` status code, payload shape, URL reverse stability, and method allow-list.

---

## 7. Production Build

### Frontend

```bash
cd frontend
npm run build
npm start
```

### Backend

```bash
cd backend
source venv/bin/activate
DJANGO_DEBUG=0 DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  python manage.py runserver 0.0.0.0:8000
```

For real production, swap `runserver` for `gunicorn config.wsgi:application` behind a reverse proxy and set `DJANGO_ALLOWED_HOSTS` / `DJANGO_CORS_ALLOWED_ORIGINS` accordingly.

---

## 8. Features

- ✅ Fullscreen black/green hacker UI with dot-grid + scanline overlay
- ✅ Real-time per-keystroke mirroring (no debounce) — primary shimmer text + small mono preview
- ✅ Shimmer/pulse-glow animation on the main text (gradient sweep + drop-shadow pulse)
- ✅ Blinking terminal cursor on the main display
- ✅ `/api/health` proxied through Next rewrites — backend URL never reaches the browser
- ✅ Health badge: `API: Healthy ✅` / `API: Down ❌`
- ✅ "Synced" status indicator
- ✅ Cmd/Ctrl+K keyboard shortcut to refocus input (hint shown above input)
- ✅ AbortController on health requests cancels stale in-flight calls
- ✅ Console logging on mount, input change, API calls, and errors (frontend)
- ✅ Structured Python logging with per-request middleware + stacktraces (backend)

---

## 9. Logging Reference

**Frontend** (browser DevTools console):

- `HomePage mounted`, `TypingInput mounted; focused input`
- `TypingInput change` (length only, no PII)
- `api: fetchHealth start` / `api: fetchHealth ok` / `api: fetchHealth non-2xx`
- `health -> healthy` or `health -> down`

**Backend** (terminal stdout):

- `[2026-…] INFO core.middleware: GET /api/health/ -> 200 (1.2ms)`
- `[2026-…] INFO core.views: health check requested from 127.0.0.1`
- Unhandled exceptions logged with full stacktrace via `RequestLoggingMiddleware.process_exception`

---

## 10. Known Limitations

- SQLite is used by default for zero-setup; swap `DATABASES` in `backend/config/settings.py` for Postgres in production.
- The Next-side `/api/health/route.ts` exists only as a fallback; the rewrite supersedes it in normal operation.
- No auth — this is a starter scaffold; add DRF auth + permissions before exposing further endpoints.
- Tailwind v3.4 is used over v4 for Jest/PostCSS stability; upgrade once your toolchain is comfortable with v4's CSS-first config.

---

## License

[MIT](./LICENSE) © 2026 Ashish Kedarisetti
