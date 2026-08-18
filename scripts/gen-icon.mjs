// Renders the Magnetar app-icon SVG to a 1024px PNG (offline, no system deps).
// Then run: npm run tauri icon scripts/icon-source.png
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const S = 1024;
const r = S * 0.22; // corner radius (squircle-ish)

// Mark geometry (100-space) scaled and centered.
const svg = `
<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#111018"/>
      <stop offset="1" stop-color="#060609"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="40%" r="55%">
      <stop offset="0" stop-color="#8b7ff5" stop-opacity="0.45"/>
      <stop offset="0.6" stop-color="#6a5cf0" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#6a5cf0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e6e2ff"/>
      <stop offset="0.5" stop-color="#8b7ff5"/>
      <stop offset="1" stop-color="#5b4fd0"/>
    </linearGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.35" stop-color="#d8d2ff"/>
      <stop offset="1" stop-color="#8b7ff5" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="${S}" height="${S}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${S}" height="${S}" rx="${r}" ry="${r}" fill="url(#halo)"/>
  <rect x="6" y="6" width="${S - 12}" height="${S - 12}" rx="${r - 6}" ry="${r - 6}"
        fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>

  <g transform="translate(${S / 2}, ${S / 2}) scale(6.0) translate(-50,-50)">
    <g stroke="url(#stroke)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"
       filter="url(#blur)" opacity="0.7">
      <path d="M20 26 L50 50 L20 74 Z" fill="none"/>
      <path d="M80 26 L50 50 L80 74 Z" fill="none"/>
    </g>
    <g stroke="url(#stroke)" stroke-width="6.2" stroke-linejoin="round" stroke-linecap="round">
      <path d="M20 26 L50 50 L20 74 Z" fill="none"/>
      <path d="M80 26 L50 50 L80 74 Z" fill="none"/>
    </g>
    <circle cx="50" cy="50" r="12" fill="url(#core)"/>
    <circle cx="50" cy="50" r="2.8" fill="#ffffff"/>
  </g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: "width", value: S } })
  .render()
  .asPng();
writeFileSync(new URL("./icon-source.png", import.meta.url), png);
console.log("wrote scripts/icon-source.png", png.length, "bytes");
