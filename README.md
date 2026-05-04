# Rising Team Interview

**Interviewee:** Ashish Kedarisetti
**Interviewer:** Jeff

A small full-stack learning app. The user names a topic and skill level, an LLM generates a 4-lesson plan, each lesson runs as a 1:1 chat session with a tutor, and a 5-question quiz at the end gates the next lesson at 80%.

## Architecture

- **Frontend** (`/frontend`) — Next.js (App Router) + TypeScript + TailwindCSS. Renders onboarding, plan, lesson chat, and quiz views. Proxies `/api/*` to the backend so the Django origin is never exposed in the browser.
- **Backend** (`/backend`) — Django + Django REST Framework. Owns plan generation, lesson chat, quiz generate/score, and persistence.
- **LLM** — Anthropic Claude (`claude-haiku-4-5` by default) via the official Python SDK. All structured outputs (plan, quiz) use `client.messages.parse()` against Pydantic schemas.
- **Persistence** — A `LearningSession` row keyed by UUID stores `{name, topic, skill, plan, chat_history, active_quizzes (server-only), quiz_progress}`. The frontend stores only the UUID in localStorage; reload re-fetches the full session from the backend.

## Tech Stack

| Layer    | Technology                                                          |
| -------- | ------------------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript 5 (strict), Tailwind 3             |
| Backend  | Django 5.1, Django REST Framework 3.15, django-cors-headers         |
| LLM      | Anthropic Python SDK (`anthropic`), Pydantic 2                      |
| Tests    | Jest + React Testing Library, Django `TestCase`                     |
| Runtime  | Node 20+, Python 3.11+                                              |

## Project Structure

```
rising-team-interview/
├── backend/
│   ├── config/        Django project (settings, urls, wsgi, asgi)
│   ├── core/
│   │   ├── models.py          LearningSession (UUID, plan, chat, quizzes)
│   │   ├── views.py           Health, plan, session CRUD, lesson-chat, quiz
│   │   ├── middleware.py      Per-request structured logging
│   │   ├── services/
│   │   │   ├── plan_generator.py    LLM → Pydantic Plan (4 lessons)
│   │   │   ├── lesson_tutor.py      LLM tutor scoped to one lesson
│   │   │   └── quiz_generator.py    LLM → Pydantic Quiz (5 MCQs)
│   │   └── tests.py
│   ├── manage.py
│   ├── requirements.txt
│   ├── Procfile               Heroku release+web
│   └── .python-version        Pin Python for Heroku/CI
└── frontend/
    ├── app/                   layout.tsx, page.tsx, globals.css, api/health
    ├── components/            OnboardingFlow, LessonChat, LessonQuiz, …
    ├── lib/                   api.ts (typed client), logger.ts, storage.ts
    ├── __tests__/             Jest suites
    └── next.config.ts         Rewrites /api/* → BACKEND_URL
```

## Setup

Run the backend and frontend in separate terminals.

### Prerequisites

- Python 3.11+, Node 20+
- An **Anthropic API key** — create one at <https://console.anthropic.com/settings/keys>.

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env              # then edit: paste your ANTHROPIC_API_KEY
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

Frontend listens on `http://localhost:3000`. Open it in a browser.

## Configuration

| Variable                       | Scope    | Required | Default                                          |
| ------------------------------ | -------- | -------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`            | Backend  | **yes**  | —                                                |
| `ANTHROPIC_MODEL`              | Backend  | no       | `claude-haiku-4-5`                               |
| `BACKEND_URL`                  | Frontend | no       | `http://localhost:8000`                          |
| `DJANGO_DEBUG`                 | Backend  | no       | `1` (dev). Set to `0` in production.             |
| `DJANGO_SECRET_KEY`            | Backend  | prod     | dev placeholder (rotate for production)          |
| `DJANGO_ALLOWED_HOSTS`         | Backend  | no       | `localhost,127.0.0.1`                            |
| `DJANGO_CORS_ALLOWED_ORIGINS`  | Backend  | no       | `http://localhost:3000,http://127.0.0.1:3000`    |
| `DJANGO_LOG_LEVEL`             | Backend  | no       | `INFO`                                           |
| `DATABASE_URL`                 | Backend  | prod     | falls back to `sqlite:///db.sqlite3`             |

## API

All endpoints are proxied through the Next dev server, so the browser only sees same-origin paths.

| Method | Path                                                  | Purpose                                                        |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/health`                                         | Liveness probe                                                 |
| POST   | `/api/generate-plan`                                  | Create a session + 4-lesson plan from `{name, topic, skill}`   |
| GET    | `/api/sessions/<uuid>`                                | Hydrate a saved session (plan + chat + quiz progress)          |
| DELETE | `/api/sessions/<uuid>`                                | Wipe a session (used by "Start over")                          |
| POST   | `/api/sessions/<uuid>/lesson-chat`                    | Append a turn to a lesson's chat; returns full history         |
| POST   | `/api/sessions/<uuid>/lesson-quiz/generate`           | Generate a fresh 5-question quiz (answers stored server-side)  |
| POST   | `/api/sessions/<uuid>/lesson-quiz/score`              | Score the user's answers; returns score + per-Q explanations   |

Quiz answers (`correct_index`, `explanation`) are stored on the `LearningSession` row but **stripped from the public response** — the client never sees them until after submission.

## Testing

```bash
# Frontend
cd frontend && npm run test

# Backend
cd backend && source venv/bin/activate && python manage.py test
```

## Production Build

### Local production-style run

```bash
# Frontend
cd frontend && npm run build && npm start

# Backend
cd backend && source venv/bin/activate
DJANGO_DEBUG=0 \
DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  gunicorn config.wsgi:application --bind 0.0.0.0:8000
```

### Deploy free (Vercel + Render + Neon)

| Service | What it hosts | Plan | Notes                                                |
| ------- | ------------- | ---- | ---------------------------------------------------- |
| Vercel  | Next.js frontend | Hobby (free) | Best fit for Next; no card required          |
| Render  | Django backend   | Free (web service) | Sleeps after 15 min idle; cold start ~30-60s |
| Neon    | Postgres         | Free (3 GB)        | Serverless Postgres; no card required        |

The repo is pre-configured: [`render.yaml`](./render.yaml) is a Render Blueprint, [`backend/Procfile`](./backend/Procfile) runs `release: migrate` then `web: gunicorn`, and `settings.py` auto-trusts `RENDER_EXTERNAL_HOSTNAME`. Frontend ships with `frontend/Procfile` and a `start` script that honors `$PORT`.

#### 1. Postgres on Neon (free)

1. Sign up at <https://neon.tech> with GitHub.
2. Create a new project. Region close to where Render runs (Oregon if you keep the default).
3. Copy the **pooled connection string** (it ends with `?sslmode=require`).

#### 2. Backend on Render (free)

1. Sign up at <https://render.com> with GitHub.
2. Click **New +** → **Blueprint** → connect this repo. Render reads `render.yaml` and provisions the web service.
3. Once provisioned, open the service → **Environment** and fill in the three secrets `render.yaml` left blank:
   - `ANTHROPIC_API_KEY` — paste from <https://console.anthropic.com/settings/keys>.
   - `DATABASE_URL` — paste the Neon pooled connection string.
   - `DJANGO_CORS_ALLOWED_ORIGINS` — your Vercel URL (set after step 3 below; come back and update).
4. Render auto-deploys. First deploy takes 2-4 minutes.
5. Verify: `curl https://<your-service>.onrender.com/api/health` → `{"status":"ok",...}`.

#### 3. Frontend on Vercel (free)

1. Sign up at <https://vercel.com> with GitHub.
2. **Add New** → **Project** → import this repo.
3. **Root Directory**: `frontend`. Framework auto-detects as Next.js.
4. Add a single environment variable:
   - `BACKEND_URL` = `https://<your-render-service>.onrender.com`
5. Click **Deploy**. First deploy takes ~1 minute.
6. Copy the assigned `*.vercel.app` URL — paste it back into Render's `DJANGO_CORS_ALLOWED_ORIGINS` (step 2.3). Render redeploys automatically.

That's it. Total cost: $0/mo. Cold-start delay on Render hits the first request after 15 min of idle.

#### Optional: Heroku (paid)

If you want no cold starts, deploy to Heroku instead — the same `Procfile` and `settings.py` work. Roughly $15/mo (Eco dyno × 2 + Mini Postgres). Free tier was discontinued in November 2022.

## Phases

The app was built in three self-contained phases.

| Phase | What it shipped                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| **1** | 3-question onboarding · Claude-generated 4-lesson plan · session persistence by UUID · "Start over" wipes server + client |
| **2** | Click a lesson → 1:1 tutor chat scoped to that lesson · per-lesson chat history persisted · "I'm done — quiz me" handoff |
| **3** | 5-question MCQ quiz per lesson · ≥80% to pass · pass/fail gating with locks on subsequent lessons · fresh questions on retake |

## Logging Reference

**Frontend** (browser DevTools console):
- `HomePage mounted`, `OnboardingFlow mounted { hydrated }`
- `api: generatePlan / fetchSession / sendLessonMessage / generateLessonQuiz / submitLessonQuiz` lifecycle lines

**Backend** (terminal stdout):
- Per-request: `core.middleware: METHOD PATH -> STATUS (Xms)`
- Plan: `plan generated: lessons=4 total_hours=… tokens(input=… output=…)`
- Chat: `lesson_chat ok: session=… reply_len=… tokens(…)`
- Quiz: `quiz generated: questions=5 …` and `quiz scored: score=…% (…/…) passed=…`

## License

[MIT](./LICENSE) © 2026 Ashish Kedarisetti
