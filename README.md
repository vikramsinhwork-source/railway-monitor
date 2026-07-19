# Railway Monitoring (Kiosk–Monitor Backend)

Node.js **Express + Socket.IO** service for **WebRTC signaling**, **live monitoring sessions**, **device commands**, **crew presence events**, and **REST APIs** for users, divisions, lobbies, devices, forms, health, and analytics. The server is **view-only**: it does not terminate or process video; media flows peer-to-peer after signaling.

- **Interactive HTTP docs:** `GET /api-docs` (Swagger UI — title *Railway Monitoring API*).
- **Main entrypoint:** `src/server.js`.
- **Package name:** `kiosk-monitor-backend` (`package.json`).

---

## What is in this repository

Single backend package with four layers:

1. **HTTP API** — REST under `/api/*`. Wired in `src/server.js`; feature code in `src/modules/*` (routes, controllers, services, validators, Sequelize models).
2. **Real-time** — Socket.IO in `src/socket/index.js`, with DB-backed presence/sessions/commands in `src/socket/realtime.manager.js`. Socket JWT: `src/auth/auth.middleware.js` (`authenticateSocket`).
3. **Data** — **PostgreSQL** via **Sequelize** (`src/config/sequelize.js`), associations in `src/models/index.js`, migrations in `src/migrations/*.cjs`, seeders in `src/seeders/*.cjs`, CLI config `src/config/database.cjs` (requires `DB_*`).
4. **Cross-cutting** — HTTP JWT (`src/middleware/auth.middleware.js`), RBAC (`src/middleware/rbac.middleware.js`), division/lobby access (`src/middleware/division-access.middleware.js`), logging (`src/utils/logger.js`), rate limits (`src/utils/rate.limiter.js`), heartbeats (`src/utils/heartbeat.js`), API helpers (`src/utils/apiResponse.js`), socket errors (`src/errors/socket.error.js`, `src/errors/error.codes.js`).

**Note:** `src/auth/auth.routes.js` still contains an **in-memory** user map for legacy `POST /api/auth/register` and `GET /api/auth/users`. Primary login is **database-backed** via `src/modules/auth/auth.controller.js` (`POST /login`, `POST /signup`).

---

## Architecture (signaling and media)

- **Signaling only:** `offer`, `answer`, `ice-candidate` are forwarded; paths require an **active monitoring session** and correct kiosk/monitor pairing (`src/socket/index.js`).
- **crew-sign-on / crew-sign-off:** Validated and broadcast to the **`monitors`** room (`src/events/crew.events.js`).
- **Hardening:** In-memory registry in `src/state/*.state.js`; rate limits; heartbeat + DB presence; structured socket errors; audit integration where wired (`src/modules/audit/audit.service.js`).

---

## Tech stack (dependencies)

| Concern | Libraries |
|--------|-----------|
| Runtime | Node.js ESM (`"type": "module"`), Express |
| Real-time | `socket.io`, `socket.io-client` (dev/tests) |
| Auth | `jsonwebtoken`, `bcrypt` |
| Database | `sequelize`, `pg`, `sequelize-cli` |
| Docs | `swagger-jsdoc`, `swagger-ui-express` |
| Uploads | `multer` |
| AWS (optional) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-rekognition` |

---

## Code map

```
src/
├── server.js                 # Express, routes, Socket.IO, DB init, device health scheduler
├── config/
│   ├── sequelize.js          # Sequelize (Postgres, optional SSL via DB_SSL)
│   ├── database.cjs          # sequelize-cli
│   └── swagger.js            # OpenAPI + /api-docs
├── auth/
│   ├── auth.middleware.js    # Socket JWT (app users + legacy KIOSK/MONITOR)
│   └── auth.routes.js        # /api/auth/*
├── middleware/
│   ├── auth.middleware.js    # Bearer JWT: requireAuth, requireUser, requireAdmin
│   ├── rbac.middleware.js    # requireSuperAdmin, requireDivisionAdmin, requireMonitor
│   └── division-access.middleware.js
├── socket/
│   ├── index.js              # All Socket.IO handlers
│   └── realtime.manager.js   # Presence, sessions, commands, reconnect, metrics
├── state/                    # kiosks, monitors, sessions, user-sessions (in-memory)
├── events/crew.events.js
├── services/
│   ├── s3Avatar.js
│   ├── rekognitionFace.js
│   └── deviceHealth.scheduler.js
├── modules/
│   ├── auth/
│   ├── users/
│   ├── divisions/
│   ├── lobbies/
│   ├── devices/
│   ├── access/               # MonitorLobbyAccess
│   ├── forms/
│   ├── health/
│   ├── analytics/
│   ├── audit/
│   └── realtime/             # MonitoringSession, SocketPresence, DeviceCommand models
├── models/index.js
├── migrations/*.cjs
├── seeders/*.cjs
├── bootstrap/                # seedAdmin, seedRoleDutyTemplates
└── utils/
scripts/
└── live-monitor.js           # npm run monitor:live
tests/                        # node:test, e2e + unit
.github/workflows/
└── deploy-pm2.yml            # deploy on push to main
```

---

## Prerequisites

- **Node.js 18+**
- **PostgreSQL** and `DB_*` environment variables

---

## Install, run, and scripts

```bash
npm install
npm start              # node src/server.js
npm run dev            # node --watch src/server.js
npm test               # node --test --test-concurrency=1 tests
npm run test:parallel  # concurrent tests
npm run test:live-smoke # LIVE_SMOKE=1 — scripts against a live server
npm run monitor:live   # scripts/live-monitor.js
```

Default HTTP port: **3000** (`PORT`).

**Startup (`src/server.js`):** `sequelize.authenticate()`, **`sequelize.sync({ alter: true })`**, then `seedAdmin()` and `seedRoleDutyTemplates()` from `src/bootstrap/`, then `startDeviceHealthScheduler(io)`.

---

## Environment variables

| Area | Variables |
|------|-----------|
| Server | `PORT`, `CORS_ORIGIN` or `CORS_ORIGINS` (comma-separated; empty or `*` = allow any) |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; optional `DB_SSL=true` |
| Auth | `JWT_SECRET`, `DEVICE_TOKEN_SECRET` |
| RBAC | `RBAC_DRY_RUN=true` — log would-be 403s instead of denying (HTTP + division checks behave accordingly where implemented) |
| Logging | `DEBUG=true` |
| AWS (optional) | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REKOGNITION_COLLECTION_ID`, `PROFILE_IMAGE_PUBLIC_BASE_URL`, `PROFILE_IMAGE_PRESIGN_SECONDS` |

---

## Database: migrations and seeders

**CLI (uses `src/config/database.cjs`):**

```bash
npx sequelize-cli db:migrate
```

**Migration files (`src/migrations/`):**

- `20260331120000-add-role-duty-targeting-to-forms.cjs`
- `20260423100000-phase1-multidivision-architecture.cjs`
- `20260423120000-add-monitor-lobby-access.cjs`
- `20260423133000-add-audit-logs.cjs`
- `20260423134000-add-device-ops-fields.cjs`
- `20260423150000-add-realtime-monitoring-tables.cjs`
- `20260423162000-realtime-hardening-additions.cjs`
- `20260423174000-device-health-platform.cjs`

**Seeders (`src/seeders/`):**

- `20260423101000-seed-initial-divisions.cjs`
- `20260423123000-seed-phase2-rbac-test-users.cjs`
- `20260424120000-seed-e2e-operators-and-fixtures.cjs`

**Sequelize models:** Registered and associated in `src/models/index.js` — includes `User`, `UserFaceProfile`, `Division`, `Lobby`, `Device`, `MonitorLobbyAccess`, `AuditLog`, `MonitoringSession`, `SocketPresence`, `DeviceCommand`, `DeviceLog`, `DeviceHealthSnapshot`, and form models from `src/modules/forms/index.js`.

---

## HTTP authentication and RBAC

### JWT claims (application login / signup)

`POST /api/auth/login` and `POST /api/auth/signup` return an **`accessToken`** whose payload includes (among others) `id` / `userId`, `role`, `division_id`, `user_id`, `name`, `email` (`src/modules/auth/auth.controller.js` — `signAccessToken`).

Use that token as:

```http
Authorization: Bearer <accessToken>
```

### REST role helpers (`src/middleware/auth.middleware.js`, `src/middleware/rbac.middleware.js`)

| Middleware | Meaning |
|------------|---------|
| `requireAuth` | Valid Bearer JWT |
| `requireUser` | Role must be `USER` (kiosk app user) |
| `requireSuperAdmin` | `SUPER_ADMIN` (JWT role `ADMIN` is normalized to super-admin) |
| `requireDivisionAdmin` | `SUPER_ADMIN` or `DIVISION_ADMIN` |
| `requireMonitor` | `SUPER_ADMIN`, `DIVISION_ADMIN`, or `MONITOR` |

Set `RBAC_DRY_RUN=true` to log denials instead of returning 403 where dry-run is implemented.

---

## HTTP API — full route list

Base URL is server root (e.g. `http://localhost:3000`). All `/api/*` routes below expect **`Authorization: Bearer`** unless noted.

### Core and docs

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Liveness JSON (service name `kiosk-monitor-signaling-server`) |
| GET | `/api-docs` | Swagger UI |

### `/api/auth` (`src/auth/auth.routes.js` + `auth.controller`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | Public | Body: `user_id`, `password`. Returns `accessToken`, `role`, `user` |
| POST | `/api/auth/signup` | Public | Body: `user_id`, `name`, `password` (+ optional profile fields). Creates `USER`, returns token |
| POST | `/api/auth/device-token` | Shared secret | Body: `deviceId`, `role` (`KIOSK` \| `MONITOR`), `secret` (= `DEVICE_TOKEN_SECRET`). Returns legacy-shape JWT |
| POST | `/api/auth/register` | Public | Legacy in-memory registration |
| GET | `/api/auth/users` | Public | Lists in-memory legacy users (dev/debug) |

### `/api/users` (`src/modules/users/users.routes.js`)

| Method | Path | Middleware |
|--------|------|------------|
| POST | `/api/users` | requireAuth, requireDivisionAdmin |
| GET | `/api/users` | requireAuth, requireDivisionAdmin |
| GET | `/api/users/me` | requireAuth |
| PATCH | `/api/users/me` | requireAuth |
| POST | `/api/users/me/avatar` | requireAuth (multipart) |
| GET | `/api/users/me/face/status` | requireAuth, requireUser — JSON `data.enrolled`, `data.isActive`, `data.enrolledAt` |
| POST | `/api/users/me/face/enroll` | requireAuth, requireUser (multipart) — success body includes `data.faceId`, `data.confidence` |

### `/api/face` (`src/modules/face/face.routes.js`)

| Method | Path | Middleware |
|--------|------|------------|
| POST | `/api/face/recognize` | requireAuth, requireMonitor (multipart **image**; SearchFacesByImage + user lookup) |
| GET | `/api/users/:id` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/users/:id/deactivate` | requireAuth, requireDivisionAdmin |
| POST | `/api/users/:id/avatar` | requireAuth, requireDivisionAdmin (multipart) |
| PATCH | `/api/users/:id` | requireAuth, requireDivisionAdmin |

### `/api/divisions` (`src/modules/divisions/division.route.js`)

| Method | Path | Middleware |
|--------|------|------------|
| GET | `/api/divisions` | requireAuth, requireMonitor |
| GET | `/api/divisions/:id` | requireAuth, requireMonitor |
| POST | `/api/divisions` | requireAuth, requireSuperAdmin |
| PATCH | `/api/divisions/:id` | requireAuth, requireSuperAdmin |

### `/api/lobbies` (`src/modules/lobbies/lobby.route.js`)

| Method | Path | Middleware |
|--------|------|------------|
| GET | `/api/lobbies` | requireAuth, requireMonitor |
| GET | `/api/lobbies/:id` | requireAuth, requireMonitor |
| POST | `/api/lobbies` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/lobbies/:id` | requireAuth, requireDivisionAdmin |
| DELETE | `/api/lobbies/:id` | requireAuth, requireDivisionAdmin |

### `/api/devices` (`src/modules/devices/device.route.js`)

| Method | Path | Middleware |
|--------|------|------------|
| GET | `/api/devices` | requireAuth, requireMonitor |
| GET | `/api/devices/:id` | requireAuth, requireMonitor |
| POST | `/api/devices` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/devices/:id` | requireAuth, requireDivisionAdmin |
| DELETE | `/api/devices/:id` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/devices/:id/deactivate` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/devices/:id/reactivate` | requireAuth, requireDivisionAdmin |

### `/api/forms` (`src/modules/forms/forms.routes.js`)

| Method | Path | Middleware |
|--------|------|------------|
| POST | `/api/forms/templates` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/templates` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/forms/templates/:id/publish` | requireAuth, requireDivisionAdmin |
| POST | `/api/forms/templates/:templateId/questions` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/templates/:templateId/questions` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/forms/templates/:templateId/questions/:questionId` | requireAuth, requireDivisionAdmin |
| DELETE | `/api/forms/templates/:templateId/questions/:questionId` | requireAuth, requireDivisionAdmin |
| POST | `/api/forms/questions` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/questions` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/questions/:id` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/forms/questions/:id` | requireAuth, requireDivisionAdmin |
| DELETE | `/api/forms/questions/:id` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/analytics/summary` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/analytics/export/preview` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/analytics/export` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/analytics/users` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/analytics/users/:userId/history` | requireAuth, requireDivisionAdmin |
| GET | `/api/forms/today` | requireAuth, requireUser |
| POST | `/api/forms/submissions/today` | requireAuth, requireUser |
| GET | `/api/forms/submissions/me/latest` | requireAuth, requireUser |
| GET | `/api/forms/submissions/me` | requireAuth, requireUser |

### `/api/registers` (`src/modules/registers/register.routes.js`)

Dynamic admin registers mapped onto form questions. Crew still submits via `/api/forms`; admin reviews paper-book style views and exports here.

| Method | Path | Auth |
|---|---|---|
| POST | `/api/registers` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers/:id` | requireAuth, requireDivisionAdmin |
| PATCH | `/api/registers/:id` | requireAuth, requireDivisionAdmin |
| DELETE | `/api/registers/:id` | requireAuth, requireDivisionAdmin (deactivates) |
| GET | `/api/registers/:id/questions` | requireAuth, requireDivisionAdmin |
| PUT | `/api/registers/:id/questions` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers/:id/entries` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers/:id/analytics/summary` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers/:id/export/preview` | requireAuth, requireDivisionAdmin |
| GET | `/api/registers/:id/export` | requireAuth, requireDivisionAdmin |

Questions now support `field_type`, `options`, and stable `key` for cross-form register columns.

### `/api/health` (`src/modules/health/health.routes.js`)

| Method | Path | Middleware |
|--------|------|------------|
| GET | `/api/health/summary` | requireAuth, requireMonitor |
| GET | `/api/health/divisions` | requireAuth, requireMonitor |
| GET | `/api/health/lobbies/:id` | requireAuth, requireMonitor |
| GET | `/api/health/devices/:id/logs` | requireAuth, requireMonitor |
| POST | `/api/health/devices/:id/recover` | requireAuth, requireDivisionAdmin |

### `/api/analytics` (`src/modules/analytics/analytics.routes.js`)

| Method | Path | Middleware |
|--------|------|------------|
| GET | `/api/analytics/summary` | requireAuth, requireMonitor |
| GET | `/api/analytics/sla` | requireAuth, requireMonitor |
| GET | `/api/analytics/divisions` | requireAuth, requireDivisionAdmin |
| GET | `/api/analytics/lobbies/:id` | requireAuth, requireDivisionAdmin |
| GET | `/api/analytics/devices/:id` | requireAuth, requireDivisionAdmin |
| GET | `/api/analytics/incidents` | requireAuth, requireDivisionAdmin |
| GET | `/api/analytics/autoheal` | requireAuth, requireDivisionAdmin |

---

## REST examples

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "user_id": "operator1",
  "password": "secret"
}
```

Response shape:

```json
{
  "success": true,
  "accessToken": "eyJ...",
  "role": "MONITOR",
  "user": { }
}
```

### Device token (no user password)

```http
POST /api/auth/device-token
Content-Type: application/json

{
  "deviceId": "KIOSK_01",
  "role": "KIOSK",
  "secret": "<DEVICE_TOKEN_SECRET>"
}
```

```json
{
  "success": true,
  "token": "eyJ...",
  "user": {
    "clientId": "KIOSK_01",
    "role": "KIOSK",
    "name": "KIOSK_01"
  }
}
```

---

## Socket.IO authentication

Connect with a JWT:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: accessTokenOrLegacyToken }
});
```

Supported JWT shapes (`src/auth/auth.middleware.js`):

1. **Application user** — `id` or `userId` + `role`. Roles **`SUPER_ADMIN`**, **`DIVISION_ADMIN`**, **`MONITOR`** map to socket role **`MONITOR`**. Role **`USER`** maps to socket role **`KIOSK`**. Socket `clientId` is typically `user_id` / user id string from claims.
2. **Legacy device token** — `clientId` + **`role`** `KIOSK` or **`MONITOR`** only (from `generateToken` / `POST /api/auth/device-token`).

Kiosk registration (`register-kiosk`) additionally requires a logged-in app **`USER`** for sharing (admin socket roles are blocked from registering as kiosk).

---

## Socket.IO rooms

- **Monitors** join room `monitors`.
- **Kiosks** join room `kiosks` and **`device:<kioskId>`** (kiosk id may come from payload `deviceId` / `kioskId` or legacy `clientId`).

Broadcasts such as `crew-sign-on`, `kiosk-online`, many `session-status` updates, and monitor-only fanouts use **`io.to('monitors')`**. Device-scoped commands use **`io.to('device:<deviceId>')`**.

---

## Socket.IO events — client → server

| Event | Who | Purpose |
|-------|-----|---------|
| `register-kiosk` | KIOSK | Register device; optional payload `{ deviceId, kioskId, lobby_id }`. Updates DB presence when `userId` present |
| `register-monitor` | MONITOR | Register monitor; optional `{ lobby_id }`. May return `restoredSessions` for app users |
| `start-monitoring` | MONITOR | Start session. Body: `kioskId` or `deviceId`. UUID devices use DB session path; legacy ids use in-memory session |
| `stop-monitoring` | MONITOR | End monitoring for a kiosk/device |
| `force-stop-monitoring` | MONITOR | Force end (privileged stop) |
| `session-status` | Any | Query: `{ deviceId \| kioskId }` → echoed `session-status` |
| `enqueue-device-command` | MONITOR | `{ deviceId\|kioskId, command, payload? }` → queue + `device-command-available` to device room |
| `fetch-device-command` | KIOSK | Pull next command for `deviceId` / kiosk |
| `complete-device-command` | KIOSK | `{ queueId, success, errorMessage?, deviceId? }` → updates DB and emits `device-command-status` to monitors |
| `realtime-metrics` | — | Server replies with metrics + config |
| `offer` | KIOSK or MONITOR | WebRTC offer: `{ targetId, offer, kioskId? \| deviceId? }` |
| `answer` | KIOSK or MONITOR | WebRTC answer: `{ targetId, answer, ... }` |
| `ice-candidate` | KIOSK or MONITOR | `{ targetId, candidate, ... }` |
| `heartbeat-ping` \| `heartbeat` | Both | Keep-alive; server may `heartbeat-pong` |
| `crew-sign-on` | KIOSK | Payload must satisfy `validateCrewEventPayload` (see below) |
| `crew-sign-off` | KIOSK | Same validation |
| `call-request` | KIOSK or MONITOR | Invite peer; needs active session |
| `call-accept` | Peer | Accept invite |
| `call-reject` | Peer | Reject invite |
| `call-end` | Peer | Tear down call state |
| `toggle-video` | MONITOR | Forward control to kiosk |
| `toggle-audio` | MONITOR | Forward control to kiosk |

**Signaling prerequisites:** `offer` / `answer` / `ice-candidate` require an **active monitoring session** for the resolved kiosk/device, correct **session ownership**, kiosk↔monitor pairing, and are **rate limited** (`src/utils/rate.limiter.js`).

---

## Socket.IO events — server → client (selection)

| Event | When |
|-------|------|
| `kiosk-registered` | After successful `register-kiosk` |
| `kiosk-online` | Broadcast to monitors when kiosk registers |
| `device-online` | Device presence fanout |
| `monitor-registered` | After `register-monitor` (includes `onlineKiosks`, `restoredSessions`) |
| `monitoring-started` | Session started |
| `monitoring-stopped` | Session ended |
| `session-status` | Reply to query or broadcast on state changes |
| `session-ended` | e.g. kiosk disconnect ended session |
| `device-command-queued` | Ack to monitor |
| `device-command-available` | Notify kiosk room |
| `device-command` | Payload for kiosk |
| `device-command-status` | Command completion fanout |
| `realtime-metrics` | Metrics snapshot |
| `offer` / `answer` / `ice-candidate` | Forwarded signaling |
| `heartbeat-pong` | Heartbeat ack |
| `crew-sign-on` / `crew-sign-off` | Broadcast to **monitors** with `eventType` |
| `crew-sign-on-ack` / `crew-sign-off-ack` | To emitting kiosk |
| `call-request`, `call-request-sent`, … | Call flow |
| `call-accept-confirmed`, `call-reject-confirmed`, `call-end-confirmed`, … | Call flow |
| `video-toggle-confirmed`, `audio-toggle-confirmed` | Control ack |
| `kiosk-offline` | Kiosk disconnect cleanup |
| `error` | Structured error (see below) |

---

## Crew events — payload and broadcast

**Validation** (`src/events/crew.events.js`): `employeeId` (string), `name` (string), and `kioskId` (string) must be present on the **incoming** payload. The server **overwrites** `kioskId` on the broadcast with the emitting connection’s authenticated **`clientId`** for security.

**Emit (kiosk):**

```javascript
socket.emit('crew-sign-on', {
  employeeId: 'EMP001',
  name: 'Demo User',
  timestamp: new Date().toISOString(),
  kioskId: 'KIOSK_01' // must be present for validation; broadcast uses auth client id
});
```

**Broadcast to monitors:**

```javascript
// { employeeId, name, timestamp, kioskId, eventType: 'crew-sign-on' | 'crew-sign-off' }
socket.on('crew-sign-on', (data) => { /* ... */ });
```

**Ack to kiosk:**

```javascript
socket.on('crew-sign-on-ack', (data) => {
  // { employeeId, timestamp }
});
```

---

## WebRTC signaling examples

**Offer (monitor → kiosk or kiosk → monitor):**

```javascript
socket.emit('offer', {
  targetId: 'KIOSK_01',
  offer: offerObject,
  kioskId: 'KIOSK_01' // optional hint; server resolves session kiosk
});
socket.on('offer', (data) => {
  // { fromId, offer }
});
```

**Answer:**

```javascript
socket.emit('answer', { targetId: 'MONITOR_01', answer: answerObject });
socket.on('answer', (data) => {
  // { fromId, answer }
});
```

**ICE:**

```javascript
socket.emit('ice-candidate', { targetId: 'KIOSK_01', candidate: candidateObject });
socket.on('ice-candidate', (data) => {
  // { fromId, candidate }
});
```

---

## Socket error event

.validation failures and many failures emit:

```javascript
socket.on('error', (err) => {
  // { code, message, timestamp, ...optionalDetails }
});
```

`code` is one of `ERROR_CODES` in `src/errors/error.codes.js`:

`AUTH_REQUIRED`, `AUTH_INVALID_TOKEN`, `AUTH_INVALID_ROLE`, `AUTH_MISSING_CLIENT_ID`, `AUTH_TOKEN_EXPIRED`, `SESSION_NOT_AUTHORIZED`, `SESSION_ALREADY_EXISTS`, `SESSION_NOT_FOUND`, `SESSION_INVALID_PAIRING`, `SESSION_TIMEOUT`, `SESSION_KIOSK_OFFLINE`, `CLIENT_NOT_REGISTERED`, `CLIENT_ALREADY_REGISTERED`, `CLIENT_NOT_FOUND`, `SIGNALING_INVALID_TARGET`, `SIGNALING_NO_SESSION`, `SIGNALING_UNAUTHORIZED_SENDER`, `SIGNALING_INVALID_PAIRING`, `SIGNALING_MISSING_DATA`, `CREW_EVENT_INVALID_PAYLOAD`, `CREW_EVENT_RATE_LIMITED`, `CREW_EVENT_UNAUTHORIZED`, `RATE_LIMIT_EXCEEDED`, `CALL_INVALID_STATE`, `CALL_ALREADY_IN_PROGRESS`, `CALL_NOT_INITIATED`, `CALL_REQUEST_FAILED`, `INTERNAL_ERROR`, `INVALID_REQUEST`, `OPERATION_NOT_ALLOWED`.

---

## Example: connect after login (monitor)

```javascript
import io from 'socket.io-client';

const res = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: 'monitor_user', password: '...' }),
});
const { accessToken } = await res.json();

const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
});

socket.on('connect', () => {
  socket.emit('register-monitor', {});
});
socket.on('monitor-registered', (data) => console.log(data));
socket.on('error', console.error);
```

---

## Example: legacy device token (kiosk)

Use `token` from `POST /api/auth/device-token` in `auth.token` the same way; then `register-kiosk` with `{ deviceId: 'KIOSK_01' }` if ids must match your deployment.

---

## Tests

```bash
npm test
```

Suites under `tests/`: `auth`, `rbac`, `management` (divisions, lobbies, devices), `forms.lifecycle`, `realtime`, `health`, `analytics`, `audit`, `regression`, `users.*`, `live-smoke.test.js` (+ helpers in `tests/helpers/`).

---

## Deployment

**GitHub Actions:** `.github/workflows/deploy-pm2.yml` — on push to **`main`**, self-hosted runner runs `npm ci`, **`pm2 restart railway-monitoring --update-env`**, `pm2 save`, `pm2 status`. Align the PM2 process name and app directory on the host.

**Reverse proxy upload size:** If monitor clients get **HTTP 413** on `POST /api/face/recognize`, the request is usually rejected by **nginx** (default `client_max_body_size` is **1m**) or another proxy before Express runs. The API allows up to **5 MB** per image (`avatarUpload.middleware.js`). Raise nginx to at least **10m** — see `deploy/nginx-upload-limits.conf.example`, then `sudo nginx -t && sudo systemctl reload nginx`.

---

## Production considerations

1. **Secrets:** Strong `JWT_SECRET` and `DEVICE_TOKEN_SECRET`; never commit `.env`.
2. **CORS:** Set `CORS_ORIGIN` / `CORS_ORIGINS` explicitly for browser clients.
3. **`sync({ alter: true })`:** Convenient for iteration; for production many teams prefer migrations-only + controlled schema deploys.
4. **Scale-out:** Multiple Node instances need a **Redis adapter** (or similar) for Socket.IO room consistency; this codebase assumes a single logical realtime instance unless you add that.
5. **TLS:** Terminate HTTPS/WSS in front (reverse proxy or PaaS).
6. **Face recognize uploads:** Monitor clients should POST **multipart/form-data** with field name **`image`**, prefer **JPEG** face crops (not full-frame PNG), and keep dimensions around **640–1024 px** on the long edge so payloads stay well under proxy limits.
7. **Legacy routes:** Restrict or remove `GET /api/auth/users` and in-memory `register` in locked-down environments.

---

## License

ISC (see `package.json`).
