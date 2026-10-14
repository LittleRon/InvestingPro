// Renders the site's brand mark (site/brand/logo.svg) to the icon files the site root serves:
// icon.png (512), icon-192.png, apple-icon.png (180) and favicon.ico (a 64px PNG in an ICO wrapper).
// Run after changing logo.svg: node scripts/make-icons.ts
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("site/brand/logo.svg");
const rounded = async (size: number, file: string) => {
  await sharp(svg).resize(size, size).png().toFile(file);
  console.log(file, `${size}px`);
};
await rounded(512, "site/brand/icon.png");
await rounded(192, "site/brand/icon-192.png");
await rounded(180, "site/brand/apple-icon.png");

// ICO with one embedded PNG: header (reserved, type 1, count 1), one 16-byte directory entry, then the image.
const png = await sharp(svg).resize(64, 64).png().toBuffer({ resolveWithObject: false });
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(64, 0);
entry.writeUInt8(64, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
writeFileSync("site/brand/favicon.ico", Buffer.concat([header, entry, png]));
console.log("site/brand/favicon.ico", `${png.length}B`);
