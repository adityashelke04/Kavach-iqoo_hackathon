import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TwaGenerator, TwaManifest, ConsoleLog } from '@bubblewrap/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const twaDir = path.join(rootDir, 'android-twa');
const keystorePath = path.join(rootDir, 'android-keystore', 'kavach-release-key.keystore');

// 1. Start a simple static file server for public assets
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  let filePath = path.join(publicDir, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json'
  };
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(8099, '127.0.0.1', resolve));
console.log('Local asset server listening on http://127.0.0.1:8099');

try {
  if (!fs.existsSync(twaDir)) {
    fs.mkdirSync(twaDir, { recursive: true });
  }

  const manifestData = {
    packageId: 'com.kavach.iqoo.twa',
    host: 'kavach-iqoo-hackathon.vercel.app',
    name: 'Kavach — scam message checker',
    launcherName: 'Kavach',
    themeColor: '#0B0B0C',
    navigationColor: '#0B0B0C',
    navigationColorDark: '#0B0B0C',
    navigationDividerColor: '#00000000',
    navigationDividerColorDark: '#00000000',
    backgroundColor: '#0B0B0C',
    enableNotifications: true,
    startUrl: '/',
    iconUrl: 'http://127.0.0.1:8099/icons/icon-512.png',
    maskableIconUrl: 'http://127.0.0.1:8099/icons/icon-maskable-512.png',
    monochromeIconUrl: 'http://127.0.0.1:8099/icons/icon-monochrome-512.png',
    appVersionName: '1.3.0',
    appVersionCode: 4,
    signingKey: {
      path: keystorePath,
      alias: 'kavach'
    },
    splashScreenFadeOutDuration: 300,
    enableSiteSettingsShortcut: true,
    orientation: 'portrait',
    fingerprints: [
      {
        value: 'F1:8C:75:39:8B:58:FF:F3:61:3F:ED:B7:76:BE:CC:72:6D:65:D4:A2:D5:47:A7:8D:2B:B5:0C:21:51:5A:83:15'
      }
    ],
    shortcuts: [
      {
        name: 'Check Message',
        shortName: 'Check',
        url: 'https://kavach-iqoo-hackathon.vercel.app/',
        chosenIconUrl: 'http://127.0.0.1:8099/icons/icon-192.png'
      }
    ],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: 'http://127.0.0.1:8099/manifest.json',
    fallbackType: 'customtabs',
    features: {
      locationDelegation: {
        enabled: false
      },
      playBilling: {
        enabled: false
      }
    },
    alphaDependencies: {
      enabled: false
    }
  };

  const twaManifest = new TwaManifest(manifestData);
  const log = new ConsoleLog('bubblewrap');
  const generator = new TwaGenerator();

  console.log('Generating Android TWA project into', twaDir);
  await generator.createTwaProject(twaDir, twaManifest, log);
  
  // Save twa-manifest.json inside android-twa
  const savedManifestData = {
    ...manifestData,
    iconUrl: 'https://kavach-iqoo-hackathon.vercel.app/icons/icon-512.png',
    maskableIconUrl: 'https://kavach-iqoo-hackathon.vercel.app/icons/icon-maskable-512.png',
    monochromeIconUrl: 'https://kavach-iqoo-hackathon.vercel.app/icons/icon-monochrome-512.png',
    webManifestUrl: 'https://kavach-iqoo-hackathon.vercel.app/manifest.json',
    shortcuts: [
      {
        name: 'Check Message',
        shortName: 'Check',
        url: 'https://kavach-iqoo-hackathon.vercel.app/',
        chosenIconUrl: 'https://kavach-iqoo-hackathon.vercel.app/icons/icon-192.png'
      }
    ]
  };
  fs.writeFileSync(path.join(twaDir, 'twa-manifest.json'), JSON.stringify(savedManifestData, null, 2));

  console.log('TWA project generated successfully!');
} finally {
  server.close();
}
