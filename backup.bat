@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Копия всего архива в один ZIP. Можно указать путь: backup.bat D:\Копии\passat.zip
node --disable-warning=ExperimentalWarning src\cli\backup.js %*
pause
