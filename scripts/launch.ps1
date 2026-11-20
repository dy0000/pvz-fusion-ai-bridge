param([ValidateRange(5,120)][int]$StartupTimeoutSeconds=60)
$ErrorActionPreference='Stop'
$fusionRoot=Split-Path -Parent $PSScriptRoot
$runtimeDirectory=Join-Path $fusionRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$connection=Join-Path $runtimeDirectory 'connection.json'
$expectedGame=Join-Path $fusionRoot 'game\PlantsVsZombiesRH.exe'
$listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 47634 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (-not (Test-Path -LiteralPath $connection)) { throw 'Port 47634 is occupied by another host.' }
    $current=Get-Content -LiteralPath $connection -Raw | ConvertFrom-Json
    if ($current.host -ne '127.0.0.1' -or $current.game -ne 'PVZ-Fusion' -or $current.executable -ne $expectedGame -or $current.host_pid -notin $listener.OwningProcess) { throw 'Existing host target mismatch.' }
    if ($current.state -ne 'ready') { throw "Existing host state: $($current.state). Keep its ownership until release." }
    Write-Output "Fusion bridge already ready; game PID $($current.pid), port 47634."
    exit 0
}
$pythonPath=Join-Path $fusionRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run install.cmd first.' }
$stopRequest=Join-Path $runtimeDirectory 'stop.request'
if (Test-Path -LiteralPath $stopRequest) { Remove-Item -LiteralPath $stopRequest }
$logPrefix=Join-Path $runtimeDirectory ('launch-'+(Get-Date -Format 'yyyyMMdd-HHmmss-ffff'))
$launchId=[guid]::NewGuid().ToString('N')
$runner=Join-Path $PSScriptRoot 'run_bridge.py'
$process=Start-Process -FilePath $pythonPath -ArgumentList @('-u','-X','utf8',('"'+$runner+'"'),'--launch','--launch-id',$launchId) -WorkingDirectory $fusionRoot -WindowStyle Hidden -RedirectStandardOutput "$logPrefix.out.log" -RedirectStandardError "$logPrefix.err.log" -PassThru
$deadline=(Get-Date).AddSeconds($StartupTimeoutSeconds)
do {
    $process.Refresh()
    if ($process.HasExited) { throw "Bridge exited. See $logPrefix.err.log" }
    if (Test-Path -LiteralPath $connection) {
        $current=Get-Content -LiteralPath $connection -Raw | ConvertFrom-Json
        if ($current.launch_id -eq $launchId -and $current.state -eq 'ready' -and $current.executable -eq $expectedGame) { Write-Output 'Fusion bridge ready on port 47634.'; exit 0 }
    }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
throw "Host PID $($process.Id) is still starting; do not start a second host. See $logPrefix.err.log"
