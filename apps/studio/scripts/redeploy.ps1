# NAKA Drama Studio — local single-service redeploy (Windows)
#   powershell -ExecutionPolicy Bypass -File scripts\redeploy.ps1 [-SkipInstall] [-SkipBuild]
# 1) frontend generate → frontend/dist, admin generate  2) restart backend on PORT (default 5679), detached
#
# Data: data\ in this repo (generated files); backend secrets (ADMIN_TOKEN, NAKA_SSO_*) and the database in backend\.env:
# DATABASE_URL=postgres://studio_app:…@127.0.0.1:5432/naka (root docker-compose postgres; back it up with pg_dump),
# unset → PGlite in data\pglite
param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [int]$Port = 5679
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$admin = Join-Path $root 'admin'
$frontend = Join-Path $root 'frontend'
$data = Join-Path $root 'data'
$workspace = Join-Path $data 'workspace'
$log = Join-Path $root 'backend.log'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not $SkipInstall) {
  Step 'npm ci (backend, admin, frontend)'
  Push-Location $backend; npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'backend npm ci failed' }; Pop-Location
  Push-Location $admin; npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'admin npm ci failed' }; Pop-Location
  Push-Location $frontend; npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'frontend npm ci failed' }; Pop-Location
}

if (-not $SkipBuild) {
  Step 'frontend generate'
  Push-Location $frontend
  npm run generate; if ($LASTEXITCODE) { throw 'nuxt generate failed' }
  if (-not (Test-Path '.output\public\index.html')) { throw '.output/public/index.html missing' }
  Pop-Location
  Step 'admin generate (/admin back-office)'
  Push-Location $admin
  npm run generate; if ($LASTEXITCODE) { throw 'admin generate failed' }
  Pop-Location
}

Step "stop server on port $Port"
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
  if ($proc.Name -ne 'node.exe') { throw "port $Port is held by $($proc.Name) (pid $($proc.ProcessId)) — not touching it" }
  # tsx 以子进程运行 src/index.ts：连同父进程（npm/tsx 外壳）一起结束
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
  Stop-Process -Id $proc.ProcessId -Force
  if ($parent -and $parent.CommandLine -match 'tsx|npm') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
}
for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }

if (-not $SkipBuild) {
  Step 'publish frontend/dist'
  $dist = Join-Path $frontend 'dist'
  if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
  Copy-Item -Recurse (Join-Path $frontend '.output\public') $dist
}

Step "start backend (detached) → $log"
$env:PORT = "$Port"
$env:NAKA_DATA_DIR = $data
# a data\workspace copy exists only if the two-repo version of this script ran once — keep using it
if (Test-Path (Join-Path $workspace '.template-version')) { $env:WORKSPACE_PATH = $workspace }
$env:FRONTEND_DIST = Join-Path $frontend 'dist'
$tsx = Join-Path $backend 'node_modules\tsx\dist\cli.mjs'
Start-Process -FilePath 'node' -ArgumentList "`"$tsx`" src/index.ts" -WorkingDirectory $backend `
  -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"

Step 'health check'
for ($i = 0; $i -lt 30; $i++) {
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
    if ($h.status -eq 'ok') { Write-Host "OK  http://localhost:$Port" -ForegroundColor Green; exit 0 }
  } catch { Start-Sleep 2 }
}
Get-Content "$log.err" -Tail 30 -ErrorAction SilentlyContinue
throw 'server did not become healthy'
