# NAKA Drama Studio — local single-service redeploy (Windows)
#   powershell -ExecutionPolicy Bypass -File scripts\redeploy.ps1 [-SkipInstall] [-SkipBuild]
# 1) SQLite snapshot  2) frontend generate → frontend/dist, admin generate  3) restart backend on PORT (default 5679), detached
#
# The backend lives in kimyohant/naka-ai-backend: clone it next to this repo (..\naka-ai-backend) or set NAKA_BACKEND_DIR.
# Data stays where it always was — this repo's data\ (SQLite, generated files, online-edited workspace) — via
# NAKA_DATA_DIR / SQLITE_PATH / WORKSPACE_PATH; backend secrets (ADMIN_TOKEN, NAKA_SSO_*) go in naka-ai-backend\backend\.env
param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [int]$Port = 5679
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = if ($env:NAKA_BACKEND_DIR) { $env:NAKA_BACKEND_DIR } else { Join-Path (Split-Path -Parent $root) 'naka-ai-backend\backend' }
$admin = Join-Path (Split-Path -Parent $backend) 'admin'
$frontend = Join-Path $root 'frontend'
$data = Join-Path $root 'data'
$db = Join-Path $data 'naka.sqlite3'
$workspace = Join-Path $data 'workspace'
$log = Join-Path $root 'backend.log'
if (-not (Test-Path (Join-Path $backend 'src\index.ts'))) {
  throw "backend not found at $backend — git clone https://github.com/kimyohant/naka-ai-backend next to this repo (or set NAKA_BACKEND_DIR)"
}

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

# workspace (agent prompts + skills, editable online) used to be backend\workspace inside this repo:
# keep a writable copy under data\ — seeded once (from the old backend\workspace if it is still on disk,
# else the backend's template), never overwritten afterwards
if (-not (Test-Path (Join-Path $workspace '.template-version'))) {
  $legacy = Join-Path $root 'backend\workspace'
  $source = if (Test-Path (Join-Path $legacy 'skills')) { $legacy } else { Join-Path $backend 'workspace' }
  Step "seed workspace $source → $workspace"
  New-Item -ItemType Directory -Force $workspace | Out-Null
  Copy-Item -Recurse -Force (Join-Path $source '*') $workspace
  New-Item -ItemType File -Force (Join-Path $workspace '.template-version') | Out-Null
}

# backend .env used to be backend\.env inside this repo (gitignored, so it survives the pull): carry it over once
$legacyEnv = Join-Path $root 'backend\.env'
$backendEnv = Join-Path $backend '.env'
if ((Test-Path $legacyEnv) -and -not (Test-Path $backendEnv)) {
  Step "copy $legacyEnv → $backendEnv"
  Copy-Item $legacyEnv $backendEnv
}

if (Test-Path $db) {
  Step 'SQLite snapshot'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path $root 'data\backups'
  New-Item -ItemType Directory -Force $backupDir | Out-Null
  Push-Location $backend
  npm run db:snapshot -- backup $db (Join-Path $backupDir "naka-before-redeploy-$stamp.sqlite3")
  if ($LASTEXITCODE) { throw 'db snapshot failed' }
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
$env:SQLITE_PATH = $db
$env:WORKSPACE_PATH = $workspace
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
