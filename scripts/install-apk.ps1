<#
.SYNOPSIS
    Kavach TWA APK 1-Click Installer for Android Devices (PowerShell)

.DESCRIPTION
    Automated ADB installer for Kavach (com.kavach.iqoo.twa).
    Detects ADB binary across standard system paths, verifies device connection
    and authorization, installs the signed release APK, and launches the app.

.PARAMETER ApkPath
    Path to the APK file. Defaults to dist-apk/kavach-release-signed.apk.

.PARAMETER DeviceId
    Optional ADB device serial if multiple devices are attached.

.PARAMETER Launch
    Switch to automatically launch Kavach after successful installation.

.EXAMPLE
    .\scripts\install-apk.ps1
    .\scripts\install-apk.ps1 -Launch
    .\scripts\install-apk.ps1 -ApkPath "dist-apk/kavach-release-signed.apk" -DeviceId "192.168.1.50:5555"
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ApkPath = "",

    [Parameter(Position = 1)]
    [string]$DeviceId = "",

    [Parameter()]
    [switch]$Launch = $true
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kavach TWA Android Device Installer (PowerShell)" -ForegroundColor Cyan
Write-Host "  Package: com.kavach.iqoo.twa" -ForegroundColor DarkCyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Locate ADB Binary
$adbCmd = ""
if (Get-Command adb -ErrorAction SilentlyContinue) {
    $adbCmd = "adb"
} else {
    $candidatePaths = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "$env:ANDROID_HOME\platform-tools\adb.exe",
        "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
        "$env:USERPROFILE\.bubblewrap\android_sdk\platform-tools\adb.exe",
        "C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe",
        "C:\Program Files\Android\platform-tools\adb.exe"
    )

    foreach ($path in $candidatePaths) {
        if ($path -and (Test-Path $path)) {
            $adbCmd = $path
            break
        }
    }
}

if (-not $adbCmd) {
    Write-Host "[!] ADB (Android Debug Bridge) not found in PATH or standard Android SDK directories." -ForegroundColor Red
    Write-Host "    Please ensure Android SDK Platform-Tools is installed or add adb to your PATH." -ForegroundColor Yellow
    Write-Host "    Quick setup: Download SDK Platform-Tools from https://developer.android.com/tools/releases/platform-tools" -ForegroundColor Yellow
    exit 1
}

Write-Host "[+] ADB Binary: $adbCmd" -ForegroundColor Green

# 2. Locate APK
if (-not $ApkPath) {
    $defaultApk = Join-Path $ProjectRoot "dist-apk\kavach-release-signed.apk"
    if (Test-Path $defaultApk) {
        $ApkPath = $defaultApk
    } else {
        # Search for any APK in dist-apk or build outputs
        $foundApks = Get-ChildItem -Path (Join-Path $ProjectRoot "dist-apk") -Filter "*.apk" -ErrorAction SilentlyContinue
        if ($foundApks -and $foundApks.Count -gt 0) {
            $ApkPath = $foundApks[0].FullName
        } else {
            $foundBuildApks = Get-ChildItem -Path (Join-Path $ProjectRoot "android*") -Recurse -Filter "*signed*.apk" -ErrorAction SilentlyContinue
            if ($foundBuildApks -and $foundBuildApks.Count -gt 0) {
                $ApkPath = $foundBuildApks[0].FullName
            }
        }
    }
}

if (-not $ApkPath -or -not (Test-Path $ApkPath)) {
    Write-Host "[!] APK not found at target location: $ApkPath" -ForegroundColor Red
    Write-Host "    Expected APK: dist-apk/kavach-release-signed.apk" -ForegroundColor Yellow
    Write-Host "    Run your TWA build script first to generate the signed APK." -ForegroundColor Yellow
    exit 1
}

$apkItem = Get-Item $ApkPath
$apkSizeMB = [math]::Round($apkItem.Length / 1MB, 2)
Write-Host "[+] APK Target: $($apkItem.FullName) ($apkSizeMB MB)" -ForegroundColor Green

# 3. Detect Connected Devices
Write-Host "[*] Checking connected Android devices via ADB..." -ForegroundColor Cyan
$deviceOutput = & $adbCmd devices -l
$deviceLines = $deviceOutput | Where-Object { $_ -match "\s+(device|unauthorized|offline)\s*" -and $_ -notmatch "^List of devices" }

if (-not $deviceLines -or $deviceLines.Count -eq 0) {
    Write-Host "[!] No Android devices detected." -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting Steps:" -ForegroundColor Yellow
    Write-Host "  1. Connect your Android device (e.g., iQOO) via USB cable." -ForegroundColor White
    Write-Host "  2. Enable Developer Options: Settings > About Phone > Tap 'Build Number' 7 times." -ForegroundColor White
    Write-Host "  3. Enable USB Debugging: Settings > System / Developer Options > USB Debugging = ON." -ForegroundColor White
    Write-Host "  4. For Wireless ADB: On phone, enable 'Wireless Debugging', then run:" -ForegroundColor White
    Write-Host "     $adbCmd pair <ip>:<pairing-port> <code-pairing>" -ForegroundColor DarkGray
    Write-Host "     $adbCmd connect <ip>:<connect-port>" -ForegroundColor DarkGray
    exit 1
}

# Check for unauthorized devices
$unauthorized = $deviceLines | Where-Object { $_ -match "\sunauthorized\s" }
if ($unauthorized) {
    Write-Host "[!] Device found but UNAUTHORIZED." -ForegroundColor Yellow
    Write-Host "    Please check your phone screen and tap 'Allow USB Debugging' (check 'Always allow from this computer')." -ForegroundColor Yellow
    Write-Host "    Press Enter once authorized..."
    Read-Host
    $deviceOutput = & $adbCmd devices -l
    $deviceLines = $deviceOutput | Where-Object { $_ -match "\s+device\s+" }
}

$authorizedDevices = @()
foreach ($line in $deviceLines) {
    if ($line -match "^([^\s]+)\s+device\b") {
        $authorizedDevices += $matches[1]
    }
}

if ($authorizedDevices.Count -eq 0) {
    Write-Host "[!] No authorized device available. Please authorize on the device screen." -ForegroundColor Red
    exit 1
}

$targetDevice = ""
if ($DeviceId -and ($authorizedDevices -contains $DeviceId)) {
    $targetDevice = $DeviceId
} elseif ($authorizedDevices.Count -eq 1) {
    $targetDevice = $authorizedDevices[0]
} else {
    Write-Host "[*] Multiple devices detected:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $authorizedDevices.Count; $i++) {
        Write-Host "  [$i] $($authorizedDevices[$i])"
    }
    $targetDevice = $authorizedDevices[0]
    Write-Host "[*] Defaulting to primary device: $targetDevice" -ForegroundColor Cyan
}

# Get Device Properties
$deviceModel = (& $adbCmd -s $targetDevice shell getprop ro.product.model).Trim()
$deviceBrand = (& $adbCmd -s $targetDevice shell getprop ro.product.brand).Trim()
$androidVer  = (& $adbCmd -s $targetDevice shell getprop ro.build.version.release).Trim()
$sdkVer      = (& $adbCmd -s $targetDevice shell getprop ro.build.version.sdk).Trim()

Write-Host "[+] Target Device: $deviceBrand $deviceModel (Android $androidVer, SDK $sdkVer, Serial: $targetDevice)" -ForegroundColor Green

# 4. Install APK
Write-Host "[*] Sideloading APK onto device ($targetDevice)..." -ForegroundColor Cyan
$installResult = & $adbCmd -s $targetDevice install -r -d $ApkPath 2>&1

if ($installResult -match "Success") {
    Write-Host "[OK] Installation SUCCESSFUL!" -ForegroundColor Green
} else {
    Write-Host "[!] Installation failed. ADB Output:" -ForegroundColor Red
    $installResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
}

# 5. Verify Package
$installedPkg = & $adbCmd -s $targetDevice shell pm list packages com.kavach.iqoo.twa
if ($installedPkg -match "com.kavach.iqoo.twa") {
    Write-Host "[+] Verified package com.kavach.iqoo.twa is installed on device." -ForegroundColor Green
}

# 6. Launch App
if ($Launch) {
    Write-Host "[*] Launching Kavach TWA on device..." -ForegroundColor Cyan
    
    # Try launcher activity
    $launchResult = & $adbCmd -s $targetDevice shell am start -n "com.kavach.iqoo.twa/.LauncherActivity" 2>&1
    if ($launchResult -match "Error" -or $launchResult -match "Exception") {
        # Fallback to main activity launcher
        $launchResult = & $adbCmd -s $targetDevice shell monkey -p com.kavach.iqoo.twa -c android.intent.category.LAUNCHER 1 2>&1
    }
    Write-Host "[+] Kavach launched successfully on $deviceModel!" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Next Steps for Testing & Verification:" -ForegroundColor Cyan
Write-Host "  1. Full-screen Mode: Verify no browser URL bar is visible." -ForegroundColor White
Write-Host "  2. Airplane Mode Test: Turn on Airplane mode on phone," -ForegroundColor White
Write-Host "     open Kavach, paste a scam text, and verify offline verdict." -ForegroundColor White
Write-Host "  3. Digital Asset Links: Ensure live domain assetlinks matches" -ForegroundColor White
Write-Host "     signing cert (SHA256: F1:8C:75:39:8B:58:FF:...)." -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
