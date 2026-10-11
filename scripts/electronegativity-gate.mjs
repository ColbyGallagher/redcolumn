// Fails CI on any HIGH finding in Electronegativity's CSV report; lists the rest for review.
// Usage: node scripts/electronegativity-gate.mjs report.csv
import fs from 'node:fs';

const file = process.argv[2];
const rows = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
const high = rows.filter((r) => r[1] === 'HIGH');
for (const r of rows) console.log(`${r[1].padEnd(6)} ${r[0]} ${r[3]}:${r[4]} ${r[6] ?? ''}`);
if (high.length) {
  console.error(`\n${high.length} HIGH finding(s). Fix them, or explain in the code why they do not apply and spell the setting out so the scan can see it.`);
  process.exit(1);
}
console.log(`\nNo HIGH findings (${rows.length} to review).`);
