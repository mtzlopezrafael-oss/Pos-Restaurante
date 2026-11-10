@echo off
rem ============================================================
rem  POS Restaurante - instala lo necesario para desarrollar
rem
rem  Doble clic en este archivo, en la maquina donde programas
rem  (Windows 10 u 11). Hace lo mismo que escribir a mano:
rem      npm install
rem      npm run setup
rem      npm test
rem
rem  La terminal con Windows 7 NO necesita esto: alla se instala
rem  el .exe que genera "npm run dist", que ya trae todo adentro.
rem
rem  Los mensajes van sin acentos a proposito: la consola de
rem  Windows usa otra codificacion y los mostraria como simbolos.
rem ============================================================
setlocal
title POS Restaurante - instalar dependencias

rem Trabaja en la carpeta donde esta este archivo, se abra desde donde se abra.
cd /d "%~dp0"

echo.
echo  POS Restaurante - instalar dependencias
echo  ----------------------------------------
echo.

if not exist "package.json" goto :fuera_de_lugar

rem --- Windows 7 es la version 6.1: ahi no corren las herramientas ---
ver | findstr /c:" 6.1." >nul
if not errorlevel 1 goto :es_win7

rem --- 1. Node.js (lo unico que no se puede bajar con npm) ---
where node >nul 2>nul
if errorlevel 1 goto :sin_node

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p process.versions.node') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto :sin_node
if %NODE_MAJOR% LSS 18 goto :node_viejo
for /f "delims=" %%v in ('node -v') do echo  Node.js %%v encontrado.
echo.

rem --- 2. Paquetes, Electron y SQLite ---
rem "call" es obligatorio: npm es otro archivo .cmd y, sin call, este
rem archivo terminaria en cuanto npm acabe.
echo  [1/3] Descargando paquetes (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fallo_npm
echo.

echo  [2/3] Descargando Electron 22 y SQLite (npm run setup)...
call npm run setup
if errorlevel 1 goto :fallo_setup
echo.

rem --- 3. Las pruebas confirman que Electron y SQLite si cargan ---
echo  [3/3] Verificando la instalacion (npm test)...
call npm test > "%TEMP%\pos-restaurante-pruebas.log" 2>&1
if errorlevel 1 goto :fallo_pruebas
echo        Todo en orden.
echo.

echo  Listo. Para abrir la app desde esta carpeta:
echo      npm run dev     ventana normal, para desarrollar
echo      npm start       pantalla completa, como en la terminal
echo.
choice /c SN /n /m " Abrir la app ahora en modo desarrollo? [S/N] "
if errorlevel 2 goto :fin
call npm run dev
goto :fin

:es_win7
echo  Esta computadora tiene Windows 7.
echo.
echo  Este archivo es para la maquina donde programas (Windows 10 u 11):
echo  las herramientas necesitan Node.js 18 o mas nuevo, que no corre
echo  en Windows 7.
echo.
echo  En esta terminal no hay dependencias que instalar. Genera el
echo  instalador en tu otra maquina con "npm run dist" y ejecuta aqui
echo  el .exe que queda en la carpeta dist: ya trae todo adentro.
goto :fin_error

:sin_node
echo  No se encontro Node.js, que es lo unico que se instala aparte.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :node_manual
choice /c SN /n /m " Instalar Node.js LTS ahora con winget? [S/N] "
if errorlevel 2 goto :node_manual
winget install --id OpenJS.NodeJS.LTS -e --source winget
if errorlevel 1 goto :node_manual
echo.
echo  Node.js quedo instalado. Cierra esta ventana y vuelve a abrir
echo  instalar.bat para que Windows lo reconozca.
goto :fin

:node_manual
echo  Descarga la version LTS desde https://nodejs.org, instalala con las
echo  opciones por defecto y vuelve a abrir este archivo.
goto :fin_error

:node_viejo
for /f "delims=" %%v in ('node -v') do echo  Tienes Node.js %%v y se necesita la version 18 o mas nueva.
echo  Actualizalo desde https://nodejs.org y vuelve a abrir este archivo.
goto :fin_error

:fuera_de_lugar
echo  No encuentro package.json junto a este archivo.
echo  instalar.bat debe estar dentro de la carpeta pos-restaurante.
goto :fin_error

:fallo_npm
echo.
echo  npm install fallo. Lo mas comun es que no haya internet o que un
echo  antivirus o proxy bloquee la descarga. Revisa el error de arriba.
goto :fin_error

:fallo_setup
echo.
echo  No se pudieron descargar Electron o SQLite. Los dos bajan de
echo  github.com: revisa que tengas acceso y vuelve a abrir este archivo.
goto :fin_error

:fallo_pruebas
echo.
echo  La instalacion termino, pero las pruebas fallaron. El detalle esta en:
echo      %TEMP%\pos-restaurante-pruebas.log
goto :fin_error

:fin_error
echo.
pause
endlocal
exit /b 1

:fin
echo.
pause
endlocal
exit /b 0
