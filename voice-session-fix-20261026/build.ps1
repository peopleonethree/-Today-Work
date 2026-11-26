param(
    [string]$BaseApk=(Join-Path $PSScriptRoot 'baseline\base.apk'),
    [string]$Keystore=$env:TODAYTODO_KEYSTORE,
    [string]$BuildTools=$env:TODAYTODO_ANDROID_BUILD_TOOLS
)
$ErrorActionPreference='Stop'
if (-not $Keystore -or -not $BuildTools) { throw 'Supply -Keystore and -BuildTools, or set TODAYTODO_KEYSTORE and TODAYTODO_ANDROID_BUILD_TOOLS.' }
if (-not $env:TODAYTODO_KEYSTORE_PASSWORD) { throw 'Set TODAYTODO_KEYSTORE_PASSWORD to the existing signing-key password.' }
function Invoke-Verified([string]$Program,[string[]]$ToolArgs) {
    & $Program @ToolArgs
    if($LASTEXITCODE -ne 0) { throw "Command failed: $Program ($LASTEXITCODE)" }
}
$unsigned=Join-Path $PSScriptRoot 'dist\unsigned.apk'
$aligned=Join-Path $PSScriptRoot 'dist\aligned.apk'
$final=Join-Path $PSScriptRoot 'dist\TodayTodo-20261027-qa.apk'
Invoke-Verified 'node' @('--check',(Join-Path $PSScriptRoot 'assets\js\app.js'))
Invoke-Verified 'python' @((Join-Path $PSScriptRoot 'tools\package_apk.py'),'--base',$BaseApk,'--output',$unsigned)
Invoke-Verified (Join-Path $BuildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
Invoke-Verified (Join-Path $BuildTools 'apksigner.bat') @('sign','--ks',$Keystore,'--ks-pass','env:TODAYTODO_KEYSTORE_PASSWORD','--ks-key-alias','releasekey','--key-pass','env:TODAYTODO_KEYSTORE_PASSWORD','--out',$final,$aligned)
Invoke-Verified (Join-Path $BuildTools 'apksigner.bat') @('verify','--verbose','--print-certs',$final)
Invoke-Verified (Join-Path $BuildTools 'zipalign.exe') @('-c','-p','4',$final)
Invoke-Verified 'python' @((Join-Path $PSScriptRoot 'tools\package_apk.py'),'--base',$BaseApk,'--output',$final,'--verify-only')
Write-Output "Verified APK: $final"
