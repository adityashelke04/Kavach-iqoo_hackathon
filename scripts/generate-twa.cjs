const path = require('path');
const fs = require('fs');

const core = require('C:/Users/adibo/AppData/Local/npm-cache/_npx/881cef4662d2c421/node_modules/@bubblewrap/core');

const workspaceRoot = path.resolve(__dirname, '..');
const androidTwaDir = path.join(workspaceRoot, 'android-twa');
const manifestPath = path.join(androidTwaDir, 'twa-manifest.json');

async function main() {
  console.log('Reading twa-manifest.json from:', manifestPath);
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const twaManifest = new core.TwaManifest(rawManifest);
  const validationErr = twaManifest.validate();
  if (validationErr) {
    throw new Error('TwaManifest validation error: ' + validationErr);
  }
  console.log('TwaManifest validation passed.');

  // Mock fetchUtils so local icon files and web manifest are served properly without network dependencies
  core.fetchUtils.fetch = async function(url) {
    const urlStr = url.toString();
    console.log('Fetching URL:', urlStr);

    if (urlStr.includes('icon-512.png')) {
      const iconPath = path.join(workspaceRoot, 'public/icons/icon-512.png');
      const buf = fs.readFileSync(iconPath);
      return {
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
        buffer: async () => buf,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        text: async () => buf.toString('utf8'),
      };
    }

    if (urlStr.includes('icon-maskable-512.png')) {
      const iconPath = path.join(workspaceRoot, 'public/icons/icon-maskable-512.png');
      const buf = fs.readFileSync(iconPath);
      return {
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
        buffer: async () => buf,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        text: async () => buf.toString('utf8'),
      };
    }

    if (urlStr.includes('manifest.webmanifest') || urlStr.includes('manifest.json')) {
      const manifestPath = path.join(workspaceRoot, 'public/manifest.json');
      const text = fs.readFileSync(manifestPath, 'utf8');
      return {
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/manifest+json' : null) },
        buffer: async () => Buffer.from(text),
        arrayBuffer: async () => Buffer.from(text).buffer,
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    }

    throw new Error('Unexpected URL requested: ' + urlStr);
  };

  const generator = new core.TwaGenerator();
  const log = new core.ConsoleLog('Bubblewrap');

  console.log('Generating Android TWA project in:', androidTwaDir);
  await generator.createTwaProject(androidTwaDir, twaManifest, log, (current, total) => {
    console.log(`Progress: ${current} / ${total}`);
  });

  console.log('Android TWA Project successfully created!');
}

main().catch((err) => {
  console.error('Error generating TWA project:', err);
  process.exit(1);
});
