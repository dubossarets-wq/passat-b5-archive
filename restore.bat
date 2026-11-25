@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="" (
  echo Использование: restore.bat путь\к\архиву.zip
  echo Перетащите файл архива на restore.bat или укажите путь после команды.
  pause
  exit /b 1
)
echo Перед восстановлением остановите архив ^(закройте окно start.bat^).
echo Текущие данные будут сохранены в data\backups\before-restore-...
pause
node --disable-warning=ExperimentalWarning src\cli\restore.js "%~1"
pause
