@echo off
title Registro del puente Ichiraku (cerrar esta ventana NO apaga el puente)
cd /d "%~dp0"
powershell -NoProfile -Command "Get-Content -Path puente.log -Tail 40 -Wait -Encoding UTF8"
