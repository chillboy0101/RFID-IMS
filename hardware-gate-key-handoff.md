# VDL Fulfilment Ops RFID Hardware Handoff

Hello Israel,

Please use the gate key below to connect the RFID reader to the VDL Fulfilment Ops backend.

## Backend Base URL

```txt
https://rfid-ims.onrender.com
```

## Gate API Key

```txt
gate_adb3ccacfd9be845b096fc18cf7cac9c37cccf3b98d43615
```

Send this key in the request header for every hardware request:

```http
X-Gate-Api-Key: gate_adb3ccacfd9be845b096fc18cf7cac9c37cccf3b98d43615
Content-Type: application/json
```

Keep this key private. If it leaks, we will revoke it and generate a new one from the system.

## 1. Tag Assignment / Receiving Scan

Use this when a new RFID tag is scanned and should be assigned to an inventory item.

```http
POST https://rfid-ims.onrender.com/rfid/receive-scan
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

## 2. User Auth Scan

Use this when the reader needs to request an exit session/token before scanning items out.

```http
POST https://rfid-ims.onrender.com/rfid/exit-session
```

Payload:

```json
{
  "location": "EXIT_MAIN",
  "source": "main-exit-reader",
  "eventId": "unique-reader-event-id-002"
}
```

## 3. Item Exit Scan

Use this when an item/tag is scanned at the exit gate.

```http
POST https://rfid-ims.onrender.com/rfid/exit-scan
```

Payload:

```json
{
  "tagId": "RFID-TAG-001",
  "location": "EXIT_MAIN",
  "source": "main-exit-reader",
  "eventId": "unique-reader-event-id-003"
}
```

If the reader is scanning barcodes instead of RFID tags, send `barcode` instead of `tagId`:

```json
{
  "barcode": "BARCODE-001",
  "location": "EXIT_MAIN",
  "source": "main-exit-reader",
  "eventId": "unique-reader-event-id-004"
}
```

## Required Rules

- Always send `X-Gate-Api-Key`.
- Always send a unique `eventId` for each hardware scan to prevent duplicates.
- Use `EXIT_MAIN` for the main exit reader unless we create a different gate key/location for another reader.
- The system will only approve exit scans for items that have been authorized from the VDL Fulfilment Ops portal.

