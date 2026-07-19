# Public form frontend integration

This guide documents how the separate static app (`r-m-public-form`) talks to this backend.

## Link shape

Use a **generic** public URL with **no** staff/duty query params, for example:

`https://forms.example.com/`

Staff type and duty type are chosen on the page, then the UI calls:

`GET /api/public/forms/current?staffType=ALP&dutyType=SIGN_ON`

## Identity and user creation

| Field | Rules |
|-------|-------|
| `user_id` | Required, 1–100 chars. Backend trims + `toUpperCase()`. |
| `name` | Required, 2–150 chars. |
| `mobile` | Required, 7–20 chars after removing spaces/`()`/`-`. Digits with optional leading `+`. |

If `users.user_id` does not exist:

1. Create active `USER`
2. Password hash of `12345678` (accepted security risk for this phase)
3. Email like `public-<uuid>@public-form.invalid`
4. `account_origin = PUBLIC_FORM`

If it exists:

- `REGISTERED`: reuse as-is (do not overwrite password/email/name)
- `PUBLIC_FORM`: refresh name/mobile

## Field-type serialization

Answers are always strings in `answer_text`:

| `field_type` | Example `answer_text` |
|--------------|------------------------|
| TEXT / LONG_TEXT | free text |
| NUMBER | `12.5` |
| DATE | `2026-07-19` |
| TIME | `09:30` or `09:30:00` |
| DATETIME | `2026-07-19T09:30` |
| YES_NO | `Yes` / `No` |
| DROPDOWN | exact option string |
| SIGNATURE | data URL (`data:image/png;base64,...`) |

## Errors

| HTTP | Meaning |
|------|---------|
| 400 | Validation / required answers / oversized answer |
| 404 | No active form for staff/duty |
| 409 | Already submitted today for that staff/duty (`ALREADY_SUBMITTED_TODAY`) |
| 413 | JSON body too large |
| 429 | Rate limited |
| 500 | Unexpected server error |

## Idempotency

Generate one UUID per submit attempt and reuse it on network retries. A matching `idempotency_key` returns `200` with `idempotent_replay: true` instead of creating a second row.

## Security notes

- Endpoints are public and rate-limited (`express-rate-limit`).
- Common password `12345678` must be changed before production hardening.
- Do not log mobile numbers or answer text.
- Filter public-created users in admin via `GET /api/users?account_origin=PUBLIC_FORM`.
