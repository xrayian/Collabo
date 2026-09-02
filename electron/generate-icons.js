/**
 * electron/generate-icons.js
 * Synchronizes and generates high-res icons from public/ into electron/assets and dist/
 */
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
const publicDir = path.join(__dirname, '..', 'public');
const distAssetsDir = path.join(__dirname, '..', 'dist', 'electron', 'assets');

if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(distAssetsDir)) fs.mkdirSync(distAssetsDir, { recursive: true });

// 1. Sync Windows ICO (public/favicon.ico -> electron/assets/icon.ico)
if (fs.existsSync(path.join(publicDir, 'favicon.ico'))) {
  fs.copyFileSync(path.join(publicDir, 'favicon.ico'), path.join(assetsDir, 'icon.ico'));
  fs.copyFileSync(path.join(publicDir, 'favicon.ico'), path.join(distAssetsDir, 'icon.ico'));
}

// 2. Sync Master 512x512 PNG (public/android-chrome-512x512.png -> electron/assets/icon.png & public/icon.png)
const master512 = fs.existsSync(path.join(publicDir, 'android-chrome-512x512.png'))
  ? path.join(publicDir, 'android-chrome-512x512.png')
  : fs.existsSync(path.join(publicDir, 'icon.png'))
  ? path.join(publicDir, 'icon.png')
  : path.join(assetsDir, 'icon.png');

if (fs.existsSync(master512)) {
  fs.copyFileSync(master512, path.join(assetsDir, 'icon.png'));
  fs.copyFileSync(master512, path.join(publicDir, 'icon.png'));
  fs.copyFileSync(master512, path.join(distAssetsDir, 'icon.png'));
}

// 3. Sync 192, 32, 16 PNGs
if (fs.existsSync(path.join(publicDir, 'android-chrome-192x192.png'))) {
  fs.copyFileSync(path.join(publicDir, 'android-chrome-192x192.png'), path.join(assetsDir, 'icon-192.png'));
}
if (fs.existsSync(path.join(publicDir, 'favicon-32x32.png'))) {
  fs.copyFileSync(path.join(publicDir, 'favicon-32x32.png'), path.join(assetsDir, 'icon-32.png'));
}
if (fs.existsSync(path.join(publicDir, 'favicon-16x16.png'))) {
  fs.copyFileSync(path.join(publicDir, 'favicon-16x16.png'), path.join(assetsDir, 'icon-16.png'));
}

console.log('✅ Synchronized and propagated icons from public/ to electron/assets/ and dist/electron/assets/ successfully!');
