import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto("http://localhost:1420", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const themes = ["light","dark","onedark","nord","catppuccin","latte","rosepine","rosedawn"];
for (const t of themes) {
  const r = await page.evaluate((t) => {
    if (t === "light" || t === "dark") {} 
    document.documentElement.dataset.theme = t;
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
    };
  }, t);
  console.log(t.padEnd(10), "paper="+r.paper, "accent="+r.accent, "bodyBg="+r.bg);
}
await b.close();
