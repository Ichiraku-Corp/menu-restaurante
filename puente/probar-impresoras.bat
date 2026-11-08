@echo off
cd /d "%~dp0"
node --use-system-ca puente.js --prueba cocina
node --use-system-ca puente.js --prueba caja
pause
