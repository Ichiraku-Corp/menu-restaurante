@echo off
echo Deteniendo el puente (para actualizarlo)...
schtasks /Change /TN "Ichiraku Puente" /DISABLE >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*puente.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Puente detenido. Para volver a encenderlo: instalar-puente.bat
pause
