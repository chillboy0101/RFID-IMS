@echo off
setlocal EnableDelayedExpansion

set BASE=http://localhost:4000
set EMAIL=test_%RANDOM%%RANDOM%@example.com
set PASS=StrongPassword123

echo === GET /auth ===
curl -s %BASE%/auth
echo.
echo.

echo === POST /auth/register ===
curl -s -X POST %BASE%/auth/register -H "Content-Type: application/json" --data "{\"name\":\"Test User\",\"email\":\"!EMAIL!\",\"password\":\"!PASS!\"}" > register.json
type register.json
echo.

for /f "usebackq delims=" %%T in (`node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('register.json','utf8'));process.stdout.write(j.token||'')"`) do set TOKEN=%%T

if "!TOKEN!"=="" (
  echo.
  echo Register did not return token.
  exit /b 1
)

echo TokenLength=!TOKEN:~0,1!
echo.

echo === POST /auth/login ===
curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" --data "{\"email\":\"!EMAIL!\",\"password\":\"!PASS!\"}" > login.json
type login.json
echo.

for /f "usebackq delims=" %%T in (`node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('login.json','utf8'));process.stdout.write(j.token||'')"`) do set TOKEN2=%%T

if "!TOKEN2!"=="" (
  echo.
  echo Login did not return token.
  exit /b 1
)

echo.
echo === GET /auth/me ===
curl -s %BASE%/auth/me -H "Authorization: Bearer !TOKEN2!"
echo.
echo.
echo Auth flow OK.

endlocal
