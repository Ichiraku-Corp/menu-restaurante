@echo off
cd /d "%~dp0"
echo Instalando el puente de impresion como tarea de Windows...
schtasks /Create /TN "Ichiraku Puente" /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" /SC MINUTE /MO 5 /F
schtasks /Create /TN "Ichiraku Puente al entrar" /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" /SC ONLOGON /F
wscript.exe "%~dp0iniciar-oculto.vbs"
echo.
echo Listo. El puente funciona en segundo plano, sin ventana.
echo Windows lo revisa cada 5 minutos y lo enciende si hace falta.
echo Para ver lo que hace: doble clic en ver-registro.bat
pause
