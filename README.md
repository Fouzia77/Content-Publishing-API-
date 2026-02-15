# CMS Backend API

A production-ready Content Management System API with JWT authentication, content versioning, scheduled publishing via a background worker, full-text search, and Redis caching. The application is fully containerized with Docker and can be run with a single `docker-compose up` command.

---

## Table of Contents

- [Features](#features)
- [Architecture & Design](#architecture--design)
- [Prerequisites](#prerequisites)
- [Setup and Running (Docker Compose)](#setup-and-running-docker-compose)
- [Running Without Docker](#running-without-docker)
- [API Documentation (OpenAPI / Swagger)](#api-documentation-openapi--swagger)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Caching and Worker](#caching-and-worker)
- [Testing](#testing)
- [Submission Commands](#submission-commands)
- [License](#license)

---

## Features

- **JWT authentication** — Two roles: author (authenticated) and public (unauthenticated). Authors manage their own posts; public can only read published content.
- **Content lifecycle** — Posts support three statuses: `draft`, `scheduled`, and `published`. Endpoints to publish immediately or schedule for a future date/time.
- **Content versioning** — Every update to a post’s title or content creates a revision (snapshot, author, timestamp). Authors can retrieve full version history.
- **Scheduled publishing** — A background worker runs every 60 seconds, finds posts with `scheduled_for` in the past, and transactionally publishes them. Idempotent and fault-tolerant.
- **Media upload** — Authors can upload images; the API returns a URL for embedding in posts.
- **Full-text search** — Public endpoint to search title and content of published posts (PostgreSQL `tsvector`/GIN).
- **Caching** — Redis caches published post list and single-post responses; cache is invalidated on updates, deletes, and publish.
- **Pagination** — All list endpoints support `page` and `limit` query parameters.
- **Transactional integrity** — Multi-table operations (e.g. update post + create revision, worker publish) use database transactions.

---

## Architecture & Design

- **API server** — Node.js/Express; stateless; JWT in `Authorization: Bearer <token>`; author middleware ensures users only modify their own posts.
- **Worker** — Separate Node.js process using Bull (Redis-backed queue); repeat job every 60s to publish due scheduled posts; uses the same PostgreSQL and Redis as the API.
- **PostgreSQL** — Stores users, posts, and post_revisions; indexes on foreign keys, status, scheduled_for, published_at; GIN index for full-text search.
- **Redis** — Cache for published reads; Bull job queue for the worker.
- **Containers** — Four services: `api`, `worker`, `db`, `redis`. API and worker depend on healthy `db` and `redis`.

For a **detailed architecture diagram**, component descriptions, and data flows, see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Prerequisites

- **Docker** and **Docker Compose** (for the recommended setup).
- Alternatively: Node.js 18+, PostgreSQL, Redis (for local run).

---

## Setup and Running (Docker Compose)

The application is containerized. You can set up and run everything (API, worker, database, cache) with Docker Compose.

### Step 1: Clone or open the repository

```bash
cd /path/to/API-with-Scheduled-Jobs
```

### Step 2: Build and start all services

```bash
docker-compose up -d --build
```

This will:

1. Build the **API** and **worker** images from the Dockerfiles.
2. Start **PostgreSQL** and apply the schema from `src/db/init.sql` on first run.
3. Start **Redis**.
4. Start the **API** (after db and redis are healthy) on port **3000**.
5. Start the **worker** (after db and redis are healthy).

No manual database migrations or seed steps are required. On first request, the API seeds a default author if none exists.

### Step 3: Verify

- **Health:** [http://localhost:3000/health](http://localhost:3000/health) — should return `{"status":"ok"}`.
- **API docs (Swagger UI):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **Default author:** `author@example.com` / `password123` (use in POST /auth/login).

### Step 4: Run in foreground (optional)

To see logs from all services in one terminal:

```bash
docker-compose up
```

Press `Ctrl+C` to stop.

### Stopping

```bash
docker-compose down
```

Data in PostgreSQL and Redis is stored in Docker volumes and persists between restarts.

---

## Running Without Docker

1. Install **Node.js 18+**, **PostgreSQL**, and **Redis**.
2. Create a database and set environment variables (see `.env.example`):
   - `DATABASE_URL` — e.g. `postgresql://user:password@localhost:5432/cms_db`
   - `REDIS_URL` — e.g. `redis://localhost:6379`
   - `JWT_SECRET`, optional `PORT`, etc.
3. Apply the schema (run `src/db/init.sql` against your database, e.g. via `psql` or a migrate script).
4. Optionally seed a user: `npm run seed`
5. Start the API: `npm start`
6. In a **separate terminal**, start the worker: `npm run worker`

---

## API Documentation (OpenAPI / Swagger)

- **Swagger UI (interactive):** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)  
  Use this to explore and try endpoints. For author endpoints, log in via POST /auth/login and use “Authorize” with `Bearer <token>`.

- **OpenAPI spec (JSON):** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

- **OpenAPI spec (source):** [openapi.yaml](./openapi.yaml) in the repository root.

---

## API Reference

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/login | Log in with `email` and `password`. Returns `token` and `user` (id, username, role). Use `Authorization: Bearer <token>` for author endpoints. |

### Author-only (require `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | /posts | Create draft. Body: `{ "title", "content?" }`. Slug is auto-generated and unique. |
| GET | /posts | List author’s posts. Query: `page`, `limit`. |
| GET | /posts/:id | Get one post (own only). |
| PUT | /posts/:id | Update post (title/content). Creates revision. Own only. |
| DELETE | /posts/:id | Delete post. Own only. |
| POST | /posts/:id/publish | Publish draft immediately (sets published_at). |
| POST | /posts/:id/schedule | Schedule draft. Body: `{ "scheduled_for": "ISO8601" }` (future). |
| GET | /posts/:id/revisions | Version history (revision_id, title_snapshot, content_snapshot, revision_author, revision_timestamp). |
| POST | /media/upload | Upload image (multipart `file`). Returns `{ "url", "filename" }`. |

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check. Returns `{ "status": "ok" }`. |
| GET | /posts/published | List published posts. Query: `page`, `limit`. |
| GET | /posts/published/:id | Get one published post. |
| GET | /search?q=... | Full-text search on published posts. Query: `q`, `page`, `limit`. |

---

## Database Schema

- **users** — id, username, email (unique), password_hash, role (author | public), created_at, updated_at
- **posts** — id, title, slug (unique), content, status (draft | scheduled | published), author_id, scheduled_for, published_at, created_at, updated_at, search_vector (tsvector)
- **post_revisions** — id, post_id, title_snapshot, content_snapshot, revision_author_id, revision_timestamp

Indexes: users(email, role); posts(author_id, status, scheduled_for, published_at); GIN(search_vector); post_revisions(post_id, revision_timestamp).

---

## Caching and Worker

- **Cache:** Published post by ID and published list (by page/limit) are cached in Redis (TTL 5 min / 1 min). Cache is invalidated when a published post is updated or deleted, or when a post is published.
- **Worker:** Runs every 60 seconds; selects posts with `status = 'scheduled'` and `scheduled_for <= NOW()`; for each, in a transaction sets `status = 'published'` and `published_at = NOW()`. Idempotent.

---

## Testing

### With Docker (recommended)

From the repository root, with Docker running:

```bash
docker-compose run --rm -v "${PWD}:/app" \
  -e DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db \
  -e REDIS_URL=redis://redis:6379 -e NODE_ENV=test api \
  sh -c "npm install && npx jest --forceExit --detectOpenHandles --runInBand"
```

**Windows (PowerShell):**

```powershell
docker-compose run --rm -v "${PWD}:/app" -e DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db -e REDIS_URL=redis://redis:6379 -e NODE_ENV=test api sh -c "npm install && npx jest --forceExit --detectOpenHandles --runInBand"
```

Tests cover: auth, post CRUD, publish/schedule, revisions, public endpoints, search, media upload, and the scheduled-publish worker (idempotency).

### Locally

Set `NODE_ENV=test` and `DATABASE_URL` (and optionally `REDIS_URL`) to your test database. Ensure the schema is applied. Then:

```bash
npm run test
# Windows
npm run test:win
```

---

## Submission Commands

The repository includes a **submission.yml** file in the root that defines the standard commands for setup, tests, and starting the application (including the background worker). Use it as follows:

| Action | Command |
|--------|--------|
| **Setup** | `docker-compose up -d --build` |
| **Run tests** | `docker-compose run --rm -v "${PWD}:/app" -e DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db -e REDIS_URL=redis://redis:6379 -e NODE_ENV=test api sh -c "npx jest --forceExit --detectOpenHandles --runInBand"` |
| **Start app (API + worker)** | `docker-compose up -d` |
| **Start in foreground** | `docker-compose up` |

See **[submission.yml](./submission.yml)** for the exact commands and descriptions.

---

## License

MIT
