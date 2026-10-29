param([switch]$SkipRustBuild)
$ErrorActionPreference = 'Stop'
$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $SkipRustBuild) {
  & cargo build --locked --release --manifest-path (Join-Path $desktopRoot 'Cargo.toml') -p helious-windows
  if ($LASTEXITCODE -ne 0) { throw 'Native Windows build failed.' }
}
$appExe = Join-Path $desktopRoot 'target/release/Helious.exe'
$bundle = Join-Path $desktopRoot 'target/installers'
New-Item -ItemType Directory -Force -Path $bundle | Out-Null
$nsis = Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $nsis) {
  $nsisCandidates = @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")
  $nsis = $nsisCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $nsis) { throw 'Install NSIS 3 and put makensis.exe on PATH.' }
$candle = Get-Command candle.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
$light = Get-Command light.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $candle) {
  $wixRoots = @("$env:LOCALAPPDATA\tauri\WixTools314", "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin", "$env:WIX\bin")
  $wixRoot = $wixRoots | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'candle.exe') } | Select-Object -First 1
  if ($wixRoot) { $candle = Join-Path $wixRoot 'candle.exe'; $light = Join-Path $wixRoot 'light.exe' }
}
if (-not $candle -or -not $light) { throw 'Install WiX Toolset 3.14 and put candle.exe/light.exe on PATH.' }
Push-Location (Join-Path $desktopRoot 'installers')
try {
  & $nsis "/DVERSION=$version" "/DOUTFILE=$bundle\Helious_${version}_x64-setup.exe" "/DAPP_EXE=$appExe" 'windows.nsi'
  if ($LASTEXITCODE -ne 0) { throw 'NSIS packaging failed.' }
  & $candle '-arch' 'x64' "-dVersion=$version" "-dAppExe=$appExe" "-dAppIcon=$desktopRoot\assets\icons\icon.ico" '-out' "$bundle\windows.wixobj" 'windows.wxs'
  if ($LASTEXITCODE -ne 0) { throw 'WiX compilation failed.' }
  & $light '-sval' '-out' "$bundle\Helious_${version}_x64_en-US.msi" "$bundle\windows.wixobj"
  if ($LASTEXITCODE -ne 0) { throw 'MSI packaging failed.' }
} finally { Pop-Location }
Get-ChildItem -LiteralPath $bundle | Where-Object { $_.Extension -in @('.exe','.msi') } | Select-Object Name,Length
