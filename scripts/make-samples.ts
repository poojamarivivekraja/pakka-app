// Generates the mock UPI "payment successful" screens in public/samples/.
// All details are fake. Run: npx tsx scripts/make-samples.ts
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "samples");
const W = 600;
const H = 1000;

type Screen = { file: string; amount: string; date: string; reference: string };

const screens: Screen[] = [
  { file: "payment_700.png", amount: "700", date: "19 Oct 2026, 11:01 am", reference: "428163905527" },
  { file: "payment_500.png", amount: "500", date: "22 Oct 2026, 9:39 am", reference: "428917340618" },
];

function svg({ amount, date, reference }: Screen): string {
  const row = (y: number, label: string, value: string) => `
    <text x="40" y="${y}" font-size="22" fill="#7a7a7a">${label}</text>
    <text x="${W - 40}" y="${y}" font-size="22" fill="#1d1d1d" text-anchor="end">${value}</text>
    <line x1="40" y1="${y + 24}" x2="${W - 40}" y2="${y + 24}" stroke="#e6e6e6" stroke-width="2"/>`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="${280}" fill="#eaf6ee"/>
  <circle cx="${W / 2}" cy="110" r="52" fill="#2e9d5b"/>
  <path d="M${W / 2 - 24} 112 l16 17 l32 -36" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${W / 2}" y="215" font-size="32" font-weight="bold" fill="#1f6b3d" text-anchor="middle">Payment successful</text>
  <text x="${W / 2}" y="262" font-size="22" fill="#4a7a5c" text-anchor="middle">${date}</text>
  <text x="${W / 2}" y="395" font-size="84" font-weight="bold" fill="#1d1d1d" text-anchor="middle">₹${amount}</text>
  ${row(500, "To", "Kavya’s Bakes")}
  ${row(570, "UPI reference no.", reference)}
  ${row(640, "Date", date)}
  ${row(710, "Status", "Successful")}
  <text x="${W / 2}" y="${H - 60}" font-size="18" fill="#9a9a9a" text-anchor="middle">Mock screen for testing. Not a real payment.</text>
  <g transform="rotate(-32 ${W / 2} ${H / 2})">
    <text x="${W / 2}" y="${H / 2 + 50}" font-size="140" font-weight="bold" fill="#d33" fill-opacity="0.22" text-anchor="middle" letter-spacing="8">SAMPLE</text>
  </g>
</svg>`;
}

async function main() {
  for (const s of screens) {
    await sharp(Buffer.from(svg(s))).png().toFile(path.join(OUT, s.file));
    console.log(`wrote public/samples/${s.file}`);
  }
}

main();
