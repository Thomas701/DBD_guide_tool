$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$global:dbdMockNodeReady = $false
$global:dbdMockChromeReady = $false
$global:dbdMockInstalls = @()

function Invoke-MockNode {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "-p") { Write-Output 20; return }
  if (($args -join " ") -like "*statisticsBrowserExecutable*" -and -not $global:dbdMockChromeReady) {
    $global:LASTEXITCODE = 1
  }
}

function Invoke-MockWinget {
  $package = $args[[Array]::IndexOf($args, "--id") + 1]
  $global:dbdMockInstalls += $package
  if ($package -eq "OpenJS.NodeJS.LTS") { $global:dbdMockNodeReady = $true }
  elseif ($package -eq "Google.Chrome") { $global:dbdMockChromeReady = $true }
  else { throw "Installation inattendue : $package" }
  $global:LASTEXITCODE = 0
}

function Invoke-UnexpectedInstall { throw "Les dependances preparees ne devraient pas etre reinstallees." }

function Get-Command {
  [CmdletBinding()]
  param([string]$Name)
  switch ($Name) {
    "node.exe" { if ($global:dbdMockNodeReady) { [pscustomobject]@{ Source = "Invoke-MockNode" } }; return }
    "winget.exe" { [pscustomobject]@{ Source = "Invoke-MockWinget" }; return }
    "npm.cmd" { [pscustomobject]@{ Source = "Invoke-UnexpectedInstall" }; return }
    "npx.cmd" { [pscustomobject]@{ Source = "Invoke-UnexpectedInstall" }; return }
    default { throw "Commande inattendue : $Name" }
  }
}

& (Join-Path $projectRoot "scripts\bootstrap.ps1") -PrepareOnly
if ($LASTEXITCODE -ne 0) { throw "Le lanceur a echoue avec Node.js et Chrome initialement absents." }
if (($global:dbdMockInstalls -join ",") -ne "OpenJS.NodeJS.LTS,Google.Chrome") {
  throw "Le lanceur n'a pas prepare Node.js puis Google Chrome."
}
& (Join-Path $projectRoot "scripts\bootstrap.ps1") -PrepareOnly
if ($LASTEXITCODE -ne 0 -or $global:dbdMockInstalls.Count -ne 2) {
  throw "Le second lancement a relance une installation inutilement."
}
Write-Host "Simulation validee : installation de Node.js et Google Chrome absents, puis reutilisation au second lancement."
