// Generates public/og.png (1200x630) and public/apple-touch-icon.png (180x180).
// Run once after visual changes: node scripts/og.mjs
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const MARK = (size, x, y) => `
  <g transform="translate(${x} ${y}) scale(${size / 100})">
    <rect width="100" height="100" rx="26" fill="url(#markGrad)" mask="url(#markMask)" />
  </g>`;

const DEFS = `
  <linearGradient id="markGrad" x1="8" y1="4" x2="92" y2="96" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#8b5cf6" />
    <stop offset="0.5" stop-color="#6d6bf0" />
    <stop offset="1" stop-color="#22d3ee" />
  </linearGradient>
  <mask id="markMask">
    <rect width="100" height="100" rx="26" fill="#fff" />
    <path d="M20 22 L38 22 L50 64 L62 22 L80 22 L56 86 L44 86 Z" fill="#000" />
    <path d="M55 29 L42 51 L50 51 L45 73 L60 47 L51 47 Z" fill="#fff" />
  </mask>
  <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8b5cf6" />
    <stop offset="1" stop-color="#22d3ee" />
  </linearGradient>
  <radialGradient id="glowV" cx="0.28" cy="0.2" r="0.7">
    <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.28" />
    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="glowC" cx="0.8" cy="0.9" r="0.8">
    <stop offset="0" stop-color="#22d3ee" stop-opacity="0.20" />
    <stop offset="1" stop-color="#22d3ee" stop-opacity="0" />
  </radialGradient>`;

const og = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>${DEFS}</defs>
  <rect width="1200" height="630" fill="#0b0b12" />
  <rect width="1200" height="630" fill="url(#glowV)" />
  <rect width="1200" height="630" fill="url(#glowC)" />
  ${MARK(120, 540, 58)}
  <text x="600" y="342" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-weight="800" font-size="164" letter-spacing="-4" fill="url(#textGrad)">FASTEST</text>
  <text x="600" y="440" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-weight="800" font-size="80" letter-spacing="-2" fill="#ececf4">React state library</text>
  <text x="600" y="546" text-anchor="middle" font-family="Menlo, monospace" font-size="26" fill="#7c7c8c">npm i @zaatar-tech/voltix<tspan dx="26" fill="#3a3a4a">·</tspan><tspan dx="26">4 KB</tspan><tspan dx="26" fill="#3a3a4a">·</tspan><tspan dx="26">per-key subscriptions</tspan></text>
</svg>`;

const touch = `<svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
  <defs>${DEFS}</defs>
  <rect width="180" height="180" fill="#0b0b12" />
  ${MARK(148, 16, 16)}
</svg>`;

await writeFile('public/og.png', await sharp(Buffer.from(og)).png().toBuffer());
await writeFile('public/apple-touch-icon.png', await sharp(Buffer.from(touch)).png().toBuffer());
console.log('og.png + apple-touch-icon.png written');
