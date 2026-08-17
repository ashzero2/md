import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const faces = [...document.fonts];
  const nr = faces.filter(f => f.family.includes("Newsreader"));
  return {
    status: document.fonts.status,
    newsreaderFaces: nr.length,
    samples: nr.slice(0, 4).map(f => `${f.family} ${f.weight} ${f.style}`),
    checkOk: document.fonts.check('16px Newsreader', 'va'),
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
