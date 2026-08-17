import { chromium } from "playwright-core";
const b = await chromium.launch();
// light mode shell
const p1 = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p1.goto("http://localhost:1420", { waitUntil: "networkidle" });
await p1.waitForTimeout(1500);
const light = await p1.evaluate(() => ({
  topbarGone: !document.querySelector(".topbar"),
  wordmark: document.querySelector(".wordmark")?.textContent,
  sidebarFoot: !!document.querySelector(".sidebar-foot"),
  vaultPathHidden: !document.querySelector(".vault-path"), // no vault open
  bodyBg: getComputedStyle(document.body).backgroundColor,
}));
await p1.screenshot({ path: "/tmp/vault-light.png" });
// dark mode shell
const p2 = await b.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
await p2.goto("http://localhost:1420", { waitUntil: "networkidle" });
await p2.waitForTimeout(1500);
const dark = await p2.evaluate(() => ({
  bodyBg: getComputedStyle(document.body).backgroundColor,
  sidebarBg: getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
  ink: getComputedStyle(document.body).color,
}));
await p2.screenshot({ path: "/tmp/vault-dark.png" });
console.log(JSON.stringify({ light, dark }, null, 1));
await b.close();
