const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP = process.env.APP_URL || "http://localhost:5173";
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--mute-audio",
      "--window-size=1280,800"
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text()); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto(APP, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector("text/Create Room", { timeout: 15000 });
  const btnCreate = await page.$$("text/Create Room");
  await btnCreate[btnCreate.length - 1].click();

  await page.waitForSelector(".setup-card input", { timeout: 15000 });
  const inputs = await page.$$(".setup-card input");
  await inputs[0].type("TesterCDP");          // display name
  await inputs[1].type(VIDEO);                // movie link

  await page.waitForSelector("button.primary.wide", { timeout: 15000 });
  await page.click("button.primary.wide");
  console.log("room create clicked");

  // wait to enter the room (host)
  await page.waitForSelector(".scene-topbar", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  const infopre = await page.evaluate(() => {
    const f = document.querySelector(".cf-frame iframe");
    const p = document.querySelector(".cf-play-big");
    return {
      hasIframe: !!f,
      iframeSrc: f ? f.src.substring(0, 160) : null,
      iframeRect: f ? (() => { const r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      playBigVisible: p ? getComputedStyle(p).display !== "none" : false
    };
  });
  console.log("PRE:", JSON.stringify(infopre));

  // host starts the movie
  if (infopre.playBigVisible) await page.click(".cf-play-big");
  else await page.click(".meta-actions .primary.compact");
  console.log("play clicked");

  await new Promise((r) => setTimeout(r, 9000));

  const info = await page.evaluate(() => {
    const m = document.querySelector(".movie");
    return {
      movieHTML: m ? m.innerHTML.substring(0, 500) : null,
      iframes: [...document.querySelectorAll("iframe")].map(f => ({ cls: f.className, src: (f.src||"").substring(0,140) }))
    };
  });
  console.log("DETAILS:", JSON.stringify(info));

  await page.screenshot({ path: "C:\\Users\\THINKPAD\\AppData\\Local\\Temp\\opencode\\real.png" });
  console.log("saved real.png");

  await browser.close();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });