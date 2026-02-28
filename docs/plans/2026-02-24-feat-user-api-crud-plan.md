# User API CRUD & Attributes Plan

**Date:** 2026-02-24
**Type:** Feature
**Status:** Draft

## 1. Overview

Add three capabilities to the REST API (`/api/v1/users`):

1. **Identify/upsert** (`POST /api/v1/users/identify`) - Create or update a user by email, setting name and user attributes.
2. **Update** (`PATCH /api/v1/users/:principalId`) - Update an existing user's details and attributes.
3. **Return user attributes in GET responses** - Include parsed `user.metadata` as a typed `attributes` object in list and detail responses.

User attributes must be configured in **Settings > User Attributes** before they can be set via the API (same model as Featurebase). Unknown attribute keys are rejected.

### Inspiration

- **Featurebase**: `identify` call with email/userId + name + custom attributes (must be configured in settings first).
- **Refiner**: `POST /v1/identify-user` upserts by id+email with traits; `GET/DELETE /v1/contact(s)` for CRUD.

---

## 2. Endpoints Summary

| Endpoint                     | Method | Request Body                                            | Success Status             | Key Response Fields              |
| ---------------------------- | ------ | ------------------------------------------------------- | -------------------------- | -------------------------------- |
| `/api/v1/users`              | GET    | (query params)                                          | 200                        | `data[]` with `attributes` added |
| `/api/v1/users/:principalId` | GET    | none                                                    | 200                        | `data` with `attributes` added   |
| `/api/v1/users/identify`     | POST   | `{ email, name?, image?, emailVerified?, attributes? }` | 201 (new) / 200 (existing) | `data` with `created` boolean    |
| `/api/v1/users/:principalId` | PATCH  | `{ name?, image?, emailVerified?, attributes? }`        | 200                        | `data` with updated fields       |
| `/api/v1/users/:principalId` | DELETE | none                                                    | 204                        | (unchanged)                      |

---

## 3. Request/Response Shapes

### POST /api/v1/users/identify

**Request:**

```json
{
  "email": "jane@example.com",
  "name": "Jane Doe",
  "image": "https://example.com/avatar.jpg",
  "emailVerified": true,
  "attributes": {
    "plan": "enterprise",
    "mrr": 499.99,
    "is_beta": true
  }
}
```

**Response (201 created / 200 updated):**

```json
{
  "data": {
    "principalId": "principal_...",
    "userId": "user_...",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "image": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "attributes": {
      "plan": "enterprise",
      "mrr": 499.99,
      "is_beta": true
    },
    "createdAt": "2026-02-24T12:00:00.000Z",
    "created": true
  }
}
```

### PATCH /api/v1/users/:principalId

**Request:**

```json
{
  "name": "Jane D.",
  "emailVerified": true,
  "attributes": {
    "plan": "pro",
    "mrr": null
  }
}
```

**Response (200):**

```json
{
  "data": {
    "principalId": "principal_...",
    "userId": "user_...",
    "name": "Jane D.",
    "email": "jane@example.com",
    "image": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "attributes": { "plan": "pro" },
    "createdAt": "2026-02-24T12:00:00.000Z"
  }
}
```

### GET responses (list + detail)

Both add `attributes` field:

```json
{
  "principalId": "principal_...",
  "name": "Jane",
  "email": "jane@example.com",
  "attributes": { "plan": "enterprise", "mrr": 499 },
  ...
}
```

---

## 4. User Attribute Validation, Coercion & Storage

### Prerequisite: Attributes must be configured first

User attributes must be defined in **Settings > User Attributes** before they can be set via the API. Each attribute definition specifies a `key` (the identifier used in API requests) and a `type` (string, number, boolean, date, currency) that determines validation and coercion rules. This is the same model as Featurebase -- custom attributes require prior configuration.

If an API request includes an attribute key that has no corresponding definition, the request is rejected with a 400 error.

### Validation flow

1. Incoming `attributes` is `Record<string, unknown>` where keys must match a configured `userAttributeDefinitions.key`.
2. Unknown keys (no matching definition) produce a validation error -- the attribute must be configured first.
3. `null` values mean "unset this attribute" (remove from metadata).

### Coercion rules (reuse existing `coerceValue` logic)

| Type                  | Coercion                                                  |
| --------------------- | --------------------------------------------------------- |
| `string`              | `String(value)`                                           |
| `number` / `currency` | `Number(value)`, reject if `NaN`                          |
| `boolean`             | Accept `true/false`, `"true"/"false"`, `"1"/"0"`          |
| `date`                | `new Date(value)`, store as ISO string, reject if invalid |

### Storage

- Validated attributes are shallow-merged into existing `user.metadata` JSON.
- `null` value for a key removes that key from metadata.
- Merged object serialized via `JSON.stringify()` and written to `user.metadata`.

### Error reporting

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more user attributes are invalid",
    "details": {
      "invalidAttributes": [
        {
          "key": "unknown_field",
          "reason": "No attribute definition found for key 'unknown_field'"
        },
        { "key": "mrr", "reason": "Value 'abc' cannot be coerced to type 'number'" }
      ]
    }
  }
}
```

---

## 5. Service Functions

### `parseUserAttributes(metadata: string | null): Record<string, unknown>`

Safely parse `user.metadata` JSON. Returns `{}` on null/malformed input.

### `validateAndCoerceAttributes(attributes: Record<string, unknown>): Promise<{ valid: Record<string, unknown>; errors: Array<{ key: string; reason: string }> }>`

1. Fetch all `userAttributeDefinitions` from DB.
2. For each incoming key, find definition by `definition.key` (not `externalKey`).
3. Missing definition -> error. Failed coercion -> error. `null` -> mark for removal.
4. Return `valid` map and `errors` array.

### `identifyPortalUser(input): Promise<IdentifyPortalUserResult>`

Upsert by email:

1. Validate/coerce incoming attributes via `validateAndCoerceAttributes`.
2. Normalize email (lowercase, trim).
3. Find user by email.
4. **Exists**: update name, image, emailVerified (if provided), merge attributes into metadata, sync `principal.displayName` and `principal.avatarUrl`.
5. **New**: create `user` + `principal` (role='user'), set all provided fields.
6. Return result with `created` boolean.

### `updatePortalUser(principalId, input): Promise<UpdatePortalUserResult>`

1. Find principal with `role='user'` joined to user. 404 if not found.
2. Validate/coerce incoming attributes.
3. Update name, image, emailVerified (if provided), merge attributes, sync `principal.displayName` and `principal.avatarUrl`.
4. Return updated data.

---

## 6. Edge Cases

| Scenario                              | Behavior                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Duplicate email on identify           | Upsert: finds existing, updates. Returns 200 with `created: false`.                                              |
| Email case sensitivity                | Normalize to lowercase + trim before lookup.                                                                     |
| Unknown attribute keys                | Return 400 with details listing which keys have no definition.                                                   |
| Invalid attribute values              | Return 400 with per-key error details.                                                                           |
| Null attribute values                 | Remove the key from metadata. Valid for all types.                                                               |
| Empty attributes `{}`                 | No-op for attributes; other fields still processed.                                                              |
| No attribute definitions exist        | If `attributes` provided but no definitions, return 400 for all keys. If `attributes` omitted, proceed normally. |
| Team member found by email (identify) | Update name/attributes on user record. Do NOT create new principal or change role. Return existing principal.    |
| PATCH on non-portal user              | Return 404 (PATCH scoped to `role='user'`).                                                                      |
| Concurrent identify for same email    | Catch Postgres unique violation (23505), retry as update.                                                        |
| Attribute definition deleted          | Old metadata keys stay. GET returns all stored metadata, unfiltered.                                             |

---

## 7. Design Decisions

1. **`/identify` route vs `POST /users`**: `/identify` makes upsert semantics explicit. `POST /users` conventionally implies create-or-fail. Consistent with Featurebase and Refiner.

2. **Match by `key` not `externalKey`**: `externalKey` is for CDP integration trait mapping. REST API callers use the canonical `key`.

3. **Strict validation (reject unknown keys)**: Unlike CDP sync (which silently skips), the REST API returns errors for unknown keys to catch typos early.

4. **Metadata returned as-is**: GET responses return all parsed metadata, even for deleted definitions. Avoids data loss.

5. **Team members and identify**: Identify can update attributes for any user by email (including team members), but only _creates_ new users with `role='user'`.

---

## 8. Implementation Order

### Step 1: Extract shared coercion utility

- **New:** `apps/web/src/lib/server/domains/user-attributes/coerce.ts`
  - Extract `coerceValue()` from `user-sync-handler.ts`.
- **Modify:** `apps/web/src/lib/server/integrations/user-sync-handler.ts`
  - Import `coerceValue` from shared utility.

### Step 2: Add service types

- **Modify:** `apps/web/src/lib/server/domains/users/user.types.ts`
  - Add `IdentifyPortalUserInput`, `IdentifyPortalUserResult`, `UpdatePortalUserInput`, `UpdatePortalUserResult`.
  - Add `metadata: string | null` to `PortalUserListItem` and `PortalUserDetail`.

### Step 3: Add service functions

- **Modify:** `apps/web/src/lib/server/domains/users/user.service.ts`
  - Add `parseUserAttributes()`, `validateAndCoerceAttributes()`, `identifyPortalUser()`, `updatePortalUser()`.
  - Modify `listPortalUsers()` to include `user.metadata` in SELECT.
  - Modify `getPortalUserDetail()` to include `user.metadata` in SELECT.

### Step 4: Add identify route

- **New:** `apps/web/src/routes/api/v1/users/identify.ts`
  - POST handler for identify/upsert.

### Step 5: Modify existing routes

- **Modify:** `apps/web/src/routes/api/v1/users/$principalId.ts`
  - Add PATCH handler.
  - Update GET to include `attributes`.
- **Modify:** `apps/web/src/routes/api/v1/users/index.ts`
  - Update GET to include `attributes` in list items.

### Step 6: Upsert concurrency

Handle Postgres unique violation (23505) in `identifyPortalUser` with retry-as-update pattern.

---

## Critical Files

| File                                                        | Action                                       |
| ----------------------------------------------------------- | -------------------------------------------- |
| `apps/web/src/lib/server/domains/user-attributes/coerce.ts` | New                                          |
| `apps/web/src/lib/server/integrations/user-sync-handler.ts` | Modify (import coerce)                       |
| `apps/web/src/lib/server/domains/users/user.types.ts`       | Modify (new types)                           |
| `apps/web/src/lib/server/domains/users/user.service.ts`     | Modify (new functions + metadata in queries) |
| `apps/web/src/routes/api/v1/users/identify.ts`              | New                                          |
| `apps/web/src/routes/api/v1/users/$principalId.ts`          | Modify (PATCH + GET attributes)              |
| `apps/web/src/routes/api/v1/users/index.ts`                 | Modify (GET attributes)                      |
