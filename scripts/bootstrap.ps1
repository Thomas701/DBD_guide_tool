param([switch]$PrepareOnly)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot
$Host.UI.RawUI.WindowTitle = "Build Analyzer"

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Get-NodeMajor {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  $major = & $node.Source -p "Number(process.versions.node.split('.')[0])"
  if ($LASTEXITCODE -ne 0) { return 0 }
  return [int]$major
}

if ((Get-NodeMajor) -lt 20) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "Node.js 20+ est absent et winget est indisponible. Installez 'App Installer' depuis le Microsoft Store, puis relancez ce fichier."
  }

  Write-Host "Installation de Node.js LTS..." -ForegroundColor Cyan
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "L'installation automatique de Node.js a echoue (code $LASTEXITCODE)." }
  Refresh-Path
}

if ((Get-NodeMajor) -lt 20) {
  throw "Node.js a ete installe mais reste introuvable. Fermez cette fenetre puis relancez le fichier .bat."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$lockFile = Join-Path $projectRoot "package-lock.json"
$stampFile = Join-Path $projectRoot "node_modules\.dbd-package-lock.sha256"
$lockHash = (Get-FileHash $lockFile -Algorithm SHA256).Hash
$installedHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { "" }
$requiredFiles = @(
  "node_modules\vite\bin\vite.js",
  "node_modules\typescript\bin\tsc",
  "node_modules\playwright\package.json"
)
$dependenciesMissing = $requiredFiles.Where({ -not (Test-Path (Join-Path $projectRoot $_)) }).Count -gt 0

if ($dependenciesMissing -or $installedHash -ne $lockHash) {
  Write-Host "Installation des dependances du projet..." -ForegroundColor Cyan
  & $npm install --include=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "L'installation des dependances a echoue (code $LASTEXITCODE)." }
  Set-Content -Path $stampFile -Value $lockHash -Encoding ASCII
}

& $node -e "const fs=require('node:fs'); const {chromium}=require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installation du navigateur Chromium..." -ForegroundColor Cyan
  & $npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "L'installation de Chromium a echoue (code $LASTEXITCODE)." }
}

if ($PrepareOnly) {
  Write-Host "Preparation terminee." -ForegroundColor Green
  exit 0
}

Write-Host "Preparation terminee. Demarrage de Build Analyzer..." -ForegroundColor Green
& $node "scripts\start-app.mjs"
exit $LASTEXITCODE
