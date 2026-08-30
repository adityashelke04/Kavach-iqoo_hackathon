# Kavach Android TWA — Installation & Testing Guide

> **Official Android Package for iQOO Hackathon**  
> **Package ID:** `com.kavach.iqoo.twa`  
> **Production Domain:** `https://kavach-iqoo-hackathon.vercel.app`  
> **APK Artifact:** `dist-apk/kavach-release-signed.apk`  
> **Signing SHA-256:** `F1:8C:75:39:8B:58:FF:F3:61:3F:ED:B7:76:BE:CC:72:6D:65:D4:A2:D5:47:A7:8D:2B:B5:0C:21:51:5A:83:15`

---

## ⚡ 1-Click Installation (Recommended)

Connect your Android phone via USB cable (with USB Debugging enabled) and run:

### Windows (PowerShell)
```powershell
.\scripts\install-apk.ps1
```

### macOS / Linux (Terminal)
```bash
chmod +x ./scripts/install-apk.sh
./scripts/install-apk.sh
```

---

## 📱 Sideloading Methods

### Method 1: Standard USB Debugging
1. On your Android phone, enable **Developer Options** (Settings > About Phone > Tap "Build Number" 7 times).
2. Enable **USB Debugging** (Settings > System > Developer Options > USB Debugging).
3. Connect the phone to your PC and accept the **"Allow USB Debugging"** prompt on the phone screen.
4. Run:
   ```bash
   adb install -r dist-apk/kavach-release-signed.apk
   ```
5. Launch app:
   ```bash
   adb shell am start -n "com.kavach.iqoo.twa/com.google.androidbrowserhelper.trusted.LauncherActivity"
   ```

### Method 2: Wireless ADB (Android 11+)
1. Connect PC and phone to the **same Wi-Fi**.
2. On phone: **Developer Options** > **Wireless Debugging** > **Pair device with pairing code**.
3. Run on PC:
   ```bash
   adb pair <PHONE_IP>:<PAIRING_PORT>
   # Enter 6-digit code shown on phone
   adb connect <PHONE_IP>:<CONNECT_PORT>
   adb install -r dist-apk/kavach-release-signed.apk
   ```

### Method 3: Direct APK Sideload (No PC / Hackathon Judges)
1. Transfer `dist-apk/kavach-release-signed.apk` to the phone via USB, Google Drive, WhatsApp, or local server:
   ```bash
   npx serve dist-apk -p 8080
   # Open http://<PC_IP>:8080/kavach-release-signed.apk on phone
   ```
2. Tap the downloaded APK, enable **"Install unknown apps"**, and tap **Install**.

---

## ✈️ Offline Airplane Mode Verification (Judging Checklist)

Kavach runs on-device AI for instant scam detection without sending private messages to the cloud.

### Quick Test Walkthrough:
1. **Initial Cache Warm (Online):** Open Kavach once with internet enabled to cache the on-device AI model in IndexedDB.
2. **Enable Airplane Mode:** Turn on **Airplane Mode** on the phone (Disable Wi-Fi and Mobile Data).
3. **Open Kavach:** Launch Kavach from the home screen.
4. **Paste Test Scam:**
   ```
   Electricity alert: Your power will be disconnected at 9:30 PM today due to an unpaid bill. Call our electricity officer at 9876543210 immediately to pay and prevent disconnection.
   ```
5. **Tap "Check Message":**
   - ⚡ Analyzes in < 500ms entirely offline.
   - 🔴 Displays **DANGER: SCAM DETECTED** verdict.
   - 🔍 Highlights threat tactic signals (Urgency, Impersonation, Fake Call Number).
   - 🔮 Displays predicted escalation playbook (*"What usually happens next"*).
6. **Test Offline Voice Mode:**
   - Tap **Listen** tab and tap **Start Listening**.
   - Speak suspicious demands (*"Send OTP for account verification"*).
   - Live on-device audio stream detection activates immediately.

---

## 🔒 Digital Asset Links & Standalone Mode

The production domain verifies app ownership via Digital Asset Links:
- **URL:** `https://kavach-iqoo-hackathon.vercel.app/.well-known/assetlinks.json`
- **Verification Status:** Once verified on first launch, Chrome runs the app in **full-screen standalone mode** with **no browser address bar** or navigation bars.

For full technical documentation, see [`docs/TWA_DEPLOYMENT_GUIDE.md`](docs/TWA_DEPLOYMENT_GUIDE.md).
