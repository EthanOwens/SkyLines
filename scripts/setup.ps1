# Sets up a Windows machine to build SkyLines. Safe to re-run.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Install-Winget($id, $extra = @()) {
  winget install --id $id -e --accept-package-agreements --accept-source-agreements @extra
  # -1978335189 = already installed, no upgrade available
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget failed to install $id" }
}

try {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is missing. Install 'App Installer' from the Microsoft Store, then re-run." }

  Install-Winget "Microsoft.VisualStudio.2022.BuildTools" @("--override", "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
  Install-Winget "Rustlang.Rustup"
  Install-Winget "OpenJS.NodeJS.LTS"
  Update-Path

  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "cargo is not on PATH. Open a new terminal and re-run." }
  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
  if ($nodeMajor -lt 24) { throw "Node 24 or newer is required (found $nodeMajor). Install the latest Node from https://nodejs.org, then re-run." }

  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

  if (-not (Test-Path .env.local)) {
    Write-Warning "Missing .env.local in the repo root. Ask the person who shared SkyLines with you for it, and put it next to package.json."
  }

  npx tauri info
  Write-Host "Setup done. Run: npm run tauri dev"
} catch {
  Write-Error "Setup stopped: $_"
  exit 1
}
