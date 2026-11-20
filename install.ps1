param([string]$GameArchive='', [string]$GamePath='', [string]$PythonPath='', [switch]$RegisterCodex)
$ErrorActionPreference='Stop'
if (-not $PythonPath) {
    $known = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path -LiteralPath $known) { $PythonPath=$known }
    else { $PythonPath=(Get-Command python -ErrorAction Stop).Source }
}
& $PythonPath -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"'
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11+ or pass -PythonPath with its executable.' }
$installArgs=@((Join-Path $PSScriptRoot 'scripts\install.py'))
if ($GameArchive) { $installArgs+=@('--game-archive',$GameArchive) }
if ($GamePath) { $installArgs+=@('--game-path',$GamePath) }
if ($RegisterCodex) { $installArgs+='--register-codex' }
& $PythonPath -X utf8 @installArgs
if ($LASTEXITCODE -ne 0) { throw 'Fusion bridge installation failed.' }
