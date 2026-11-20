@echo off
if not exist "%~dp0runtime" mkdir "%~dp0runtime"
type nul > "%~dp0runtime\stop.request"
echo Requested release and normal exit of the isolated game.
