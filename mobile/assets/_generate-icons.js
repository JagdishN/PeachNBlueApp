// One-off script: rasterizes app_icon_PB_twotone.svg into the PNG assets
// Expo's app.json needs (SVG isn't a valid icon/adaptiveIcon format).
// Not wired into any npm script — run manually, safe to delete after use.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = __dirname;

const fullSvg = fs.readFileSync(path.join(assetsDir, 'app_icon_PB_twotone.svg'), 'utf-8');
const transparentSvg = fullSvg.replace('<rect width="1024" height="1024" fill="#FFFFFF"/>', '');

// The SVG's own text positioning (x=512 center-anchor, y=600) assumes font
// metrics that don't match what's actually rendered here — the first pass
// came out badly off-center with a lot of dead space. Trimming the rendered
// mark to its real bounding box and recentering it in code (rather than
// trusting the SVG's baked-in coordinates) is more robust than hand-tuning
// the SVG's x/y for a font whose exact metrics in this environment are
// unknown.
async function centeredMark(targetSize) {
  const transparentFull = await sharp(Buffer.from(transparentSvg)).resize(1024, 1024).png().toBuffer();
  const trimmed = await sharp(transparentFull).trim().toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();

  const scale = targetSize / Math.max(trimmedMeta.width, trimmedMeta.height);
  const resizedWidth = Math.round(trimmedMeta.width * scale);
  const resizedHeight = Math.round(trimmedMeta.height * scale);

  return sharp(trimmed).resize(resizedWidth, resizedHeight).png().toBuffer();
}

async function main() {
  // 1. Main app icon — mark trimmed + recentered, ~78% of the canvas so
  // there's visible padding (matches typical app-icon framing), composited
  // onto a solid white background.
  const iconMark = await centeredMark(800);
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: iconMark, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));

  // 2. Android adaptive foreground — same trim/recenter, but scaled to the
  // ~66% safe zone (Android crops the outer edges depending on launcher mask
  // shape — confirmed against the Android adaptive icon spec, 72dp visible
  // circle out of a 108dp canvas ≈ 66.7%; 620/1024 ≈ 60.5% stays safely
  // inside that) and composited onto a transparent background instead.
  const adaptiveMark = await centeredMark(620);
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: adaptiveMark, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'android-icon-foreground.png'));

  // 3. Android themed/monochrome icon variant (Material You, Android 13+) —
  // was still Expo's stock placeholder glyph; regenerated for consistency so
  // OS-themed icons don't revert to the old default. Android applies its own
  // tint to this layer, so color doesn't matter — reusing the navy mark.
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: adaptiveMark, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'android-icon-monochrome.png'));

  // 4. Web favicon — same stock-placeholder-replacement reasoning as #3.
  const faviconMark = await centeredMark(360);
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: faviconMark, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'favicon.png'));

  console.log('Generated icon.png, android-icon-foreground.png, android-icon-monochrome.png, favicon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
