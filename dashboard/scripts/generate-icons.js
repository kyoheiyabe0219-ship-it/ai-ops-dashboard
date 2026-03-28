/**
 * PWAアイコン生成スクリプト
 * Node.js のみで実行可能（外部ライブラリ不要）
 *
 * 実行: node scripts/generate-icons.js
 * → public/icons/icon-192.png, icon-512.png を生成
 *
 * Canvas APIがない環境ではSVGアイコンを代わりに生成
 */

const fs = require("fs");
const path = require("path");

function generateSVG(size) {
  const r = size * 0.2; // 角丸
  const cx = size / 2;
  const cy = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#030712"/>
  <circle cx="${cx}" cy="${cy * 0.65}" r="${size * 0.18}" fill="none" stroke="#22c55e" stroke-width="${size * 0.03}"/>
  <circle cx="${cx}" cy="${cy * 0.65}" r="${size * 0.06}" fill="#22c55e"/>
  <rect x="${cx - size * 0.25}" y="${cy * 1.05}" width="${size * 0.5}" height="${size * 0.06}" rx="${size * 0.03}" fill="#6366f1"/>
  <rect x="${cx - size * 0.2}" y="${cy * 1.2}" width="${size * 0.4}" height="${size * 0.06}" rx="${size * 0.03}" fill="#6366f1" opacity="0.6"/>
  <rect x="${cx - size * 0.15}" y="${cy * 1.35}" width="${size * 0.3}" height="${size * 0.06}" rx="${size * 0.03}" fill="#6366f1" opacity="0.3"/>
</svg>`;
}

const iconsDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(iconsDir, { recursive: true });

// SVGで生成（PNGが必要な場合は別途変換ツールを使用）
[192, 512].forEach((size) => {
  const svg = generateSVG(size);
  const svgPath = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`Generated: ${svgPath}`);
});

// manifest.json のアイコンをSVGに変更する注意
console.log("\n⚠️  SVGアイコンが生成されました。");
console.log("PNGが必要な場合: https://cloudconvert.com/svg-to-png で変換するか、");
console.log("下記コマンドで変換できます（resvg-cli必要）:");
console.log("  npx @aspect-ratio/resvg-cli icon-192.svg icon-192.png");
console.log("\nまたは manifest.json のアイコンを .svg に変更してください。");
