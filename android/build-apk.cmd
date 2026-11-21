@echo off
REM ============================================================
REM  build-apk.cmd — build ZGO POS (debug / release APK / AAB)
REM  Dung:  build-apk.cmd debug
REM         build-apk.cmd release
REM         build-apk.cmd bundle
REM         build-apk.cmd all
REM ============================================================
setlocal enabledelayedexpansion

set "JAVA_HOME=C:\AndroidBuild\jdk-17.0.20.1+1"
set "ANDROID_HOME=C:\AndroidBuild\sdk"
set "ANDROID_SDK_ROOT=C:\AndroidBuild\sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\build-tools\34.0.0;%PATH%"

cd /d "%~dp0.."

set "TASK=%~1"
if "%TASK%"=="" set "TASK=debug"

echo [1/3] Sync web build (dist -> assets/www)...
node scripts\sync-web.mjs
if errorlevel 1 goto :fail

echo [2/3] Icons/splash (chi khi thieu)...
if not exist "app\src\main\res\mipmap-xxxhdpi\ic_launcher.png" (
    python scripts\gen-icons.py
)

echo [3/3] Gradle build: %TASK%
if /I "%TASK%"=="debug" (
    call gradlew.bat --no-daemon assembleDebug
) else if /I "%TASK%"=="release" (
    call gradlew.bat --no-daemon assembleRelease
) else if /I "%TASK%"=="bundle" (
    call gradlew.bat --no-daemon bundleRelease
) else if /I "%TASK%"=="all" (
    call gradlew.bat --no-daemon assembleDebug assembleRelease bundleRelease
) else (
    echo Unknown task: %TASK%  ^(debug^|release^|bundle^|all^)
    goto :fail
)
if errorlevel 1 goto :fail

echo.
echo === OUTPUT ===
if exist "app\build\outputs\apk\debug" dir /b /s "app\build\outputs\apk\debug\*.apk"
if exist "app\build\outputs\apk\release" dir /b /s "app\build\outputs\apk\release\*.apk"
if exist "app\build\outputs\bundle\release" dir /b /s "app\build\outputs\bundle\release\*.aab"
echo ==============
exit /b 0

:fail
echo BUILD FAILED
exit /b 1
