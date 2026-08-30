# Kavach Android TWA Deployment & Testing Guide

**Package Name:** `com.kavach.iqoo.twa`  
**Production URL:** `https://kavach-iqoo-hackathon.vercel.app`  
**Target Hardware:** Android 8.0+ (API 26+), optimized for iQOO & Snapdragon/Dimensity devices with WebGPU support.  
**Signing Certificate SHA-256 Fingerprint:**  
`F1:8C:75:39:8B:58:FF:F3:61:3F:ED:B7:76:BE:CC:72:6D:65:D4:A2:D5:47:A7:8D:2B:B5:0C:21:51:5A:83:15`

---

## 1. Quick Start: 1-Click Automated Installation

If you have ADB installed and your Android device connected via USB or Wi-Fi, run the automated installation script:

### Windows (PowerShell)
```powershell
.\scripts\install-apk.ps1
```

### macOS / Linux (Bash)
```bash
chmod +x ./scripts/install-apk.sh
./scripts/install-apk.sh
```

The script will:
1. Locate ADB on your system.
2. Verify connected device status and authorization.
3. Install `dist-apk/kavach-release-signed.apk` with overwrite permission (`-r`).
4. Automatically launch Kavach in full-screen standalone mode.

---

## 2. Manual Installation Methods

### Method A: Sideloading via USB Debugging (Recommended for Developers)

1. **Enable Developer Options on Android:**
   - Go to **Settings** > **About Phone** > **Software Information**.
   - Tap **Build Number** 7 times until you see *"You are now a developer!"*.
2. **Enable USB Debugging:**
   - Go to **Settings** > **System** > **Developer Options**.
   - Toggle **USB Debugging** to **ON**.
3. **Connect Device to Computer:**
   - Connect the device using a USB-C data cable.
   - On the phone screen, accept the prompt: **"Allow USB debugging?"** and check **"Always allow from this computer"**.
4. **Verify Connectivity:**
   ```bash
   adb devices -l
   ```
   *Expected output:* `[device-serial] device product:... model:...`
5. **Install the Signed Release APK:**
   ```bash
   adb install -r -d dist-apk/kavach-release-signed.apk
   ```
6. **Launch the Application:**
   ```bash
   adb shell am start -n "com.kavach.iqoo.twa/com.google.androidbrowserhelper.trusted.LauncherActivity"
   ```

---

### Method B: Wireless ADB Sideloading (Cable-Free)

Ideal for Android 11+ devices on the same Wi-Fi network:

1. **Enable Wireless Debugging:**
   - Ensure phone and PC are connected to the **same Wi-Fi network**.
   - Go to **Settings** > **Developer Options** > **Wireless Debugging** (Toggle ON).
2. **Pair with Device (One-Time):**
   - Tap **"Pair device with pairing code"**.
   - Note the **IP address & Port** (e.g., `192.168.1.50:37123`) and **6-digit pairing code**.
   - Run on PC:
     ```bash
     adb pair 192.168.1.50:37123
     # Enter pairing code when prompted
     ```
3. **Connect to Wireless ADB:**
   - Note the main IP & Port shown on the Wireless Debugging main screen (e.g., `192.168.1.50:41235`).
   - Run on PC:
     ```bash
     adb connect 192.168.1.50:41235
     ```
4. **Install APK:**
   ```bash
   adb install -r -d dist-apk/kavach-release-signed.apk
   ```

---

### Method C: Direct Sideloading onto Device (For Hackathon Judges)

No computer or ADB required:

#### Option 1: Local Web Server Transfer
1. Run a local HTTP server in the repository directory:
   ```bash
   npx serve dist-apk -p 8080
   # OR
   python -m http.server 8080 --directory dist-apk
   ```
2. Open Chrome on your Android phone and navigate to `http://<YOUR_PC_LOCAL_IP>:8080/kavach-release-signed.apk`.
3. Download and tap **Open** to install.

#### Option 2: Cloud / Direct Share
1. Send `dist-apk/kavach-release-signed.apk` via Google Drive, WhatsApp, Telegram, or Quick Share / Nearby Share.
2. On the Android device:
   - Tap the APK file.
   - When prompted: *"For your security, your phone is not allowed to install unknown apps from this source"*, tap **Settings** and toggle **Allow from this source**.
   - Tap **Install**.

---

## 3. Digital Asset Links & Full-Screen Verification

Kavach utilizes **Trusted Web Activities (TWA)**. When Digital Asset Links verification succeeds, Android hides the Chrome URL address bar, giving the user a 100% native, full-screen standalone app experience.

### Digital Asset Links Specification
The asset links verification file is located at:
`https://kavach-iqoo-hackathon.vercel.app/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.kavach.iqoo.twa",
      "sha256_cert_fingerprints": [
        "F1:8C:75:39:8B:58:FF:F3:61:3F:ED:B7:76:BE:CC:72:6D:65:D4:A2:D5:47:A7:8D:2B:B5:0C:21:51:5A:83:15"
      ]
    }
  }
]
```

### Verification Steps

1. **Verify Asset Links JSON via Google Statement API:**
   ```bash
   curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://kavach-iqoo-hackathon.vercel.app&relation=delegate_permission/common.handle_all_urls"
   ```
   *Expected Response:* HTTP 200 with the matching SHA-256 fingerprint.

2. **Verify on Physical Device via ADB Logcat:**
   Run logcat while launching the app:
   ```bash
   adb logcat -v time | grep -i -E "OriginVerifier|Verification|TWA"
   ```
   *Expected Log:*
   `Verification succeeded for package: com.kavach.iqoo.twa, relation: delegate_permission/common.handle_all_urls`

3. **Visual Verification:**
   - Launch **Kavach** from the Android home screen or app drawer.
   - **Pass Criteria:** The app opens directly into the dark cybersecurity UI (`#0B0B0C`) with **NO browser URL bar** at the top and **NO navigation controls** at the bottom.

---

## 4. Offline & Airplane Mode Testing Procedure

Kavach is designed with an on-device first architecture. The complete detection engine runs locally without contacting any remote cloud server.

### Prerequisites (First Run Cache Warming)
On a brand new installation or cold device:
1. Open Kavach while connected to the internet.
2. Tap **Check** or navigate to `/dev/llm` once to let the browser cache the WebGPU ML model shards into IndexedDB.
3. Once the initial download completes, the model is permanently cached on the device.

### Airplane Mode Test Steps

```
[Connect Online] -> [Open Kavach & Warm Cache] -> [Turn on Airplane Mode] -> [Run Detection] -> [Instant Offline Verdict]
```

1. **Enable Airplane Mode:**
   - Swipe down Android Quick Settings.
   - Tap **Airplane Mode** (Verify Wi-Fi and Mobile Data are both OFF).
2. **Launch Kavach:**
   - Tap the **Kavach** icon on your home screen.
   - Observe that the app launches instantly from ServiceWorker cache.
3. **Test Text Scam Detection (SMS/WhatsApp):**
   - In the text box, paste this high-urgency electricity scam:
     ```
     Dear customer, your electricity power will be disconnected tonight at 9:30 PM from power office because your previous month bill was not updated. Please immediately contact our electricity officer at 9876543210.
     ```
   - Tap **Check Message**.
   - **Verification:**
     - Status shows **"Checking on your phone"** (or device model badge).
     - Result evaluates within ~300ms–800ms.
     - Red **DANGER: SCAM DETECTED** banner displays.
     - Tactic breakdown highlights: **Urgency / Threat**, **Impersonation (Electricity Board)**, and **Unverified Contact Number**.
     - "What usually happens next" shows the predicted escalation script.
4. **Test Real-Time Voice Listen Mode (Offline Speech Recognition):**
   - Switch to the **Listen** tab.
   - Tap **Start Listening** and speak suspicious phrases in Hindi/English:
     *“Aapka bank account freeze ho gaya hai, turant OTP share kijiye.”*
   - Observe the live waveform and threat alert trigger without internet access.

---

## 5. Troubleshooting & Diagnostics

| Symptom | Cause | Resolution |
|---|---|---|
| **Chrome URL bar visible at top** | Digital Asset Links verification not yet cached by Chrome | 1. Ensure phone has internet access for the very first launch.<br>2. Clear Chrome cache: `adb shell pm clear com.android.chrome` and re-launch.<br>3. Verify SHA-256 fingerprint in `assetlinks.json`. |
| **`INSTALL_FAILED_UPDATE_INCOMPATIBLE`** | Previous debug build installed with different signature | Uninstall previous version: `adb uninstall com.kavach.iqoo.twa`, then run `adb install -r dist-apk/kavach-release-signed.apk`. |
| **Device not listed in `adb devices`** | USB debugging disabled or missing OEM driver | 1. Toggle USB debugging OFF and ON.<br>2. Change USB mode to "File Transfer (MTP)".<br>3. Install Google USB Driver on Windows. |
| **WebGPU not available on older device** | Hardware does not support WebGPU API | Kavach automatically falls back to local heuristic/regex rules engine with zero latency. |
