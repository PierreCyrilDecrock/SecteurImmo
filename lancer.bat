@echo off
rem Lance SecteurImmo : sert le dossier sur http://localhost:8000 et ouvre le navigateur.
rem (Un vrai serveur local est necessaire : OpenStreetMap bloque les pages ouvertes en file://)
cd /d "%~dp0"
set PORT=8000
where py >nul 2>nul && (set PY=py) || (where python >nul 2>nul && (set PY=python) || (echo Python est introuvable. Installez-le depuis https://www.python.org/downloads/ puis relancez. & pause & exit /b 1))
start "" "http://localhost:%PORT%"
echo SecteurImmo disponible sur http://localhost:%PORT%  (fermez cette fenetre pour arreter)
%PY% -m http.server %PORT% --bind 127.0.0.1
