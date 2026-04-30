# VDL Fulfilment Ops RFID Hardware Handoff

Hello Israel,

Please use the gate key below to connect the RFID reader to the VDL Fulfilment Ops backend.

## Backend Base URL

```txt
https://rfid-ims.onrender.com
```

## Endpoint Summary

The RFID reader only needs two hardware endpoints:

1. `POST /rfid/receiving-events` for tag assignment / receiving scans.
2. `POST /rfid/gate-events` for exit gate scans.

There is no separate Bearer-token endpoint for the reader. Staff/user authentication happens inside the VDL Fulfilment Ops portal. Once staff authorize an order or gate exit in the portal, the reader only sends scans and the server automatically checks whether the scanned tag/barcode is allowed to leave.

## Gate API Key

```txt
gate_adb3ccacfd9be845b096fc18cf7cac9c37cccf3b98d43615
```

Send this key in the request header for every hardware request:

```http
X-Gate-Api-Key: gate_adb3ccacfd9be845b096fc18cf7cac9c37cccf3b98d43615
Content-Type: application/json
```

Do not use a Bearer token for hardware requests. Bearer tokens are only for logged-in portal users and they expire. The RFID reader should authenticate with `X-Gate-Api-Key` only.

Keep this key private. If it leaks, we will revoke it and generate a new one from the system.

## 1. Tag Assignment / Receiving Scan

Use this when a new RFID tag is scanned and should be assigned to an inventory item.

```http
POST https://rfid-ims.onrender.com/rfid/receiving-events
```

Payload:

```json
{
  "tagId": "RFID-TAG-001",
  "sku": "BW-BLND-130",
  "location": "RECEIVING_STAGING",
  "source": "receiving-reader-01",
  "eventId": "unique-reader-event-id-001"
}
```

## 2. Reader Authentication

There is no separate Bearer-token login for the reader. The reader is authenticated on every request by the gate key header:

```http
X-Gate-Api-Key: gate_adb3ccacfd9be845b096fc18cf7cac9c37cccf3b98d43615
```

## 3. Item Exit Scan

Use this when an item/tag is scanned at the exit gate.

```http
POST https://rfid-ims.onrender.com/rfid/gate-events
```

Payload:

```json
{
  "tagId": "RFID-TAG-001",
  "location": "EXIT_MAIN",
  "source": "main-exit-reader",
  "eventId": "unique-reader-event-id-002"
}
```

If the reader is scanning barcodes instead of RFID tags, send `barcode` instead of `tagId`:

```json
{
  "barcode": "BARCODE-001",
  "location": "EXIT_MAIN",
  "source": "main-exit-reader",
  "eventId": "unique-reader-event-id-003"
}
```

## Required Rules

- Always send `X-Gate-Api-Key`.
- Do not send `Authorization: Bearer ...` from the RFID reader.
- Always send a unique `eventId` for each hardware scan to prevent duplicates.
- Use `EXIT_MAIN` for the main exit reader unless we create a different gate key/location for another reader.
- The system will only approve exit scans for items that have been authorized from the VDL Fulfilment Ops portal.
