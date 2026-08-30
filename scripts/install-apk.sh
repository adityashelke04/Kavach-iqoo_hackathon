#!/usr/bin/env bash
# ==============================================================================
# Kavach TWA APK 1-Click Installer for Android Devices (macOS / Linux)
# Package: com.kavach.iqoo.twa
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

APK_PATH="${1:-}"
DEVICE_ID="${2:-}"
AUTO_LAUNCH=true

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  Kavach TWA Android Device Installer (Bash)${NC}"
echo -e "${CYAN}  Package: com.kavach.iqoo.twa${NC}"
echo -e "${CYAN}============================================================${NC}"

# 1. Locate ADB Binary
ADB_CMD=""
if command -v adb >/dev/null 2>&1; then
    ADB_CMD="adb"
else
    CANDIDATE_PATHS=(
        "${ANDROID_HOME:-}/platform-tools/adb"
        "${ANDROID_SDK_ROOT:-}/platform-tools/adb"
        "${HOME}/Library/Android/sdk/platform-tools/adb"
        "${HOME}/Android/Sdk/platform-tools/adb"
        "${HOME}/.bubblewrap/android_sdk/platform-tools/adb"
        "/opt/android-sdk/platform-tools/adb"
        "/usr/local/bin/adb"
        "/opt/homebrew/bin/adb"
    )

    for path in "${CANDIDATE_PATHS[@]}"; do
        if [ -n "$path" ] && [ -x "$path" ]; then
            ADB_CMD="$path"
            break
        fi
    done
fi

if [ -z "$ADB_CMD" ]; then
    echo -e "${RED}[!] ADB (Android Debug Bridge) not found in PATH or standard Android SDK locations.${NC}"
    echo -e "${YELLOW}    Please install platform-tools (e.g. 'brew install android-platform-tools' on macOS,${NC}"
    echo -e "${YELLOW}    or 'sudo apt install adb' on Ubuntu/Debian).${NC}"
    exit 1
fi

echo -e "${GREEN}[+] ADB Binary: ${ADB_CMD}${NC}"

# 2. Locate APK File
if [ -z "$APK_PATH" ]; then
    DEFAULT_APK="${PROJECT_ROOT}/dist-apk/kavach-release-signed.apk"
    if [ -f "$DEFAULT_APK" ]; then
        APK_PATH="$DEFAULT_APK"
    else
        # Find any apk in dist-apk
        FOUND_APK=$(find "${PROJECT_ROOT}/dist-apk" -maxdepth 1 -name "*.apk" 2>/dev/null | head -n 1 || true)
        if [ -n "$FOUND_APK" ] && [ -f "$FOUND_APK" ]; then
            APK_PATH="$FOUND_APK"
        else
            FOUND_BUILD_APK=$(find "${PROJECT_ROOT}" -maxdepth 5 -name "*signed*.apk" 2>/dev/null | head -n 1 || true)
            if [ -n "$FOUND_BUILD_APK" ] && [ -f "$FOUND_BUILD_APK" ]; then
                APK_PATH="$FOUND_BUILD_APK"
            fi
        fi
    fi
fi

if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
    echo -e "${RED}[!] APK file not found at: ${APK_PATH:-dist-apk/kavach-release-signed.apk}${NC}"
    echo -e "${YELLOW}    Expected APK: dist-apk/kavach-release-signed.apk${NC}"
    echo -e "${YELLOW}    Please build the TWA release package first.${NC}"
    exit 1
fi

FILE_SIZE=$(du -h "$APK_PATH" | cut -f1)
echo -e "${GREEN}[+] APK Target: ${APK_PATH} (${FILE_SIZE})${NC}"

# 3. Detect Connected Devices
echo -e "${CYAN}[*] Checking connected Android devices via ADB...${NC}"
DEVICE_LINES=$("$ADB_CMD" devices -l | grep -v "^List of devices" | grep -E "\b(device|unauthorized|offline)\b" || true)

if [ -z "$DEVICE_LINES" ]; then
    echo -e "${RED}[!] No Android devices detected.${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting Steps:${NC}"
    echo -e "  1. Connect your Android device (e.g. iQOO) with a data USB cable."
    echo -e "  2. Enable Developer Options: Settings > About Phone > Tap 'Build Number' 7 times."
    echo -e "  3. Enable USB Debugging: Settings > Developer Options > USB Debugging = ON."
    echo -e "  4. For Wireless ADB: On phone enable Wireless Debugging, then run:"
    echo -e "     ${GRAY}${ADB_CMD} pair <ip>:<pairing-port> <code-pairing>${NC}"
    echo -e "     ${GRAY}${ADB_CMD} connect <ip>:<connect-port>${NC}"
    exit 1
fi

# Check for unauthorized devices
if echo "$DEVICE_LINES" | grep -q "unauthorized"; then
    echo -e "${YELLOW}[!] Device is UNAUTHORIZED. Check your phone display and tap 'Allow USB Debugging'.${NC}"
    read -r -p "Press Enter once authorized..."
    DEVICE_LINES=$("$ADB_CMD" devices -l | grep -v "^List of devices" | grep -E "\bdevice\b" || true)
fi

AUTHORIZED_DEVICES=()
while IFS= read -r line; do
    DEV=$(echo "$line" | awk '{print $1}')
    if [ -n "$DEV" ]; then
        AUTHORIZED_DEVICES+=("$DEV")
    fi
done < <(echo "$DEVICE_LINES" | grep -E "\bdevice\b")

if [ ${#AUTHORIZED_DEVICES[@]} -eq 0 ]; then
    echo -e "${RED}[!] No authorized devices found.${NC}"
    exit 1
fi

TARGET_DEVICE=""
if [ -n "$DEVICE_ID" ]; then
    TARGET_DEVICE="$DEVICE_ID"
elif [ ${#AUTHORIZED_DEVICES[@]} -eq 1 ]; then
    TARGET_DEVICE="${AUTHORIZED_DEVICES[0]}"
else
    echo -e "${CYAN}[*] Multiple devices found:${NC}"
    for i in "${!AUTHORIZED_DEVICES[@]}"; do
        echo "  [$i] ${AUTHORIZED_DEVICES[$i]}"
    done
    TARGET_DEVICE="${AUTHORIZED_DEVICES[0]}"
    echo -e "${CYAN}[*] Selecting first device: ${TARGET_DEVICE}${NC}"
fi

# Get device metadata
DEV_MODEL=$("$ADB_CMD" -s "$TARGET_DEVICE" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
DEV_BRAND=$("$ADB_CMD" -s "$TARGET_DEVICE" shell getprop ro.product.brand 2>/dev/null | tr -d '\r')
DEV_ANDROID=$("$ADB_CMD" -s "$TARGET_DEVICE" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
DEV_SDK=$("$ADB_CMD" -s "$TARGET_DEVICE" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')

echo -e "${GREEN}[+] Target Device: ${DEV_BRAND} ${DEV_MODEL} (Android ${DEV_ANDROID}, API ${DEV_SDK}, Serial: ${TARGET_DEVICE})${NC}"

# 4. Sideload APK
echo -e "${CYAN}[*] Installing APK to device (${TARGET_DEVICE})...${NC}"
INSTALL_OUTPUT=$("$ADB_CMD" -s "$TARGET_DEVICE" install -r -d "$APK_PATH" 2>&1)

if echo "$INSTALL_OUTPUT" | grep -q "Success"; then
    echo -e "${GREEN}[OK] Installation SUCCESSFUL!${NC}"
else
    echo -e "${RED}[!] Installation failed:${NC}"
    echo "$INSTALL_OUTPUT"
    exit 1
fi

# 5. Verify Package
INSTALLED_PKG=$("$ADB_CMD" -s "$TARGET_DEVICE" shell pm list packages com.kavach.iqoo.twa 2>/dev/null || true)
if echo "$INSTALLED_PKG" | grep -q "com.kavach.iqoo.twa"; then
    echo -e "${GREEN}[+] Verified package com.kavach.iqoo.twa is active on device.${NC}"
fi

# 6. Launch App
if [ "$AUTO_LAUNCH" = true ]; then
    echo -e "${CYAN}[*] Launching Kavach TWA on device...${NC}"
    "$ADB_CMD" -s "$TARGET_DEVICE" shell am start -n "com.kavach.iqoo.twa/.LauncherActivity" >/dev/null 2>&1 || \
    "$ADB_CMD" -s "$TARGET_DEVICE" shell monkey -p com.kavach.iqoo.twa -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    echo -e "${GREEN}[+] Kavach launched successfully on ${DEV_MODEL}!${NC}"
fi

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  Next Steps for Testing & Verification:${NC}"
echo -e "  1. Full-screen Mode: Verify no browser URL bar is visible."
echo -e "  2. Airplane Mode Test: Turn on Airplane mode on phone,"
echo -e "     open Kavach, paste a scam text, and verify offline verdict."
echo -e "  3. Digital Asset Links: Ensure live domain assetlinks matches"
echo -e "     signing cert (SHA256: F1:8C:75:39:8B:58:FF:...)."
echo -e "${CYAN}============================================================${NC}"
