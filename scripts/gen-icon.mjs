// Renders the Magnetar app-icon SVG (neutron star + dipole field) to a 1024px PNG
// offline. Then run: npm run tauri icon scripts/icon-source.png
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const S = 1024;
const r = S * 0.22; // corner radius

// Field-line geometry in a 0..100 space, scaled to icon center.
const CX = 50,
  TOP = 8,
  BOT = 92;
const LOOPS = [10, 17, 24, 31, 38, 44];
const loop = (e) =>
  `M ${CX} ${TOP} C ${CX + e * 0.62} ${TOP + 17}, ${CX + e} 42, ${CX + e} 50 ` +
  `C ${CX + e} 58, ${CX + e * 0.62} ${BOT - 17}, ${CX} ${BOT}`;
const lines = LOOPS.map((e) => `<path d="${loop(e)}"/><path d="${loop(-e)}"/>`).join("");

const svg = `
<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2a86"/>
      <stop offset="0.5" stop-color="#1a1140"/>
      <stop offset="1" stop-color="#0a0620"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#efeaff"/>
      <stop offset="0.5" stop-color="#9a8cff"/>
      <stop offset="1" stop-color="#6a4fe0"/>
    </linearGradient>
    <radialGradient id="core" cx="50%" cy="42%" r="60%">
      <stop offset="0" stop-color="#2a1f4a"/>
      <stop offset="0.55" stop-color="#0b0714"/>
      <stop offset="1" stop-color="#000000"/>
    </radialGradient>
    <radialGradient id="flare" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#c9c2ff"/>
      <stop offset="1" stop-color="#8b7ff5" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="${S}" height="${S}" rx="${r}" ry="${r}" fill="url(#bg)"/>

  <g transform="translate(${S / 2}, ${S / 2}) scale(9.4) translate(-50,-50)">
    <g stroke="url(#line)" stroke-width="0.7" opacity="0.5">
      <line x1="50" y1="4" x2="50" y2="96"/>
      <line x1="6" y1="50" x2="94" y2="50"/>
    </g>
    <g stroke="url(#line)" stroke-width="2.2" stroke-linecap="round" filter="url(#blur)" opacity="0.5" fill="none">${lines}</g>
    <g stroke="url(#line)" stroke-width="1.4" stroke-linecap="round" fill="none">${lines}</g>
    <circle cx="50" cy="50" r="20" fill="url(#flare)"/>
    <circle cx="50" cy="50" r="13.5" fill="url(#core)"/>
    <ellipse cx="45.5" cy="45" rx="4.5" ry="3" fill="#ffffff" opacity="0.14"/>
    <path d="M50 34 C 51 47, 53 49, 63 50 C 53 51, 51 53, 50 66 C 49 53, 47 51, 37 50 C 47 49, 49 47, 50 34 Z" fill="#ffffff"/>
    <circle cx="50" cy="50" r="2.4" fill="#ffffff"/>
  </g>

  <rect x="0" y="0" width="${S}" height="${S * 0.5}" rx="${r}" ry="${r}" fill="url(#gloss)"/>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: "width", value: S } }).render().asPng();
writeFileSync(new URL("./icon-source.png", import.meta.url), png);
console.log("wrote scripts/icon-source.png", png.length, "bytes");
