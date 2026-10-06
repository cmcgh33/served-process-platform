import QRCode from 'qrcode';
import { writeFileSync } from 'fs';
import { join } from 'path';

const url = process.argv[2] ?? 'https://4e1bc3e2-a47b-49ea-a2f0-26c9deb46323-00-31viit4k0rq8b.kirk.replit.dev';
const outPath = join(process.cwd(), 'served-qr.png');

await QRCode.toFile(outPath, url, {
  type: 'png',
  width: 800,
  margin: 3,
  color: {
    dark: '#0f1e3c',
    light: '#ffffff',
  },
  errorCorrectionLevel: 'H',
});

console.log(`QR code saved to: ${outPath}`);
console.log(`URL encoded: ${url}`);
