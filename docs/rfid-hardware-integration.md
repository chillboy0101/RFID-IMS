# RFID Hardware Integration

This project supports two RFID integration patterns:

1. Fixed gate reader flow for portal readers and middleware.
2. Operator-assisted exit-session flow for scanners that work with a signed-in warehouse user.

The local API base URL is:

```text
http://172.20.10.5:4000
```

## 1. Fixed Gate Reader Flow

Use this when the hardware team is wiring a portal reader, antenna controller, or reader-side middleware.

### Authentication

Send the raw gate key in the `X-Gate-Api-Key` header.

```http
X-Gate-Api-Key: gate_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Source: fx9600-exit-main
Content-Type: application/json
```

Create gate keys from the app in `RFID Hub -> Gate Keys`, or by calling:

```http
POST /rfid/gate-keys
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "name": "EXIT_MAIN portal",
  "locationHint": "EXIT_MAIN",
  "minutes": 43200
}
```

### Reader Endpoint

```http
POST /rfid/gate-events
```

### Reader Payload

Preferred autonomous payload: send a single `value` and let the server resolve whether it is an RFID tag or a barcode. `tagId` and `barcode` are still supported when the reader middleware already knows the identity type.

```json
{
  "value": "E20034120123456789012345",
  "location": "EXIT_MAIN",
  "source": "fx9600-exit-main",
  "observedAt": "2026-04-28T23:45:00.000Z"
}
```

Optional fields are preserved in the raw RFID event payload, so middleware-specific metadata can also be sent:

```json
{
  "value": "E20034120123456789012345",
  "location": "EXIT_MAIN",
  "source": "fx9600-exit-main",
  "observedAt": "2026-04-28T23:45:00.000Z",
  "readerId": "FX9600-EXIT-01",
  "antenna": 2,
  "rssi": -47
}
```

### Reader Response

`decision` is the contract the middleware should act on.

```json
{
  "ok": true,
  "mode": "tagId",
  "decision": "ALLOW",
  "authorized": true,
  "authorizationId": "68101234567890abcdef1234",
  "remainingAuthorizations": 3,
  "event": {
    "_id": "68101234567890abcdef5678"
  },
  "item": {
    "_id": "68101234567890abcdef9999",
    "name": "Industrial Label Roll",
    "sku": "LBL-ROLL-01"
  },
  "order": {
    "_id": "68101234567890abcdef7777",
    "status": "authorized"
  },
  "alert": null
}
```

If the tag is not authorized to leave, the same endpoint returns:

```json
{
  "ok": true,
  "mode": "tagId",
  "decision": "DENY",
  "authorized": false,
  "remainingAuthorizations": 0,
  "event": {
    "_id": "68101234567890abcdef5678"
  },
  "item": {
    "_id": "68101234567890abcdef9999",
    "name": "Industrial Label Roll",
    "sku": "LBL-ROLL-01"
  },
  "order": null,
  "alert": {
    "_id": "68101234567890abcdefaaaa",
    "status": "open",
    "severity": "critical",
    "message": "Unauthorized exit detection"
  }
}
```

### Gate Decision Rules

- `ALLOW`: the gate scan matches an active exit authorization for the configured location.
- `DENY`: the scan does not match an active authorization and a security alert is recorded.
- `remainingAuthorizations`: how many authorized scans remain on the order after this read.

## 2. Operator Exit-Session Flow

Use this when the operator must start a short-lived exit session before the items are scanned out.

This is the closest match to the sequence:

1. User scan requests a short-lived token.
2. User scans tags or barcodes together with that token.
3. Server verifies both the session and the leaving items.

### Start Exit Session

```http
POST /rfid/exit-sessions
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json
```

Payload:

```json
{
  "location": "EXIT_MAIN",
  "minutes": 5,
  "orderId": "68101234567890abcdef7777"
}
```

Response:

```json
{
  "ok": true,
  "session": {
    "id": "68101234567890abcdefbbbb",
    "token": "exit_abcdef0123456789abcdef01",
    "expiresAt": "2026-04-28T23:50:00.000Z",
    "location": "EXIT_MAIN",
    "orderId": "68101234567890abcdef7777"
  }
}
```

### Verify an Exit Scan

```http
POST /rfid/exit-sessions/verify
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json
```

Preferred autonomous payload:

```json
{
  "token": "exit_abcdef0123456789abcdef01",
  "value": "E20034120123456789012345",
  "observedAt": "2026-04-28T23:46:30.000Z"
}
```

Explicit RFID payload:

```json
{
  "token": "exit_abcdef0123456789abcdef01",
  "tagId": "E20034120123456789012345",
  "observedAt": "2026-04-28T23:46:30.000Z"
}
```

Explicit barcode fallback payload:

```json
{
  "token": "exit_abcdef0123456789abcdef01",
  "barcode": "1234567890123",
  "observedAt": "2026-04-28T23:46:30.000Z"
}
```

Response:

```json
{
  "ok": true,
  "mode": "tagId",
  "authorized": true,
  "decision": "ALLOW",
  "remainingAuthorizations": 2,
  "session": {
    "expiresAt": "2026-04-28T23:50:00.000Z",
    "location": "EXIT_MAIN",
    "orderId": "68101234567890abcdef7777"
  },
  "item": {
    "_id": "68101234567890abcdef9999",
    "name": "Industrial Label Roll",
    "sku": "LBL-ROLL-01"
  },
  "order": {
    "_id": "68101234567890abcdef7777",
    "status": "authorized"
  }
}
```

## 3. Tag Registry Endpoints

These are the endpoints behind the RFID Hub tag portal.

### List Tags

```http
GET /rfid/tags?status=active&search=LBL
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
```

### Get Tag Details

```http
GET /rfid/tags/:tagId
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
```

### Reassign or Change Tracker Mapping

```http
PATCH /rfid/tags/:tagId
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "itemId": "68101234567890abcdef9999"
}
```

### Activate Tag

```http
POST /rfid/tags/:tagId/activate
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
```

### Deactivate Tag

```http
POST /rfid/tags/:tagId/deactivate
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
```

### Remove Tag Assignment

```http
DELETE /rfid/tags/:tagId
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
```

## 4. Receiving and Tag Assignment Flow

This is the app-side receiving endpoint used when warehouse staff binds a physical unit to a tag.

```http
POST /inventory/receiving/units
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "itemId": "68101234567890abcdef9999",
  "tagId": "E20034120123456789012345",
  "location": "RECEIVING_STAGING",
  "quantity": 1
}
```

Rules:

- `tagId` plus `quantity: 1` creates a single unit with an RFID binding.
- `quantity > 1` is only valid when `tagId` is omitted.
- Once received, the unit can move into picking, authorization, and exit scanning.

## 5. Useful Meta Endpoint

The server now exposes a hardware summary endpoint:

```http
GET /rfid/meta
```

That returns the current fixed-reader, exit-session, and tag-registry endpoint map.
