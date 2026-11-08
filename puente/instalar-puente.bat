@echo off
cd /d "%~dp0"
echo Instalando el puente de impresion como tarea de Windows...
echo (Hay que abrir este archivo con clic derecho, Ejecutar como administrador)
schtasks /Create /TN "IchirakuPuenteRevision" /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" /SC MINUTE /MO 5 /F
schtasks /Create /TN "Ichiraku Puente al entrar" /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" /SC ONLOGON /F
wscript.exe "%~dp0iniciar-oculto.vbs"
echo.
echo Listo. El puente funciona en segundo plano, sin ventana.
echo Windows lo revisa cada 5 minutos y lo enciende si hace falta.
echo Para ver lo que hace: doble clic en ver-registro.bat
pause
