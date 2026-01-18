@echo off
setlocal EnableDelayedExpansion

if "%TOKEN%"=="" (
  echo TOKEN environment variable is not set in this CMD session.
  set /p TOKEN=Paste JWT token and press Enter: 
)

if "%TOKEN%"=="" (
  echo ERROR: TOKEN is still empty.
  exit /b 1
)

set BASE=http://localhost:4000

echo === GET /rfid/meta ===
curl.exe -s %BASE%/rfid -H "Authorization: Bearer %TOKEN%"
echo.
echo.

if not defined ITEM_ID (
  echo ITEM_ID is not set. Skipping POST /rfid/events and reorder smoke steps.
  echo To enable, run: set ITEM_ID=YOUR_INVENTORY_ITEM_ID
  echo.
) else (
  if "!ITEM_ID!"=="" (
    echo ITEM_ID is empty. Skipping POST /rfid/events and reorder smoke steps.
    echo.
    goto after_item_steps
  )
  echo === POST /rfid/events (location update + delta) ===
  curl.exe -s -X POST %BASE%/rfid/events -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" --data "{\"tagId\":\"TAG-TEST-001\",\"eventType\":\"scan\",\"itemId\":\"!ITEM_ID!\",\"location\":\"A2\",\"delta\":1}" > rfid_event.json
  type rfid_event.json
  echo.
  echo.
)

:after_item_steps

set VNAME=Test Vendor %RANDOM%%RANDOM%
set VEMAIL=vendor_%RANDOM%%RANDOM%@example.com

echo === POST /vendors (create) ===
curl.exe -s -X POST %BASE%/vendors -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" --data "{\"name\":\"!VNAME!\",\"contactEmail\":\"!VEMAIL!\"}" > vendor_create.json
type vendor_create.json
echo.

for /f "usebackq delims=" %%V in (`node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('vendor_create.json','utf8'));process.stdout.write((j.vendor&&j.vendor._id)||'')"`) do set VENDOR_ID=%%V

if "!VENDOR_ID!"=="" (
  echo ERROR: Could not parse vendor id from vendor_create.json
  exit /b 1
)

echo.
echo VENDOR_ID=!VENDOR_ID!

echo.
echo === GET /vendors (list) ===
curl.exe -s %BASE%/vendors -H "Authorization: Bearer %TOKEN%"
echo.
echo.

if defined ITEM_ID if not "!ITEM_ID!"=="" (
  echo === PATCH /inventory/items/%ITEM_ID% (set reorderLevel high to guarantee low stock) ===
  curl.exe -s -X PATCH %BASE%/inventory/items/!ITEM_ID! -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" --data "{\"reorderLevel\":999}" > item_patch.json
  type item_patch.json
  echo.
  echo.

  echo === POST /reorders/auto ===
  curl.exe -s -X POST %BASE%/reorders/auto -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" --data "{\"defaultRequestedQuantity\":50}" > reorders_auto.json
  type reorders_auto.json
  echo.
  echo.

  echo === GET /reorders ===
  curl.exe -s %BASE%/reorders -H "Authorization: Bearer %TOKEN%"
  echo.
  echo.
)

echo === GET /integrations/export?type=inventory ===
curl.exe -s "%BASE%/integrations/export?type=inventory" -H "Authorization: Bearer %TOKEN%"
echo.
echo.

echo RFID/Vendors/Reorders/Integrations smoke test OK.

endlocal
