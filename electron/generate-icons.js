/**
 * electron/generate-icons.js
 * Rasterizes icon.svg into PNG and ICO formats for Electron packaging.
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const assetsDir = path.join(__dirname, 'assets');
  const publicDir = path.join(__dirname, '..', 'public');

  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  const svgPath = path.join(assetsDir, 'icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  // Copy SVG to public/
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgBuffer);

  const img = nativeImage.createFromBuffer(svgBuffer);

  const sizes = [512, 256, 128, 64, 48, 32, 16];
  for (const size of sizes) {
    const resized = img.resize({ width: size, height: size, quality: 'best' });
    const pngBuffer = resized.toPNG();
    
    if (size === 512) {
      fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);
      fs.writeFileSync(path.join(publicDir, 'icon.png'), pngBuffer);
    } else {
      fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), pngBuffer);
    }
  }

  // Create simple ICO file header wrapping 256, 48, 32, 16 PNG images
  const icoSizes = [256, 48, 32, 16];
  const pngBuffers = icoSizes.map(size => img.resize({ width: size, height: size, quality: 'best' }).toPNG());

  const numImages = icoSizes.length;
  const headerSize = 6 + (16 * numImages);
  let currentOffset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images

  const directoryEntries = [];
  for (let i = 0; i < numImages; i++) {
    const size = icoSizes[i];
    const data = pngBuffers[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color count
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(data.length, 8); // Image size in bytes
    entry.writeUInt32LE(currentOffset, 12); // Image data offset
    currentOffset += data.length;
    directoryEntries.push(entry);
  }

  const icoBuffer = Buffer.concat([header, ...directoryEntries, ...pngBuffers]);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);

  console.log('✅ Generated application icons successfully in electron/assets and public!');
  app.quit();
});
