# Railway Monitoring Backend - Step-by-Step Project Guide

This document explains the project end-to-end in practical steps, with examples, and includes a full Swagger testing flow.

## 1) What This Project Is

This is a Node.js + Express backend for railway monitoring operations.  
It combines:

- REST APIs (auth, users, forms, divisions, lobbies, devices, health, analytics)
- Socket.IO for real-time signaling/events
- PostgreSQL via Sequelize ORM
- Swagger UI for API testing

Main entry file: `src/server.js`.

---

## 2) High-Level Architecture

### Backend Layers

1. **Routing Layer**
   - Route files map HTTP paths to controller methods.
   - Examples: `src/modules/forms/forms.routes.js`, `src/modules/users/users.routes.js`.

2. **Controller/Service Layer**
   - Controllers validate requests and orchestrate model/service calls.
   - Example: `src/modules/forms/forms.controller.js`.

3. **Data Layer**
   - Sequelize models represent tables and relationships.
   - Model links are initialized in `src/models/index.js`.

4. **Real-time Layer**
   - Socket auth + event handlers in `src/socket/index.js` and `src/auth/auth.middleware.js` (socket side).

---

## 3) Startup Flow (What Happens When You Run Server)

When you run `npm start`:

1. `src/server.js` loads env and initializes Express.
2. CORS is configured (`CORS_ORIGIN` / `CORS_ORIGINS`).
3. DB models are initialized (`initModels()`).
4. DB connection is tested (`sequelize.authenticate()`).
5. DB schema sync runs (`sequelize.sync({ alter: true })`).
6. Seed scripts run:
   - `seedAdmin()` -> creates default users if missing.
   - `seedRoleDutyTemplates()` -> creates starter form templates for staff/duty combinations.
7. Routes are mounted under `/api/...`.
8. Swagger UI is exposed at `/api-docs`.
9. Socket.IO server starts with auth middleware.
10. Health scheduler starts for device monitoring.

Useful URLs after startup:

- Health: `GET /health`
- Swagger: `GET /api-docs`

---

## 4) Core Modules and Their Purpose

## Auth (`/api/auth`)

- Login with DB user: `POST /api/auth/login`
- Public signup (creates USER role): `POST /api/auth/signup`
- Device token for kiosk/monitor clients: `POST /api/auth/device-token`

JWT token includes claims like:
- `id`, `role`, `division_id`, `user_id`, etc.

## Users (`/api/users`)

- Admin: create/list/get/update/deactivate users
- Any authenticated user: `GET/PATCH /api/users/me`
- Avatar and face enrollment APIs

RBAC is enforced using:
- `requireAuth`
- `requireDivisionAdmin`
- `requireUser`
- `requireMonitor`

## Forms (`/api/forms`)

- Admin creates templates and questions.
- Admin publishes one template per staff+duty combination.
- USER fetches "today form" by context (`staffType`, `dutyType`) and submits answers.
- Analytics endpoints for admin/user submission history.

## Health + Analytics

- Health module exposes operational snapshot and recovery actions.
- Analytics module gives SLA/incidents/autoheal and aggregated views.

## Real-Time (Socket.IO)

Used for WebRTC signaling, monitoring sessions, crew events, heartbeats, and device-command coordination. The server does not process video; it relays signaling and broadcasts events.

For a full walkthrough of how connections and events work today, see **section 14** below.

Important note: Swagger tests HTTP APIs only, not socket events.

---

## 5) Data Model Overview (Simplified)

From `src/models/index.js`, key entities include:

- `User` (roles, profile, division mapping)
- `Division` -> has many `Lobby`
- `Lobby` -> has many `Device`
- `Form` -> has many `Question`
- `Submission` -> has many `Answer`
- `MonitoringSession`, `SocketPresence`, `DeviceLog`, `DeviceHealthSnapshot`, etc.

Typical relational path for operations:

`Division -> Lobby -> Device`  
`User -> Submission -> Answer -> Question`

---

## 6) Environment Variables You Usually Need

Database:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL` (optional, `"true"` for SSL)

App/Auth:

- `PORT` (default 3000)
- `JWT_SECRET`
- `DEVICE_TOKEN_SECRET`
- `CORS_ORIGIN` or `CORS_ORIGINS`

Optional AWS for avatar/face:

- S3 and Rekognition related env vars (required only for avatar/face features).

---

## 7) Local Run and Test Commands

Install and run:

```bash
npm install
npm start
```

Dev mode with reload:

```bash
npm run dev
```

Tests:

```bash
npm test
npm run test:parallel
npm run test:live-smoke
```

---

## 8) Practical API Example (Without Swagger UI)

### 8.1 Login as admin

`POST /api/auth/login`

```json
{
  "user_id": "admin",
  "password": "admin123"
}
```

Returns `accessToken`.

### 8.2 Create a user (admin token required)

`POST /api/users`

```json
{
  "user_id": "crew_1001",
  "name": "Crew Demo",
  "password": "secret123",
  "email": "crew1001@example.com"
}
```

### 8.3 Login as created user

`POST /api/auth/login`

```json
{
  "user_id": "crew_1001",
  "password": "secret123"
}
```

### 8.4 Get today's questions

`GET /api/forms/today?staffType=ALP&dutyType=SIGN_IN`

### 8.5 Submit today's answers

`POST /api/forms/submissions/today`

```json
{
  "staffType": "ALP",
  "dutyType": "SIGN_IN",
  "answers": [
    {
      "question_id": "PUT_QUESTION_UUID_HERE",
      "answer_text": "All checks completed"
    }
  ]
}
```

---

## 9) Full Swagger Testing Flow (Step-by-Step)

If you want to test the complete HTTP flow from Swagger:

### Step 0: Start server

Run:

```bash
npm start
```

Open:

`http://localhost:3000/api-docs`

### Step 1: Login as seeded admin

Use endpoint: `POST /api/auth/login`

Body:

```json
{
  "user_id": "admin",
  "password": "admin123"
}
```

Copy `accessToken` from response.

### Step 2: Authorize Swagger

In Swagger UI:

1. Click **Authorize**
2. Enter: `Bearer <accessToken>`
3. Click **Authorize**

Now all secured endpoints can be tested with this token.

### Step 3: Prepare forms (admin flow)

1. `POST /api/forms/templates`  
   Example body:
   ```json
   {
     "title": "ALP Sign In Daily Form",
     "description": "Mandatory checks before duty",
     "staffType": "ALP",
     "dutyType": "SIGN_IN"
   }
   ```
   Save returned `templateId`.

2. `POST /api/forms/templates/{templateId}/questions`  
   Add at least 1 required question:
   ```json
   {
     "prompt": "Have you completed safety briefing?",
     "is_required": true,
     "sort_order": 0
   }
   ```
   Save returned `questionId`.

3. `PATCH /api/forms/templates/{id}/publish`  
   Publish the template so USER can fetch it via `/today`.

### Step 4: Create test user (admin flow)

Call `POST /api/users`:

```json
{
  "user_id": "crew_swagger_01",
  "name": "Swagger Crew",
  "password": "crewpass123",
  "email": "swaggercrew01@example.com"
}
```

### Step 5: Login as that USER

Call `POST /api/auth/login`:

```json
{
  "user_id": "crew_swagger_01",
  "password": "crewpass123"
}
```

Copy this USER `accessToken`.

Click **Authorize** again and replace token with USER token.

### Step 6: Fetch today's form as USER

Call:

`GET /api/forms/today?staffType=ALP&dutyType=SIGN_IN`

Expected:

- Active form details
- List of questions (copy `id` values)

### Step 7: Submit answers as USER

Call `POST /api/forms/submissions/today`:

```json
{
  "staffType": "ALP",
  "dutyType": "SIGN_IN",
  "answers": [
    {
      "question_id": "QUESTION_UUID_FROM_PREVIOUS_STEP",
      "answer_text": "Yes, briefing completed."
    }
  ]
}
```

Expected status: `201`.

### Step 8: Verify submission history

As USER token:

- `GET /api/forms/submissions/me/latest`
- `GET /api/forms/submissions/me`

As Admin token:

- `GET /api/forms/analytics/users`
- `GET /api/forms/analytics/users/{userId}/history`

---

## 10) Division, Lobby, Device Flow (Swagger End-to-End)

This section explains the infra hierarchy flow you asked for:

`Division -> Lobby -> Device`

Use this to test setup + operational endpoints in one sequence.

### Step 1: Login and authorize as admin

1. `POST /api/auth/login`
2. Copy `accessToken`
3. Swagger **Authorize** with `Bearer <accessToken>`

Note: `seedAdmin` creates `admin/admin123`, and that user has `SUPER_ADMIN` role.

### Step 2: Create division (super-admin endpoint)

Call `POST /api/divisions`

Example body (minimum practical payload):

```json
{
  "name": "North Control Division",
  "code": "NCD",
  "status": "ACTIVE"
}
```

Save `divisionId` from response.

### Step 3: Verify division exists

Call:

- `GET /api/divisions`
- `GET /api/divisions/{divisionId}`

### Step 4: Create lobby under that division

Call `POST /api/lobbies`

```json
{
  "division_id": "DIVISION_UUID_FROM_STEP_2",
  "name": "Lobby-A",
  "code": "LOB_A",
  "status": "ACTIVE"
}
```

Save `lobbyId` from response.

### Step 5: Verify lobby

Call:

- `GET /api/lobbies`
- `GET /api/lobbies/{lobbyId}`

### Step 6: Create device under division + lobby

Call `POST /api/devices`

```json
{
  "division_id": "DIVISION_UUID_FROM_STEP_2",
  "lobby_id": "LOBBY_UUID_FROM_STEP_4",
  "name": "Kiosk Device 01",
  "code": "KIOSK_01",
  "status": "ACTIVE"
}
```

Save `deviceId` from response.

### Step 7: Verify device

Call:

- `GET /api/devices`
- `GET /api/devices/{deviceId}`

### How this hierarchy ties to Socket.IO (division via lobbies for monitors)

The HTTP flow above creates **devices that always belong to a division and a lobby** (`division_id` + `lobby_id` on the device row). That matters for sockets:

- Socket.IO does **not** expose a dedicated “connect only to division” room. After auth, **MONITOR** sockets join the **`monitors`** room; **KIOSK** sockets join **`kiosks`** and, after `register-kiosk`, **`device:<kioskId>`** for targeted signaling.
- **Who may `start-monitoring` on a device** is decided in `src/socket/realtime.manager.js` (`validateMonitorLobbyAccess`) using that device’s **`division_id`** and **`lobby_id`**:
  - **`SUPER_ADMIN`**: can start monitoring on any device.
  - **`DIVISION_ADMIN`**: can start monitoring on any device in **their** division (same `division_id` as on the JWT). They are **not** required to have a per-lobby row; lobby still exists on the device for data model and reporting.
  - **`MONITOR`** (app user with `division_id` on the token): must have an active **`MonitorLobbyAccess`** row for **`user_id` + `division_id` + `lobby_id`** matching the **device’s lobby**. So for a normal monitor user, **division-level realtime access to devices is effectively enforced through lobbies** — they only pass authorization for devices in lobbies they are assigned to.
  - **Legacy MONITOR** JWT with **no** `division_id`: allowed for backward compatibility (see code comments there).
- On **`register-kiosk`** / **`register-monitor`**, pass **`lobby_id`** in the payload when you want **socket presence** (`SocketPresence`) to record which lobby that connection is associated with; **`division_id`** for presence comes from the JWT when using app login.

More detail is in **section 14.3.1** below.

### Step 8: Run health flow on this hierarchy

With the same admin/monitor-capable token, check:

- `GET /api/health/summary`
- `GET /api/health/divisions`
- `GET /api/health/lobbies/{lobbyId}`
- `GET /api/health/devices/{deviceId}/logs`

If recovery is needed, trigger:

- `POST /api/health/devices/{deviceId}/recover`

### Step 9: Run analytics flow on same data

Call:

- `GET /api/analytics/summary`
- `GET /api/analytics/sla`
- `GET /api/analytics/divisions`
- `GET /api/analytics/lobbies/{lobbyId}`
- `GET /api/analytics/devices/{deviceId}`
- `GET /api/analytics/incidents`
- `GET /api/analytics/autoheal`

### Step 10: Update and clean-up checks (optional)

Update hierarchy:

- `PATCH /api/divisions/{divisionId}`
- `PATCH /api/lobbies/{lobbyId}`
- `PATCH /api/devices/{deviceId}`

Delete child-first (safe order):

1. `DELETE /api/devices/{deviceId}`
2. `DELETE /api/lobbies/{lobbyId}`
3. (Division delete endpoint is not exposed in routes currently; update/inactivate instead)

---

## 11) Common Swagger Testing Issues and Fixes

1. **401 Unauthorized**
   - Token missing or invalid.
   - Re-run login and re-authorize with `Bearer <token>`.

2. **403 Forbidden**
   - Role mismatch (admin endpoint with USER token, or USER endpoint with admin-only restrictions).
   - Use correct role token.

3. **404 No active form**
   - Template exists but not published for that exact `staffType + dutyType`.
   - Publish the right template and retry.

4. **400 Validation error in submissions**
   - `question_id` invalid or not part of active template.
   - Required questions missing.
   - Ensure IDs come from `/api/forms/today` response.

5. **Face/avatar endpoints fail**
   - AWS S3/Rekognition env vars may not be configured.
   - Skip these endpoints if infra is not set up.

---

## 12) End-to-End Flow Summary (Quick View)

1. Admin logs in.
2. Admin creates division, lobby, and device hierarchy.
3. Admin verifies health and analytics for that hierarchy.
4. Admin creates template and questions.
5. Admin publishes template.
6. Admin creates crew user.
7. Crew user logs in.
8. Crew fetches today's form.
9. Crew submits answers.
10. Submission history and analytics are verified.

That is the clean full HTTP workflow via Swagger.

---

## 13) What Swagger Cannot Fully Test Here

Swagger can test REST APIs very well, but not interactive Socket.IO behavior (for example `register-kiosk`, `register-monitor`, `offer` / `answer` / `ice-candidate`, monitoring session lifecycle).  

See **section 14** for how sockets work. For hands-on socket testing, use a Socket.IO client (for example `socket.io-client` in a small script) or the project’s integration tests under `tests/`.

---

## 14) How Socket.IO Works (Current Implementation)

This matches the code in `src/server.js` (Socket.IO server + `authenticateSocket`), `src/auth/auth.middleware.js` (socket JWT handling), and `src/socket/index.js` (event handlers).

### 14.1 Connection and authentication

1. Every Socket.IO connection runs through **`authenticateSocket`** before `connection` handlers run.
2. The client must send a JWT in the handshake:
   - **`socket.handshake.auth.token`**, or
   - **`Authorization: Bearer <token>`** on the handshake headers.

3. **Two kinds of JWT are supported:**

   **A) Application JWT (from `POST /api/auth/login` or signup)**  
   After `jwt.verify`, the server looks at `decoded.id` or `decoded.userId` and `decoded.role` (normalized, including legacy `ADMIN` → `SUPER_ADMIN`):

   - If the app role is **`SUPER_ADMIN`**, **`DIVISION_ADMIN`**, or **`MONITOR`** → the socket is treated as **`MONITOR`** for event permissions (`socket.data.role = MONITOR`).
   - If the app role is **`USER`** → the socket is treated as **`KIOSK`** (`socket.data.role = KIOSK`).

   The **`clientId`** used for kiosk-style registration and compatibility is **`decoded.user_id` if present, otherwise the user id** (string). Additional context (`userId`, `division_id`, app `role`, etc.) is stored on `socket.data.user` for DB-backed features (presence, monitoring sessions).

   **B) Legacy device JWT (from `POST /api/auth/device-token` or `generateToken`)**  
   Payload must include **`role`** exactly `KIOSK` or `MONITOR` and **`clientId`**. That maps directly to `socket.data.role` and `socket.data.clientId`. No app user envelope is attached.

4. If the token is missing, invalid, or expired, the handshake fails with an authentication error and the client does not connect.

### 14.2 Right after `connection`

- **Rooms:** `MONITOR` sockets join room **`monitors`**; `KIOSK` sockets join **`kiosks`**. Kiosk sockets also join **`device:<kioskId>`** when they register (see below).
- **Duplicate kiosk (app USER):** If the same app user opens a second kiosk connection, the older socket gets **`forced-logout`**, kiosk state may transfer to the new socket, and the old connection is disconnected. **Multiple monitor connections are allowed** (each tracked by `socket.id`).
- **Infrastructure:** Heartbeat checking and realtime presence checking are started globally; session idle timeout is disabled (sessions end on explicit stop or disconnect).

### 14.3 Registration (who can emit what)

| Client emits | Allowed when | Main effect |
|--------------|--------------|-------------|
| **`register-kiosk`** | Socket role is **KIOSK**, and if using app JWT the app role must be **USER** (admins must not register as kiosk) | Registers kiosk in memory, joins `device:<kioskId>`, optional DB **socket presence** (`lobby_id` from payload if sent), broadcasts **`kiosk-online`** / **`device-online`** to **`monitors`**, ack **`kiosk-registered`**. `kioskId` defaults to `payload.deviceId` or `payload.kioskId` or `clientId`. |
| **`register-monitor`** | Socket role is **MONITOR** | Registers this monitor instance, optional presence, may **restore recent monitoring sessions** for that user, emits **`monitor-registered`** with **online kiosks** list. |

### 14.3.1 Division, lobby, and who may monitor (authoritative behavior)

Monitoring is always anchored on a **device** in the database. Each device has **`division_id`** and **`lobby_id`**. When a monitor emits **`start-monitoring`**, `startMonitoringSession` in `src/socket/realtime.manager.js` loads that device and runs **`validateMonitorLobbyAccess`**:

| App role on JWT | Division on JWT | Lobby row required? | Effect |
|-----------------|-----------------|---------------------|--------|
| **`SUPER_ADMIN`** | any | No | Always allowed to monitor the device. |
| **`DIVISION_ADMIN`** | must match device’s `division_id` | No | Allowed for any device in that division (division-wide for admins). |
| **`MONITOR`** | must match device’s `division_id` | **Yes** — active **`MonitorLobbyAccess`** for that user, division, and **the device’s `lobby_id`** | Regular monitors only reach devices in **lobbies they are assigned to**; that is how division scoping is enforced for them **via lobbies**. |
| **`MONITOR`** (legacy) | missing | N/A | Allowed (backward compatibility when token has no division). |

So your mental model is accurate for **app `MONITOR` users with a division**: they are not “connected to a division” as an abstract socket namespace; they connect with a normal socket, and **authorization to act on a device** is checked using **division + that device’s lobby** (through `MonitorLobbyAccess`). **`DIVISION_ADMIN`** and **`SUPER_ADMIN`** follow the rules above instead.

### 14.4 Monitoring sessions

- **`start-monitoring`** (MONITOR): requires **`deviceId`** or **`kioskId`**. Creates/attaches a monitoring session in the database and coordinates with kiosk state (see `startMonitoringSession` in `realtime.manager.js`).
- **`stop-monitoring`**, **`force-stop-monitoring`**, **`session-status`**: end or query session lifecycle (MONITOR / admin flows as implemented in `index.js`).

### 14.5 WebRTC signaling (view-only server)

The server **does not decode media**; it validates and **forwards** messages between peers:

- **`offer`**, **`answer`**, **`ice-candidate`**: routed using `targetId` / kiosk or device id resolution so the correct peer socket receives the payload.

### 14.6 Call flow (signaling)

Events such as **`call-request`**, **`call-accept`**, **`call-reject`**, **`call-end`**, plus **`toggle-video`** / **`toggle-audio`**, implement a structured call negotiation layer on top of raw WebRTC (still signaling-only from the server’s perspective).

### 14.7 Crew events

- **`crew-sign-on`** / **`crew-sign-off`**: validated payloads; broadcast to monitors (see `src/events/crew.events.js`). Kiosk identity is enforced server-side where applicable.

### 14.8 Heartbeat and device commands

- **`heartbeat-ping`** / **`heartbeat`**: keep-alive processing via `processHeartbeatPing` / heartbeat utilities.
- **`enqueue-device-command`**, **`fetch-device-command`**, **`complete-device-command`**: queue work for devices; **`realtime-metrics`** exposes metrics to authorized clients.

### 14.9 Disconnect

On **`disconnect`**, kiosk/monitor state is updated, sessions may end, presence may be marked offline, and rate limits / heartbeat state are cleaned up according to the handlers in `index.js`.

### 14.10 Minimal client example (conceptual)

```javascript
import { io } from 'socket.io-client';

// After POST /api/auth/login — use accessToken; USER maps to KIOSK on the socket.
const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
});

socket.on('connect', () => {
  socket.emit('register-kiosk', { deviceId: 'my-device-uuid', lobby_id: 'optional-lobby-uuid' });
});

socket.on('kiosk-registered', (data) => console.log(data));
socket.on('error', (err) => console.error(err.message));
```

For a **MONITOR** client, use a token whose app role is `MONITOR`, `DIVISION_ADMIN`, or `SUPER_ADMIN`, then emit **`register-monitor`** (and subsequently **`start-monitoring`**, etc.) as your UI requires.
