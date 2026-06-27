// Одноразовый репак лого-атласа: старые 18 PNG-листов 4096² (из git HEAD) → webp,
// атлас переписываем на .webp и сохраняем как .atlas.txt. Раскладка 4096² (без зависаний),
// формат webp (лёгкий). Запуск: node scripts/repack-logo-4096.cjs [quality]
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIR = "public/Logo_anim";
const ATLAS_GIT = "HEAD:public/Logo_anim/Full_logo_mono_white.atlas";
// Аргумент: "lossless" (по умолчанию — лучший вес+качество для лого) или число 0-100 для lossy webp.
const ARG = process.argv[2] || "lossless";
const LOSSLESS = ARG === "lossless";
const QUALITY = LOSSLESS ? 100 : Number(ARG);

function gitShowBuf(spec) {
  return execSync(`git show ${spec}`, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
}

(async () => {
  const atlasText = gitShowBuf(ATLAS_GIT).toString("utf8");
  const pagePng = [...new Set(
    atlasText.split("\n").map((l) => l.trim()).filter((l) => /^[\w.-]+\.png$/i.test(l)),
  )];
  console.log(`pages: ${pagePng.length}, webp=${LOSSLESS ? "lossless" : "q" + QUALITY}`);

  const webpOpts = LOSSLESS
    ? { lossless: true, effort: 6 }
    : { quality: QUALITY, alphaQuality: 100, effort: 6 };

  let totalWebp = 0;
  for (const png of pagePng) {
    const buf = gitShowBuf(`HEAD:${DIR}/${png}`);
    const outName = png.replace(/\.png$/i, ".webp");
    const out = await sharp(buf).webp(webpOpts).toBuffer();
    fs.writeFileSync(path.join(DIR, outName), out);
    totalWebp += out.length;
    console.log(`  ${png} (${buf.length}) -> ${outName} (${out.length})`);
  }

  const newAtlas = atlasText.replace(/^([\w.-]+)\.png$/gim, "$1.webp");
  fs.writeFileSync(path.join(DIR, "Full_logo_mono_white.atlas.txt"), newAtlas, "utf8");

  console.log(`\nTOTAL new webp: ${totalWebp} bytes = ${(totalWebp / 1024 / 1024).toFixed(2)} MB`);
})().catch((e) => { console.error(e); process.exit(1); });
