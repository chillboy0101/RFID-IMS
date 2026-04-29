# RFID Hardware Integration

This document is the handoff contract for RFID readers, barcode-capable middleware, and tag commissioning stations.

Use the deployed API host in production. For local testing, use the backend host that the app points to, for example:

```text
http://localhost:4000
http://<LAN-IP>:4000
```

## Core Flow

1. Create the item master record in the app or API. New items start with `quantity: 0`.
2. Receive physical units through the RFID receiving station. Each successful tag read creates one inventory unit and increments stock.
3. Create an order from available stock.
4. Authorize the order for an exit gate.
5. Fixed gate reader posts exit reads. The server returns `ALLOW` or `DENY` and records the event/audit trail.

## Authentication

Hardware endpoints use gate/station keys:

```http
X-Gate-Api-Key: gate_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Source: receiving-station-a1
X-Event-ID: reader-a1-20260429-000001
Content-Type: application/json
```

Create keys from `RFID Hub -> Gate Keys`. A key can be bound to a location with `locationHint`; when it is bound, hardware does not need to send `location`.

```http
POST /rfid/gate-keys
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "name": "Main exit reader",
  "locationHint": "EXIT_MAIN",
  "minutes": 43200
}
```

For retry-safe hardware delivery, always send either the `X-Event-ID` header or `eventId` in the JSON body. Duplicate event IDs return `duplicate: true` without processing the scan twice.

## Receiving Reader

Use this for receiving/tag assignment. This is the preferred hardware path for adding stock.

```http
POST /rfid/receiving-events
X-Gate-Api-Key: <raw gate key>
X-Source: receiving-station-a1
X-Event-ID: receiving-a1-000001
Content-Type: application/json
```

Preferred payload:

```json
{
  "eventId": "receiving-a1-000001",
  "tagId": "E20034120123456789012345",
  "itemBarcode": "BW-BLND-130",
  "location": "RECEIVING_STAGING",
  "observedAt": "2026-04-29T14:10:00.000Z"
}
```

Accepted item identifiers:

```json
{
  "tagId": "E20034120123456789012345",
  "itemId": "68101234567890abcdef9999"
}
```

```json
{
  "tagId": "E20034120123456789012345",
  "sku": "BW-BLND-130"
}
```

Successful response:

```json
{
  "ok": true,
  "processed": true,
  "event": {
    "_id": "68101234567890abcdef5678",
    "eventId": "receiving-a1-000001",
    "tagId": "E20034120123456789012345"
  },
  "item": {
    "_id": "68101234567890abcdef9999",
    "name": "Brazilian wig",
    "sku": "BW-BLND-130",
    "quantity": 1
  },
  "unit": {
    "_id": "68101234567890abcdef1111",
    "tagId": "E20034120123456789012345",
    "status": "in_stock",
    "location": "RECEIVING_STAGING"
  }
}
```

Rules:

- One tag read creates one inventory unit.
- Receiving locations must not be exit gates.
- A tag can only be assigned once.
- Inactive items cannot receive stock.
- Stock quantity is incremented by the server after the read is accepted.

## Fixed Exit Gate Reader

Use this for autonomous exit verification at gate/portal readers.

```http
POST /rfid/gate-events
X-Gate-Api-Key: <raw gate key>
X-Source: fx9600-exit-main
X-Event-ID: exit-main-000001
Content-Type: application/json
```

Preferred payload:

```json
{
  "eventId": "exit-main-000001",
  "tagId": "E20034120123456789012345",
  "location": "EXIT_MAIN",
  "observedAt": "2026-04-29T14:20:00.000Z",
  "readerId": "FX9600-EXIT-01",
  "antenna": 2,
  "rssi": -47
}
```

Barcode fallback is supported when middleware reads a barcode instead of EPC:

```json
{
  "eventId": "exit-main-000002",
  "barcode": "1234567890123",
  "location": "EXIT_MAIN"
}
```

Allowed response:

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
    "name": "Brazilian wig",
    "sku": "BW-BLND-130"
  },
  "order": {
    "_id": "68101234567890abcdef7777",
    "status": "authorized"
  },
  "alert": null
}
```

Denied response:

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
    "name": "Brazilian wig",
    "sku": "BW-BLND-130"
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

Rules:

- Exit gate locations must be exit locations, for example `EXIT_MAIN`.
- Authorization decisions use server time, not reader time.
- `ALLOW` consumes one active authorization.
- `DENY` records a security alert.

## Operator Exit Session

This remains available for handheld/scanner flows that require a signed-in operator token.

```http
POST /rfid/exit-sessions
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "location": "EXIT_MAIN",
  "minutes": 5,
  "orderId": "68101234567890abcdef7777"
}
```

Verify scan:

```http
POST /rfid/exit-sessions/verify
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
X-Event-ID: handheld-exit-000001
Content-Type: application/json

{
  "token": "exit_abcdef0123456789abcdef01",
  "tagId": "E20034120123456789012345",
  "eventId": "handheld-exit-000001"
}
```

## Item and Order API Notes

Create item master data:

```http
POST /inventory/items
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "name": "Brazilian wig",
  "sku": "BW-BLND-130",
  "barcode": "BW-BLND-130",
  "location": "RECEIVING_STAGING",
  "quantity": 0,
  "reorderLevel": 10,
  "status": "active"
}
```

Create order:

```http
POST /orders
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "items": [
    {
      "itemId": "68101234567890abcdef9999",
      "quantity": 2
    }
  ],
  "notes": "Customer pickup"
}
```

Authorize order exit:

```http
POST /orders/:id/authorize-exit
Authorization: Bearer <jwt>
X-Tenant-ID: <tenant-id>
Content-Type: application/json

{
  "location": "EXIT_MAIN",
  "minutes": 10
}
```

The server rejects orders that request more units than are currently available after reserved/picked/packed units are considered.

## Meta Endpoint

Hardware can inspect the current contract with:

```http
GET /rfid/meta
```

This returns fixed gate, receiving reader, exit session, and tag registry endpoint information.
