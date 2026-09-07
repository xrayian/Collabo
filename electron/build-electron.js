const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// Helper to parse simple .env files
function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const rootDir = path.resolve(__dirname, '..');
const envFile = parseEnv(path.join(rootDir, '.env'));
const envLocalFile = parseEnv(path.join(rootDir, '.env.local'));

const mergedEnv = { ...envFile, ...envLocalFile, ...process.env };

const serverUrl =
  mergedEnv.COLLABO_SERVER_URL ||
  'https://collabo-backend.eastasia.cloudapp.azure.com';

const hostUrl =
  mergedEnv.COLLABO_HOST_URL ||
  `${serverUrl.replace(/\/+$/, '')}/desktop-host`;

console.log(`[Build Electron] Baking Server URL: ${serverUrl}`);
console.log(`[Build Electron] Baking Host UI URL: ${hostUrl}`);

async function build() {
  const outdir = path.join(rootDir, 'dist', 'electron');
  fs.mkdirSync(outdir, { recursive: true });

  await esbuild.build({
    entryPoints: [
      path.join(__dirname, 'main.ts'),
      path.join(__dirname, 'preload.ts'),
      path.join(__dirname, 'preload-overlay.ts'),
    ],
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    outdir,
    define: {
      'process.env.COLLABO_SERVER_URL': JSON.stringify(serverUrl),
      'process.env.COLLABO_HOST_URL': JSON.stringify(hostUrl),
      'DEFAULT_SERVER_URL': JSON.stringify(serverUrl),
      'DEFAULT_HOST_URL': JSON.stringify(hostUrl),
    },
  });

  // Copy assets and static HTML
  const assetsDir = path.join(outdir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  fs.copyFileSync(path.join(__dirname, 'overlay.html'), path.join(outdir, 'overlay.html'));
  fs.copyFileSync(path.join(__dirname, 'control.html'), path.join(outdir, 'control.html'));

  const srcIconPng = path.join(__dirname, 'assets', 'icon.png');
  const srcIconIco = path.join(__dirname, 'assets', 'icon.ico');
  if (fs.existsSync(srcIconPng)) {
    fs.copyFileSync(srcIconPng, path.join(assetsDir, 'icon.png'));
  }
  if (fs.existsSync(srcIconIco)) {
    fs.copyFileSync(srcIconIco, path.join(assetsDir, 'icon.ico'));
  }

  console.log('[Build Electron] Electron build completed successfully.');
}

build().catch((err) => {
  console.error('[Build Electron] Build failed:', err);
  process.exit(1);
});
