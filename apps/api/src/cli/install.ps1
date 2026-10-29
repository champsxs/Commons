# Installs the commons CLI from __BASE__ (Windows). No Node.js needed.
#   powershell -c "irm __BASE__/cli/install.ps1 | iex"
$ErrorActionPreference = "Stop"
$base = "__BASE__"
$dir = Join-Path $env:USERPROFILE ".commons\bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Windows on ARM runs the x64 build through its built-in emulation
$exe = Join-Path $dir "commons.exe"
Invoke-WebRequest -Uri "$base/cli/download/windows-x64" -OutFile "$exe.tmp" -UseBasicParsing
Move-Item -Force "$exe.tmp" $exe

# Remember which Commons this came from (written without a byte-order mark, so it reads as plain JSON)
$config = Join-Path $env:USERPROFILE ".commons\config.json"
if (-not (Test-Path $config)) {
  [IO.File]::WriteAllText($config, (@{ url = $base } | ConvertTo-Json))
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $dir) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "Added $dir to your PATH. Open a new terminal to use it."
}
Write-Host "Installed commons $(& $exe --version) to $exe"
Write-Host ""
Write-Host "Next: commons login"
