# Build a release-signed Android AAB + APK locally.
#
# Why this script exists:
#   android/app/build.gradle only uses the RELEASE keystore when the env var
#   ANDROID_KEYSTORE_FILE is set; otherwise it silently falls back to the DEBUG
#   keystore. A debug-signed AAB is rejected by Google Play with:
#   "Has subido un APK o un Android App Bundle firmados en modo de depuracion."
#
#   This script sets the required env vars (prompting for the password securely,
#   so it never appears in your shell history) and runs the Gradle release build,
#   then verifies the resulting bundle is NOT debug-signed.
#
# Usage:
#   ./build-release-signed.ps1                 # builds AAB + APK
#   ./build-release-signed.ps1 -Alias my-alias # override key alias

param(
    [string]$Alias = 'hbbtv-mediasync',
    [string]$Keystore = (Join-Path $PSScriptRoot 'release.keystore')
)

$ErrorActionPreference = 'Stop'

# --- Locate keytool / jarsigner (Android Studio JBR or JAVA_HOME) -------------
function Find-JdkBin([string]$exe) {
    $candidates = @(
        (Join-Path $env:JAVA_HOME "bin\$exe.exe"),
        "C:\Program Files\Android\Android Studio\jbr\bin\$exe.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

if (-not (Test-Path $Keystore)) {
    throw "No se encuentra la keystore en: $Keystore"
}
$Keystore = (Resolve-Path $Keystore).Path

# --- Securely read the keystore password (typed directly, not via history) ----
$secure = Read-Host -AsSecureString "Contrasena de la keystore ($Alias)"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# --- Export the signing env vars consumed by build.gradle ---------------------
$env:ANDROID_KEYSTORE_FILE = $Keystore
$env:ANDROID_KEYSTORE_PASSWORD = $plain
$env:ANDROID_KEY_ALIAS = $Alias
$env:ANDROID_KEY_PASSWORD = $plain

try {
    Write-Host "==> Construyendo AAB + APK de release firmados..." -ForegroundColor Cyan
    Push-Location (Join-Path $PSScriptRoot 'android')
    try {
        & .\gradlew.bat assembleRelease bundleRelease
        if ($LASTEXITCODE -ne 0) { throw "Gradle fallo con codigo $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    $aab = Join-Path $PSScriptRoot 'android\app\build\outputs\bundle\release\app-release.aab'
    $apk = Join-Path $PSScriptRoot 'android\app\build\outputs\apk\release\app-release.apk'

    # --- Verify the signer is NOT the Android debug certificate ---------------
    $jarsigner = Find-JdkBin 'jarsigner'
    if ($jarsigner -and (Test-Path $aab)) {
        Write-Host "`n==> Verificando firma del AAB..." -ForegroundColor Cyan
        $out = & $jarsigner -verify -verbose -certs $aab 2>&1 | Out-String
        if ($out -match 'Android Debug') {
            Write-Host "ATENCION: el AAB sigue firmado con la keystore de DEBUG." -ForegroundColor Red
        } elseif ($out -match 'jar verified') {
            Write-Host "OK: AAB firmado correctamente (no es debug)." -ForegroundColor Green
        } else {
            Write-Host $out
        }
    }

    Write-Host "`nArtefactos generados:" -ForegroundColor Cyan
    if (Test-Path $aab) { Write-Host "  AAB: $aab" -ForegroundColor Green }
    if (Test-Path $apk) { Write-Host "  APK: $apk" -ForegroundColor Green }
}
finally {
    # --- Clean up the password from the environment ---------------------------
    $plain = $null
    Remove-Item Env:ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
