@echo off
REM AVVIA-BOT.bat - accende il ponte Telegram <-> Sito-calendario (doppio-click su Windows)
cd /d "%~dp0"
if exist ".env" (
  for /f "usebackq tokens=1* delims==" %%a in (".env") do (
    if not "%%a"=="" (
      echo %%a | findstr /b "#" >nul || set "%%a=%%b"
    )
  )
)
if "%API_BASE_URL%"=="" set "API_BASE_URL=http://localhost:3000/api"
if "%TELEGRAM_BOT_TOKEN%"=="" (
  echo [ERRORE] TELEGRAM_BOT_TOKEN mancante nel file .env
  echo Aggiungi la riga: TELEGRAM_BOT_TOKEN^=il_tuo_token
  echo.
  pause
  exit /b 1
)
echo [OK] API=%API_BASE_URL%
echo [INFO] Ponte Telegram attivo. Non chiudere questa finestra.
node scripts\telegram-bot.mjs
pause
