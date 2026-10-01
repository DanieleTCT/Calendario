@echo off
REM ============================================================
REM  AVVIA-SITO - Calendario AI Powered
REM  Doppio-click per accendere tutto il sito (vedi README 90-150)
REM  Avvia Backend (porta 3000) + Frontend (porta 5173)
REM ============================================================
cd /d "%~dp0"

echo.
echo  ============================================
echo   📅  Calendario AI - Avvio del sito
echo  ============================================
echo.

REM --- 1. Controllo Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERRORE] Node.js non trovato!
  echo  Installalo da https://nodejs.org ^(versione ^>= 18^)
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo  [OK] Node %%v

REM --- 2. File .env ---
if not exist ".env" (
  if exist ".env.example" (
    echo  [INFO] Creo .env da .env.example...
    copy /y ".env.example" ".env" >nul
  ) else (
    echo  [AVVISO] .env.example non trovato, salto.
  )
) else (
  echo  [OK] File .env presente
)

REM --- 3. Dipendenze (solo se mancano) ---
if not exist "node_modules" (
  echo  [INFO] Installo dipendenze monorepo... ^(puo' richiedere qualche minuto^)
  call npm install
  if errorlevel 1 (
    echo  [ERRORE] npm install fallito.
    pause
    exit /b 1
  )
) else (
  echo  [OK] Dipendenze presenti
)

echo.
echo  [INFO] Avvio Backend  - http://localhost:3000 ...
start "Calendario - Backend (3000)" cmd /k "cd /d ""%~dp0apps\api"" && npm run dev"

echo  [INFO] Avvio Frontend - http://localhost:5173 ...
start "Calendario - Frontend (5173)" cmd /k "cd /d ""%~dp0apps\web"" && npm run dev"

echo.
echo  Attendo l'avvio dei server...
timeout /t 8 /nobreak >nul

echo  Apro il browser...
start "" "http://localhost:5173"

echo.
echo  ============================================
echo   ✅ Sito operativo!
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3000
echo.
echo   Per spegnere: chiudi le due finestre
echo   "Calendario - Backend" e "Calendario - Frontend"
echo  ============================================
echo.
pause
