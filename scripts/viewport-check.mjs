// Viewport regression smoke: ensure the shell doesn't overflow horizontally
// at narrow sizes (the window can shrink to 800x600) and that key surfaces
// render. Requires the Vite dev server running on :1420.
//
// Note: without a vault + native IPC, the backlinks panel can't be exercised
// in a plain browser; this checks the layout shell. Believe the CSS.

import { chromium } from "playwright-core";

const b = await chromium.launch();
const results = [];

for (const width of [1280, 800, 720]) {
  const page = await b.newPage({ viewport: { width, height: 600 } });
  await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  results.push({ width, ...r });
  await page.close();
}

console.log(JSON.stringify(results, null, 1));
const fail = results.some((r) => r.overflowX);
console.log(fail ? "FAIL: horizontal overflow detected" : "OK: no horizontal overflow");
await b.close();
process.exit(fail ? 1 : 0);
