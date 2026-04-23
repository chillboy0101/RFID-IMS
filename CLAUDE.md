# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RFID-IMS is a monorepo containing a **React Native/Expo mobile app** (`apps/inventory-eye/`) and an **Express.js backend** (`server/`). The system is an inventory management platform for VDL Fulfilment Ops that tracks items via RFID/barcode, manages orders, receiving, putaway, cycle counts, and reorders.

## Commands

### Backend (`server/`)
```bash
npm run dev          # Run with tsx watch (development)
npm run build        # Compile TypeScript to dist/
npm run start        # Run compiled JS from dist/
npm run seed         # Seed database with sample data
npm run seed:reset   # Reset and reseed database
```

### Mobile App (`apps/inventory-eye/`)
```bash
npx expo start       # Start Expo dev server
npx expo start --web # Start for web only
npx expo start --android  # Android
npx expo start --ios      # iOS
```

### Both
- Backend listens on port 4000 by default (configurable via `PORT` env var)
- Mobile app connects to `http://localhost:4000` (Android emulator uses `10.0.2.2:4000`)

## Architecture

### Backend (`server/src/`)

**Entry:** `index.ts` — Express app with built-in middleware stack

**Middleware chain:** `src/middleware/auth.ts` (JWT verification) → `src/middleware/gate.ts` (tenant/membership checks) → `src/middleware/tenant.ts`

**Models** (`src/models/`): Mongoose schemas for AuthSession, ExitAuthorization, Feedback, InventoryItem, InventoryLog, InventoryUnit, Invite, Order, ReorderRequest, RfidEvent, SecurityAlert, TaskSession, TenantAuditLog, TenantMembership, Tenant, User, Vendor

**Routes** (`src/routes/`): auth, admin, inventory, orders, dashboard, alerts, reports, feedback, progress, rfid, vendors, reorders, integrations, tenants — all under `/server/src/routes/`

**Multi-tenancy:** TenantId is required on most requests. The `gate.ts` middleware enforces tenant context from the user's session.

### Mobile App (`apps/inventory-eye/src/`)

**Entry:** `AppNavigator.tsx` — React Navigation setup (bottom tabs + native stack navigator)

**Auth:** `AuthContext.tsx` — React Context holding JWT token, user info, tenant context. Token stored in expo-secure-store.

**API Client:** `api/client.ts` — Axios-based client. `API_BASE_URL` is resolved in `config.ts` with special logic for Android emulators and web hosts.

**Screens** (`screens/`): 30+ screens covering Dashboard, Inventory, Orders, Receiving, Putaway, CycleCount, Reports, Vendors, Reorders, Alerts, Settings, Admin functions.

**UI Components** (`ui/`): BarcodeScanModal (uses @zxing for camera-based scanning), theme, shared components.

### Key Data Flow

1. Mobile app authenticates via `/auth/login` → receives JWT stored in secure-store
2. All API requests include `Authorization: Bearer <token>` header
3. Backend middleware verifies token, extracts user+tenant, enforces access control
4. API responses are JSON: `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`

## Authentication System

### Data Model

```
User ← TenantMembership → Tenant
       ↑ (role per tenant)
       |
   AuthSession (tracks JWT sessions)
```

- **User**: name, email, passwordHash, mustChangePassword, role (inventory_staff | manager | admin)
- **Tenant**: name, slug (organizational unit)
- **TenantMembership**: links User to Tenant with a per-tenant role — a user can have different roles across tenants
- **AuthSession**: tracks active JWT sessions via `jti`, `lastSeenAt`, `revokedAt`. Sessions auto-expire after 30 days via MongoDB TTL index
- **Invite**: code-based invitation — optionally tied to email, tenant, and role. Used during registration

### Auth Flow

1. `POST /auth/register` — creates User, optionally creates TenantMembership via invite code (auto-joins first tenant if no code)
2. `POST /auth/login` — validates credentials, creates AuthSession, returns JWT signed with `JWT_SECRET` (expires in 7 days)
3. `GET /auth/me` — returns current user; refreshes session `lastSeenAt`
4. `POST /auth/change-password` — updates password (requires old password)

### JWT Token Contents
```json
{ "id": "<User._id>", "role": "admin", "jti": "<session UUID>" }
```

### Request Auth Middleware (`auth.ts`)
`requireAuth` verifies the JWT, checks the `jti` against AuthSession (unrevoked), and attaches `req.auth = { id, role, jti }`.

### Tenant Enforcement (`tenant.ts`)
`requireTenant` reads `X-Tenant-ID` header. Admins get access to any tenant; other users must have a TenantMembership for that tenant.

### Role Hierarchy
`inventory_staff` < `manager` < `admin`. Middleware `requireRole()` checks the effective role (falls back to `req.auth.role` for global admins).

## Environment Variables

### Backend
- `MONGODB_URI` — MongoDB connection string
- `PORT` — server port (default 4000)
- `JWT_SECRET` — for signing tokens
- `CORS_ORIGIN` — comma-separated allowed origins
- `NODE_ENV=production` — enables production security headers
- `METRICS_TOKEN` — token for `/metrics` endpoint

### Mobile App
- `EXPO_PUBLIC_API_BASE_URL` — override API base URL

### Mobile Auth Flow (`AuthContext.tsx`)

1. **App launch** — `AuthProvider` reads stored token from secure-store (or localStorage on web), sets `loading: false`
2. **Restore session** — useEffect detects token, calls `refreshMe()` then `refreshTenants()`, populates user and tenant list
3. **Sign in** — `signIn(email, password)` → `POST /auth/login` → stores token → calls `refreshTenants()` for role
4. **Sign up** — `signUp(name, email, password, inviteCode?)` → `POST /auth/register` → same flow
5. **Session keepalive** — `refreshMe()` polled every 2 minutes; on failure, clears token and signs out
6. **Tenant selection** — if user has multiple TenantMemberships, first tenant is auto-selected; `activeTenantId` stored in secure-store and sent as `X-Tenant-ID` header on all API requests
7. **Password change** — if `user.mustChangePassword` is true, user is forced to `ForcePasswordChangeScreen`

### Mobile Token Storage
- **Native (iOS/Android)**: `expo-secure-store` — encrypted storage
- **Web**: `window.localStorage` — same key `inventory_eye_token`
- Active tenant ID stored separately as `inventory_eye_active_tenant`

### API Client (`api/client.ts`)
- All requests go through `apiRequest()`, which attaches `Authorization: Bearer <token>` and `X-Tenant-ID` headers automatically
- 20s default timeout; 25s for auth endpoints
- On non-OK responses with an `error` field, throws `Error` with the error string
- `getApiTenantId()` / `setApiTenantId()` — module-level singleton tracking the active tenant in memory

### Screens
- **LoginScreen** — email + password, shows server timeout/network error messages
- **RegisterScreen** — name + email + password + optional invite code
- **ForcePasswordChangeScreen** — old password + new password (6+ chars)
- **BranchSelectGateScreen** — tenant selection screen when multiple tenants available

## Notes

- No tests currently exist in this repository
- The `docs/spec/extract_pdf_text.py` script extracts text from PDFs for specification purposes
