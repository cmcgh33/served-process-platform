import QRCode from 'qrcode';
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join } from 'path';

const NAVY = '#0f1e3c';
const NAVY_DARK = '#0a1530';
const AMBER = '#f59e0b';
const WHITE = '#ffffff';
const GRAY = '#cbd5e1';

const URL = 'https://servedapp.co';

// US business card 3.5" x 2" — at 600 DPI = 2100 x 1200
const W = 2100;
const H = 1200;
const AMBER_BAND = 28;

async function buildCard() {
  const qrBuffer = await QRCode.toBuffer(URL, {
    type: 'png',
    width: 620,
    margin: 1,
    color: { dark: NAVY, light: WHITE },
    errorCorrectionLevel: 'H',
  });
  const qrDataUri = `data:image/png;base64,${qrBuffer.toString('base64')}`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="${NAVY_DARK}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>

  <!-- Background watermark "S" -->
  <text x="${W - 80}" y="${H + 40}" text-anchor="end"
        font-family="Inter, Arial Black, sans-serif"
        font-weight="900" font-size="1400"
        fill="${NAVY_DARK}" opacity="0.55">S</text>

  <!-- ================ LEFT COLUMN ================ -->

  <!-- Headline -->
  <text x="120" y="180" font-family="Inter, Arial, sans-serif"
        font-weight="700" font-size="76" letter-spacing="6"
        fill="${WHITE}">LEGAL SERVICE,</text>
  <text x="120" y="290" font-family="Inter, Arial Black, sans-serif"
        font-weight="900" font-size="100" letter-spacing="4"
        fill="${AMBER}">SIMPLIFIED.</text>

  <!-- Divider line under headline -->
  <line x1="120" y1="340" x2="360" y2="340"
        stroke="${AMBER}" stroke-width="6" stroke-linecap="round"/>

  <!-- Feature 1: FAST -->
  <g transform="translate(120, 420)">
    <circle cx="60" cy="60" r="56" fill="none" stroke="${AMBER}" stroke-width="5"/>
    <path d="M 66 26 L 46 67 L 60 67 L 54 94 L 74 53 L 60 53 Z" fill="${AMBER}"/>
    <text x="160" y="52" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="50" letter-spacing="3"
          fill="${WHITE}">FAST.</text>
    <text x="160" y="98" font-family="Inter, Arial, sans-serif"
          font-weight="500" font-size="32"
          fill="${GRAY}">File requests in minutes.</text>
  </g>

  <!-- Feature 2: VERIFIED -->
  <g transform="translate(120, 580)">
    <circle cx="60" cy="60" r="56" fill="none" stroke="${AMBER}" stroke-width="5"/>
    <path d="M 60 26 L 34 38 L 34 60 Q 34 84 60 96 Q 86 84 86 60 L 86 38 Z"
          fill="none" stroke="${AMBER}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M 48 60 L 56 68 L 72 50" fill="none" stroke="${AMBER}"
          stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="160" y="52" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="50" letter-spacing="3"
          fill="${WHITE}">VERIFIED.</text>
    <text x="160" y="98" font-family="Inter, Arial, sans-serif"
          font-weight="500" font-size="32"
          fill="${GRAY}">Trusted, professional process servers.</text>
  </g>

  <!-- Feature 3: LOCAL -->
  <g transform="translate(120, 740)">
    <circle cx="60" cy="60" r="56" fill="none" stroke="${AMBER}" stroke-width="5"/>
    <path d="M 60 26 Q 38 26 38 50 Q 38 68 60 96 Q 82 68 82 50 Q 82 26 60 26 Z"
          fill="none" stroke="${AMBER}" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="60" cy="50" r="9" fill="${AMBER}"/>
    <text x="160" y="52" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="50" letter-spacing="3"
          fill="${WHITE}">LOCAL.</text>
    <text x="160" y="98" font-family="Inter, Arial, sans-serif"
          font-weight="500" font-size="32"
          fill="${GRAY}">Proudly serving <tspan fill="${AMBER}" font-weight="700">Nevada</tspan>.</text>
  </g>

  <!-- ================ RIGHT COLUMN: Scan area ================ -->

  <!-- "SCAN TO REQUEST SERVICE" header -->
  <text x="1670" y="160" text-anchor="middle"
        font-family="Inter, Arial, sans-serif"
        font-weight="800" font-size="40" letter-spacing="3"
        fill="${WHITE}">SCAN TO <tspan fill="${AMBER}">REQUEST</tspan> SERVICE</text>

  <!-- QR code white rounded panel (smaller now) -->
  <rect x="1360" y="200" width="620" height="620" rx="32" ry="32" fill="${WHITE}"/>
  <image x="1380" y="220" width="580" height="580" href="${qrDataUri}"/>

  <!-- Monogram divider -->
  <circle cx="1670" cy="870" r="28" fill="none" stroke="${AMBER}" stroke-width="3"/>
  <text x="1670" y="882" text-anchor="middle"
        font-family="Inter, Arial Black, sans-serif"
        font-weight="900" font-size="30"
        fill="${AMBER}">S</text>
  <line x1="1390" y1="870" x2="1632" y2="870" stroke="${AMBER}" stroke-width="2" opacity="0.5"/>
  <line x1="1708" y1="870" x2="1950" y2="870" stroke="${AMBER}" stroke-width="2" opacity="0.5"/>

  <!-- Tagline -->
  <text x="1670" y="945" text-anchor="middle"
        font-family="Inter, Arial Black, sans-serif"
        font-weight="900" font-size="36" letter-spacing="4"
        fill="${WHITE}">FAST. <tspan fill="${AMBER}">VERIFIED.</tspan> LOCAL.</text>

  <!-- ================ BOTTOM ROW: Contact info (full width) ================ -->

  <!-- Divider spanning full card width -->
  <line x1="100" y1="1020" x2="${W - 100}" y2="1020"
        stroke="${AMBER}" stroke-width="2" opacity="0.5"/>

  <!-- 1. Nevada outline + SERVING NEVADA (left) -->
  <g transform="translate(100, 1050)">
    <!-- Nevada: straight north + east borders, short SE Colorado River angle,
         long SW California diagonal converging to the southern tip -->
    <path d="M 5 5 L 60 5 L 60 48 L 45 78 L 5 42 Z"
          fill="none" stroke="${AMBER}" stroke-width="3" stroke-linejoin="round"/>
    <text x="80" y="32" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="26" letter-spacing="3"
          fill="${WHITE}">SERVING <tspan fill="${AMBER}">NEVADA</tspan></text>
    <text x="80" y="66" font-family="Inter, Arial, sans-serif"
          font-weight="500" font-size="24"
          fill="${GRAY}">and surrounding areas.</text>
  </g>

  <!-- 2. Globe + servedapp.co (center) -->
  <g transform="translate(820, 1050)">
    <circle cx="38" cy="38" r="36" fill="none" stroke="${AMBER}" stroke-width="3"/>
    <ellipse cx="38" cy="38" rx="14" ry="36" fill="none" stroke="${AMBER}" stroke-width="3"/>
    <line x1="2" y1="38" x2="74" y2="38" stroke="${AMBER}" stroke-width="3"/>
    <text x="100" y="32" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="26" letter-spacing="3"
          fill="${AMBER}">VISIT</text>
    <text x="100" y="66" font-family="Inter, Arial, sans-serif"
          font-weight="700" font-size="28"
          fill="${WHITE}">servedapp.co</text>
  </g>

  <!-- 3. Envelope + email (right) -->
  <g transform="translate(1480, 1050)">
    <circle cx="38" cy="38" r="36" fill="none" stroke="${AMBER}" stroke-width="3"/>
    <rect x="18" y="26" width="40" height="24" rx="2" ry="2" fill="none" stroke="${AMBER}" stroke-width="3"/>
    <path d="M 18 28 L 38 44 L 58 28" fill="none" stroke="${AMBER}"
          stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="100" y="32" font-family="Inter, Arial, sans-serif"
          font-weight="900" font-size="26" letter-spacing="3"
          fill="${AMBER}">EMAIL</text>
    <text x="100" y="66" font-family="Inter, Arial, sans-serif"
          font-weight="700" font-size="26"
          fill="${WHITE}">info@servedapp.co</text>
  </g>

  <!-- ================ AMBER FOOTER BAND ================ -->
  <rect x="0" y="${H - AMBER_BAND}" width="${W}" height="${AMBER_BAND}" fill="${AMBER}"/>
</svg>`;

  const svgPath = join(process.cwd(), 'served-card-back.svg');
  writeFileSync(svgPath, svg);
  console.log(`✓ SVG saved: ${svgPath}`);

  const pngPath = join(process.cwd(), 'served-card-back.png');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  console.log(`✓ PNG saved: ${pngPath} (${W}×${H} px)`);
}

await buildCard();
