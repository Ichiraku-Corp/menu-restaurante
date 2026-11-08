@echo off
title Puente de impresion Ichiraku
cd /d "%~dp0"
:inicio
node --use-system-ca puente.js
echo El puente se detuvo. Se reinicia en 5 segundos...
timeout /t 5 /nobreak >nul
goto inicio
