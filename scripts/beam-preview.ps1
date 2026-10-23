param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [ValidateRange(1024, 65535)][int]$ModelPort = 8001,
    [string]$NodePath,
    [switch]$Open
)
$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$appDirectory = Join-Path $repoDirectory 'teaching-agent'
$serviceDirectory = Join-Path $repoDirectory 'model-service'
$runtimeDirectory = Join-Path $repoDirectory '.beam-local'
$stateFile = Join-Path $runtimeDirectory 'processes.json'
$url = "http://127.0.0.1:$Port/beam-lab"

function Save-Processes($entries) {
    ConvertTo-Json -InputObject @($entries) -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding utf8
}
function Test-Ready([string]$Address) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $Address -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}
function Stop-OwnedProcesses {
    if (-not (Test-Path -LiteralPath $stateFile)) { return }
    $entries = Get-Content -Raw -LiteralPath $stateFile -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $entries) {
        if ($null -eq $entry) { continue }
        $ownedProcess = Get-Process -Id $entry.processId -ErrorAction SilentlyContinue
        if ($ownedProcess -and $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.startedTicks) {
            try { Stop-Process -Id $ownedProcess.Id -ErrorAction Stop }
            catch {
                # A venv launcher may exit together with its already-stopped child.
                if (Get-Process -Id $entry.processId -ErrorAction SilentlyContinue) { throw }
            }
        }
    }
    Save-Processes @()
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if ($Action -eq 'Stop') { Stop-OwnedProcesses; Write-Output '本地配筋实验已停止。'; exit 0 }
if ($Action -eq 'Status') {
    [PSCustomObject]@{ Url = $url; WebsiteReady = (Test-Ready "http://127.0.0.1:$Port/api/health"); ModelsReady = (Test-Ready "http://127.0.0.1:$ModelPort/health") } | Format-List
    exit 0
}
if ($Port -eq $ModelPort) { throw '网站端口与模型端口必须不同。' }
if (Test-Ready "http://127.0.0.1:$Port/api/beam/health") {
    Write-Output "预览已运行：$url"
    if ($Open) { Start-Process $url }
    exit 0
}
foreach ($listenPort in @($Port, $ModelPort)) {
    if (Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue) {
        throw "端口 $listenPort 已被占用。请先停止原预览，或为脚本指定其它端口。"
    }
}
if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    else {
        $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $bundledNode) { $NodePath = (Resolve-Path -LiteralPath $bundledNode).Path }
    }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { throw '请安装 Node.js 24，或通过 -NodePath 指定 node.exe。' }
$pythonPath = Join-Path $serviceDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '未找到独立 Python 环境，请先按 docs/beam-lab.md 安装推理依赖。' }
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory '.next\BUILD_ID'))) { throw '请先在 teaching-agent 目录执行 npm ci 和 npm run build。' }

$owned = @()
try {
    $env:PYTHONUTF8 = '1'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:BEAM_SERVICE_URL = "http://127.0.0.1:$ModelPort"
    $modelProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-X', 'utf8', '-m', 'uvicorn', 'beam_service.app:app', '--host', '127.0.0.1', '--port', "$ModelPort") -WorkingDirectory $serviceDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'models.out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'models.err.log')
    $owned += [PSCustomObject]@{ role = 'models-launcher'; processId = $modelProcess.Id; startedTicks = $modelProcess.StartTime.ToUniversalTime().Ticks.ToString() }
    Save-Processes $owned
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not (Test-Ready "http://127.0.0.1:$ModelPort/health")) {
        if ([DateTime]::UtcNow -gt $deadline -or $modelProcess.HasExited) { throw '模型服务启动失败，请查看 .beam-local/models.err.log。' }
        Start-Sleep -Milliseconds 250
    }
    $modelOwner = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $ModelPort -State Listen | Select-Object -First 1
    if ($modelOwner.OwningProcess -ne $modelProcess.Id) {
        $child = Get-Process -Id $modelOwner.OwningProcess
        $owned += [PSCustomObject]@{ role = 'models'; processId = $child.Id; startedTicks = $child.StartTime.ToUniversalTime().Ticks.ToString() }
    }
    $nextCli = Join-Path $appDirectory 'node_modules\next\dist\bin\next'
    $webProcess = Start-Process -FilePath $NodePath -ArgumentList @(('"' + $nextCli + '"'), 'start', '--hostname', '127.0.0.1', '--port', "$Port") -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'website.out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'website.err.log')
    $owned += [PSCustomObject]@{ role = 'website'; processId = $webProcess.Id; startedTicks = $webProcess.StartTime.ToUniversalTime().Ticks.ToString() }
    Save-Processes $owned
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not (Test-Ready "http://127.0.0.1:$Port/api/beam/health")) {
        if ([DateTime]::UtcNow -gt $deadline -or $webProcess.HasExited) { throw '网站启动失败，请查看 .beam-local/website.err.log。' }
        Start-Sleep -Milliseconds 250
    }
    Write-Output "本地预览已就绪：$url"
    Write-Output '停止命令：.\scripts\beam-preview.ps1 -Action Stop'
    if ($Open) { Start-Process $url }
} catch {
    Stop-OwnedProcesses
    throw
}
