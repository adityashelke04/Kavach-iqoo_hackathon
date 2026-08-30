import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const twaDir = path.join(rootDir, 'android-twa');
const distApkDir = path.join(rootDir, 'dist-apk');
const keystorePath = path.join(rootDir, 'android-keystore', 'kavach-release-key.keystore');

console.log('=== Kavach APK Build & Verification Pipeline ===');

// 1. Ensure keystore exists
if (!fs.existsSync(keystorePath)) {
  console.log('[*] Keystore not found. Generating release keystore...');
  const keytoolCmd = 'C:\\Program Files\\Java\\jdk-17\\bin\\keytool.exe';
  const res = spawnSync(keytoolCmd, [
    '-genkeypair', '-v',
    '-keystore', keystorePath,
    '-alias', 'kavach',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', 'kavach2026',
    '-keypass', 'kavach2026',
    '-dname', 'CN=Kavach, OU=Security, O=Kavach, L=Bengaluru, ST=Karnataka, C=IN'
  ], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('[!] Failed to generate keystore');
    process.exit(1);
  }
}

// 2. Ensure TWA project exists
if (!fs.existsSync(path.join(twaDir, 'gradlew.bat'))) {
  console.log('[*] Generating Android TWA project...');
  const genRes = spawnSync('node', ['scripts/generate-twa-project.mjs'], { cwd: rootDir, stdio: 'inherit' });
  if (genRes.status !== 0) {
    console.error('[!] Failed to generate TWA project');
    process.exit(1);
  }
}

// 3. Build APK with Gradle
console.log('[*] Running Gradle build (assembleRelease assembleDebug)...');
const env = {
  ...process.env,
  JAVA_HOME: 'C:\\Program Files\\Java\\jdk-17',
  ANDROID_HOME: 'C:\\Users\\adibo\\.bubblewrap\\android_sdk'
};

const gradlew = path.join(twaDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleRes = spawnSync(gradlew, ['assembleRelease', 'assembleDebug'], {
  cwd: twaDir,
  env,
  shell: true,
  stdio: 'inherit'
});

if (gradleRes.status !== 0) {
  console.error('[!] Gradle build failed');
  process.exit(1);
}

// 4. Export APKs to dist-apk/
if (!fs.existsSync(distApkDir)) {
  fs.mkdirSync(distApkDir, { recursive: true });
}

const releaseSrc = path.join(twaDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const debugSrc = path.join(twaDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const releaseDst = path.join(distApkDir, 'kavach-release-signed.apk');
const debugDst = path.join(distApkDir, 'kavach-debug.apk');

if (fs.existsSync(releaseSrc)) {
  fs.copyFileSync(releaseSrc, releaseDst);
  const sizeMb = (fs.statSync(releaseDst).size / (1024 * 1024)).toFixed(2);
  console.log(`[+] Exported: ${releaseDst} (${sizeMb} MB)`);
}

if (fs.existsSync(debugSrc)) {
  fs.copyFileSync(debugSrc, debugDst);
  const sizeMb = (fs.statSync(debugDst).size / (1024 * 1024)).toFixed(2);
  console.log(`[+] Exported: ${debugDst} (${sizeMb} MB)`);
}

// 5. Verification
const apksigner = 'C:\\Users\\adibo\\.bubblewrap\\android_sdk\\build-tools\\34.0.0\\apksigner.bat';
console.log('\n--- Signature Verification ---');
spawnSync(apksigner, ['verify', '--verbose', releaseDst], { shell: true, stdio: 'inherit' });

console.log('\n--- Certificate Fingerprints ---');
spawnSync(apksigner, ['verify', '--print-certs', releaseDst], { shell: true, stdio: 'inherit' });

console.log('\n[OK] Kavach APK build and verification pipeline complete!');
