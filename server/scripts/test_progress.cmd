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

echo === GET /progress (should be ok:true endpoints) ===
curl.exe -s %BASE%/progress -H "Authorization: Bearer %TOKEN%"
echo.
echo.

echo === POST /progress/sessions/start ===
curl.exe -s -X POST %BASE%/progress/sessions/start -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" --data "{\"kind\":\"other\",\"meta\":{\"note\":\"progress smoke test\"}}" > progress_start.json
type progress_start.json
echo.

for /f "usebackq delims=" %%S in (`node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('progress_start.json','utf8'));process.stdout.write(j.session?j.session._id||'':'')"`) do set SESSION_ID=%%S

if "!SESSION_ID!"=="" (
  echo ERROR: Could not parse session id from progress_start.json
  exit /b 1
)

echo.
echo SESSION_ID=!SESSION_ID!
echo.

echo === POST /progress/sessions/!SESSION_ID!/stop ===
curl.exe -s -X POST %BASE%/progress/sessions/!SESSION_ID!/stop -H "Authorization: Bearer %TOKEN%" > progress_stop.json
type progress_stop.json
echo.
echo.

echo === GET /progress/sessions/me ===
curl.exe -s %BASE%/progress/sessions/me -H "Authorization: Bearer %TOKEN%"
echo.
echo.

echo === GET /progress/summary?days=7 ===
curl.exe -s %BASE%/progress/summary?days=7 -H "Authorization: Bearer %TOKEN%"
echo.
echo.
echo Progress tracking OK.

endlocal
