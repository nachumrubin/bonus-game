# Builds the signed Play bundle (android/app/build/outputs/bundle/release/app-release.aab).
# Asks for the upload-key passwords; they live only in this PowerShell process.
#   powershell -ExecutionPolicy Bypass -File scripts\build-android-release.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$keystore = Join-Path $repo 'android\android.keystore'
if (-not (Test-Path $keystore)) { throw "Upload key not found: $keystore" }

function Read-Plain([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$alias = Read-Host 'Key alias (Enter for "android")'
if (-not $alias) { $alias = 'android' }
$storePw = Read-Plain 'Keystore password'
$keyPw = Read-Plain 'Key password (Enter if the same)'
if (-not $keyPw) { $keyPw = $storePw }

$env:BOOST_KEY_ALIAS = $alias
$env:BOOST_STORE_PASSWORD = $storePw
$env:BOOST_KEY_PASSWORD = $keyPw

# Gradle 8.11.1 (AGP 8.9.1) from the local wrapper cache, JDK 21.
$gradle = Get-ChildItem "$HOME\.gradle\wrapper\dists\gradle-8.11.1-bin\*\gradle-8.11.1\bin\gradle.bat" | Select-Object -First 1
if (-not $gradle) { throw 'Gradle 8.11.1 not found in ~/.gradle/wrapper/dists (open android/ in Android Studio once to download it).' }
if (-not $env:JAVA_HOME) {
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft\jdk-21*' -Directory | Select-Object -First 1
  if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}

try {
  Push-Location (Join-Path $repo 'android')
  & $gradle.FullName --no-daemon :app:bundleRelease
  if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE). A wrong password shows as 'keystore password was incorrect'." }
} finally {
  Pop-Location
  Remove-Item Env:BOOST_STORE_PASSWORD, Env:BOOST_KEY_PASSWORD, Env:BOOST_KEY_ALIAS -ErrorAction SilentlyContinue
}

$aab = Join-Path $repo 'android\app\build\outputs\bundle\release\app-release.aab'
Write-Host ''
Write-Host "Done: $aab" -ForegroundColor Green
Write-Host 'Upload it in Play Console > Testing > Internal testing > Create new release.'
