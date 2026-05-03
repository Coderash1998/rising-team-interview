# Rising Team Interview

**Interviewee:** Ashish Kedarisetti
**Interviewer:** Jeff

A small full-stack starter that mirrors keystrokes from a bottom input into a center display in real time, served by a Next.js frontend and a Django REST Framework backend.

## Architecture

- **Frontend** (`/frontend`) — Next.js (App Router) with TypeScript and TailwindCSS. Renders the mirror UI and proxies `/api/*` to the backend so the Django origin is never exposed to the browser.
- **Backend** (`/backend`) — Django + Django REST Framework. Exposes `GET /api/health` with structured request logging via custom middleware.

## Tech Stack

| Layer    | Technology                                                  |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript 5 (strict), Tailwind 3     |
| Backend  | Django 5.1, Django REST Framework 3.15, django-cors-headers |
| Tests    | Jest + React Testing Library, Django `TestCase`             |
| Runtime  | Node 20+, Python 3.11+                                      |

## Project Structure

```
rising-team-interview/
├── backend/
│   ├── config/        Django project (settings, urls, wsgi, asgi)
│   ├── core/          App: views, urls, middleware, tests
│   ├── manage.py
│   └── requirements.txt
└── frontend/
    ├── app/           App Router entry (layout, page, globals.css)
    ├── components/    UI components (MirrorDisplay, HealthBadge, TypingInput, GridBackground)
    ├── lib/           Utilities (api client, logger)
    ├── __tests__/     Jest test suites
    └── next.config.ts Rewrites /api/* → BACKEND_URL
```

## Setup

Run the backend and frontend in separate terminals.

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Backend listens on `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend listens on `http://localhost:3000`.

## Configuration

| Variable                       | Scope    | Default                                          |
| ------------------------------ | -------- | ------------------------------------------------ |
| `BACKEND_URL`                  | Frontend | `http://localhost:8000`                          |
| `DJANGO_DEBUG`                 | Backend  | `1`                                              |
| `DJANGO_SECRET_KEY`            | Backend  | dev placeholder (rotate for production)          |
| `DJANGO_ALLOWED_HOSTS`         | Backend  | `localhost,127.0.0.1`                            |
| `DJANGO_CORS_ALLOWED_ORIGINS`  | Backend  | `http://localhost:3000,http://127.0.0.1:3000`    |
| `DJANGO_LOG_LEVEL`             | Backend  | `INFO`                                           |

## Testing

```bash
# Frontend
cd frontend && npm run test

# Backend
cd backend && source venv/bin/activate && python manage.py test
```

## Production Build

```bash
# Frontend
cd frontend && npm run build && npm start

# Backend (use a real WSGI server in production)
cd backend
DJANGO_DEBUG=0 DJANGO_SECRET_KEY="<rotated>" \
  gunicorn config.wsgi:application --bind 0.0.0.0:8000
```

## License

[MIT](./LICENSE) © 2026 Ashish Kedarisetti
