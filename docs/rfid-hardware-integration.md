# RFID Hardware Integration

This is the hardware-facing contract for RFID readers, staff cards, item tag assignment, and exit verification.

Use the deployed backend in production:

```text
https://rfid-ims.onrender.com
```

## Important Rules

- Hardware uses `X-Gate-Api-Key`, not the normal portal Bearer JWT.
- The gate key identifies the reader/station.
- The staff RFID card creates a branch-wide operator session token. The same token can be used for receiving/tag assignment and exit scans until it expires or is logged out.
- For exit scans, a bound gate key supplies the exit location.
- For receiving blank tags, the portal must first arm the item and location in `RFID Hub -> Receive`; hardware then sends only the blank tag ID.
- The staff RFID card identifies the operator.
- The backend generates and stores item SKUs. Hardware must not generate or send SKU values.
- Every physical scan should use a UUID `eventId`.
- Reuse the same UUID when retrying the same scan so the backend can safely detect duplicates.
- Do not send `observedAt`; the backend records scan time on receipt.

## Common Headers

```http
Content-Type: application/json
X-Gate-Api-Key: <raw gate key>
X-Source: rfid-reader-01
```

Receiving and exit scans also require the operator session token returned after staff card authorization:

```http
X-Operator-Session: op_xxxxx
X-Event-ID: 0f3f2cb3-1cc8-4e2f-a7d9-2c1bbfba0d41
```

## 1. Staff Card Authorization

Scan the staff RFID card first. This returns a short-lived operator token that identifies which staff member is operating the reader.

```http
POST /rfid/operator-sessions
```

Payload:

```json
{
  "operatorTagId": "STAFF_CARD_TAG",
  "location": "EXIT_MAIN",
  "source": "rfid-reader-01"
}
```

Response:

```json
{
  "ok": true,
  "operatorSession": {
    "token": "op_xxxxx",
    "operatorSessionToken": "op_xxxxx",
    "expiresAt": "2026-05-09T12:30:00.000Z",
    "operator": {
      "id": "USER_ID",
      "name": "Staff Name",
      "email": "staff@example.com",
      "role": "inventory_staff"
    }
  }
}
```

## 2. Assign RFID Tag To Inventory Item

Use this endpoint when receiving/tagging stock. Because the RFID tags are blank, the reader only sends the scanned tag ID. The portal supplies the product details by arming an item/location in `RFID Hub -> Receive` before the scan.

```http
POST /rfid/receiving-events
```

Headers:

```http
X-Gate-Api-Key: <raw gate key>
X-Operator-Session: op_xxxxx
X-Source: rfid-reader-01
X-Event-ID: 0f3f2cb3-1cc8-4e2f-a7d9-2c1bbfba0d41
```

Preferred payload:

```json
{
  "tagId": "ITEM_RFID_TAG",
  "eventId": "0f3f2cb3-1cc8-4e2f-a7d9-2c1bbfba0d41",
  "source": "rfid-reader-01"
}
```

Response:

```json
{
  "ok": true,
  "processed": true,
  "event": {},
  "item": {},
  "unit": {}
}
```

Notes:

- Before this call, the portal must have an active receiving item in `RFID Hub -> Receive`.
- `tagId` alone is enough after the item/location has been armed in the portal.
- If no item is armed, the backend returns an error asking the user to select an item in RFID Hub Receive first.
- The reader should not send SKU, item ID, or product barcode for normal receiving scans.

## 3. Authorize Orders To Leave

This is handled in the portal UI:

```text
Orders -> Order Detail -> Authorize gate exit
RFID Hub -> Authorize
```

## 4. Confirm Item Is Authorized To Exit

Use this for autonomous exit verification at the gate.

```http
POST /rfid/gate-events
```

Headers:

```http
X-Gate-Api-Key: <raw gate key>
X-Operator-Session: op_xxxxx
X-Source: rfid-reader-01
X-Event-ID: 5b126e07-5d2f-47c2-b088-7be7b6c34f80
```

Payload:

```json
{
  "tagId": "ITEM_RFID_TAG",
  "location": "EXIT_MAIN",
  "eventId": "5b126e07-5d2f-47c2-b088-7be7b6c34f80",
  "source": "rfid-reader-01"
}
```

Barcode fallback payload:

```json
{
  "barcode": "PRODUCT_BARCODE",
  "location": "EXIT_MAIN",
  "eventId": "5b126e07-5d2f-47c2-b088-7be7b6c34f80",
  "source": "rfid-reader-01"
}
```

Allowed response:

```json
{
  "ok": true,
  "decision": "ALLOW",
  "authorized": true,
  "authorizationId": "AUTHORIZATION_ID",
  "operator": {},
  "item": {},
  "order": {}
}
```

Denied response:

```json
{
  "ok": true,
  "decision": "DENY",
  "authorized": false,
  "alert": {}
}
```

## 5. RFID Device Logout

Use this when the reader needs to close the current staff/operator session.

```http
DELETE /rfid/operator-sessions/op_xxxxx
X-Gate-Api-Key: <raw gate key>
```

Response:

```json
{
  "ok": true,
  "ended": {
    "id": "OPERATOR_SESSION_ID",
    "endedAt": "2026-05-09T12:20:00.000Z"
  }
}
```

## Staff Card Management UI

Staff RFID cards are managed in:

```text
People & Data -> Branches & Users -> Staff RFID cards
```

Available actions:

- Assign card
- Change card
- Remove card

## Meta Endpoint

Hardware can inspect the current live contract with:

```http
GET /rfid/meta
```
