import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function generateAllAssets() {
  const publicDir = path.resolve('public');
  const svgPath = path.join(publicDir, 'icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  console.log('Generating PWA icons and favicons...');

  // 1. favicon-16x16.png
  await sharp(svgBuffer)
    .resize(16, 16)
    .png()
    .toFile(path.join(publicDir, 'favicon-16x16.png'));

  // 2. favicon-32x32.png
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon-32x32.png'));

  // 3. favicon.ico (32x32 PNG is supported by all modern browsers as favicon.ico)
  await sharp(svgBuffer)
    .resize(48, 48)
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));

  // 4. pwa-192x192.png
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));

  // 5. pwa-maskable-192x192.png (80% safe zone on #090d16)
  const inner192 = 154; // ~80%
  const innerBuffer192 = await sharp(svgBuffer)
    .resize(inner192, inner192)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: '#090d16',
    },
  })
    .composite([
      {
        input: innerBuffer192,
        top: Math.round((192 - inner192) / 2),
        left: Math.round((192 - inner192) / 2),
      },
    ])
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-192x192.png'));

  // 6. pwa-512x512.png
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));

  // 7. pwa-maskable-512x512.png (80% safe zone on #090d16)
  const inner512 = 410; // ~80%
  const innerBuffer512 = await sharp(svgBuffer)
    .resize(inner512, inner512)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: '#090d16',
    },
  })
    .composite([
      {
        input: innerBuffer512,
        top: Math.round((512 - inner512) / 2),
        left: Math.round((512 - inner512) / 2),
      },
    ])
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));

  // 8. apple-touch-icon.png (180x180, unrounded with solid background for iOS)
  const innerApple = 144;
  const innerAppleBuffer = await sharp(svgBuffer)
    .resize(innerApple, innerApple)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: '#090d16',
    },
  })
    .composite([
      {
        input: innerAppleBuffer,
        top: Math.round((180 - innerApple) / 2),
        left: Math.round((180 - innerApple) / 2),
      },
    ])
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  // 9. Screenshots directory and screenshot for rich install UI
  const screenshotsDir = path.join(publicDir, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Generate mobile screenshot SVG -> PNG (720x1280)
  const mobileSvg = `
  <svg width="720" height="1280" viewBox="0 0 720 1280" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="720" height="1280" fill="#020617"/>
    <!-- Header -->
    <rect x="0" y="0" width="720" height="100" fill="#0f172a"/>
    <text x="90" y="60" fill="#f8fafc" font-family="sans-serif" font-size="28" font-weight="bold">ArecaGuard - Dryer Control</text>
    <!-- Card 1: Mode -->
    <rect x="36" y="130" width="648" height="120" rx="20" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <text x="70" y="180" fill="#38bdf8" font-family="sans-serif" font-size="22" font-weight="bold">Combined AI Autopilot</text>
    <text x="70" y="215" fill="#94a3b8" font-family="sans-serif" font-size="16">Autonomous Dual Arbiter: Sensors &amp; Radar Cross-Validation</text>
    <!-- Center Orb Area -->
    <circle cx="360" cy="460" r="140" fill="#0f172a" stroke="#10b981" stroke-width="8"/>
    <text x="360" y="450" text-anchor="middle" fill="#34d399" font-family="sans-serif" font-size="32" font-weight="bold">Canopy Open</text>
    <text x="360" y="490" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="18">Optimal Solar Drying</text>
    <!-- Metrics Grid -->
    <rect x="36" y="660" width="310" height="180" rx="16" fill="#1e293b"/>
    <text x="60" y="710" fill="#94a3b8" font-family="sans-serif" font-size="16">Sunlight (LDR)</text>
    <text x="60" y="760" fill="#fbbf24" font-family="sans-serif" font-size="36" font-weight="bold">82%</text>
    <text x="60" y="800" fill="#34d399" font-family="sans-serif" font-size="14">Bright Sun (Safe)</text>
    
    <rect x="374" y="660" width="310" height="180" rx="16" fill="#1e293b"/>
    <text x="398" y="710" fill="#94a3b8" font-family="sans-serif" font-size="16">Rain Plate ADC</text>
    <text x="398" y="760" fill="#38bdf8" font-family="sans-serif" font-size="36" font-weight="bold">3840</text>
    <text x="398" y="800" fill="#34d399" font-family="sans-serif" font-size="14">Plate Dry (Safe)</text>

    <!-- Radar Section -->
    <rect x="36" y="870" width="648" height="200" rx="16" fill="#1e293b" stroke="#0ea5e9" stroke-width="1"/>
    <text x="70" y="920" fill="#38bdf8" font-family="sans-serif" font-size="20" font-weight="bold">30km Radar Grid: All Clear</text>
    <text x="70" y="960" fill="#cbd5e1" font-family="sans-serif" font-size="15">0 rain cells detected across 30 perimeter monitoring stations</text>
    <text x="70" y="1000" fill="#64748b" font-family="sans-serif" font-size="14">Mangalore • Bantwal • Puttur • Sullia • Belthangady</text>
  </svg>
  `;
  await sharp(Buffer.from(mobileSvg))
    .png()
    .toFile(path.join(screenshotsDir, 'screenshot-mobile.png'));

  console.log('Successfully generated all PWA icons, maskables, favicons, and screenshots!');
}

generateAllAssets().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
