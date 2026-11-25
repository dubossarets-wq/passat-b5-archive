@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Справочник Passat B5

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org ^(версия 22.13 или новее^) и запустите снова.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Нужен Node.js версии 22.13 или новее. Сейчас:
  node --version
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости, это займёт минуту...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверьте подключение к интернету.
    pause
    exit /b 1
  )
)

node --disable-warning=ExperimentalWarning src\main.js
echo.
echo Справочник остановлен.
pause
