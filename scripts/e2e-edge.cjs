const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "extension");
const edgePath = process.argv[2];

if (!edgePath || !fs.existsSync(edgePath)) {
  throw new Error("请把 msedge.exe 的绝对路径作为第一个参数传入");
}

const html = `<!doctype html><meta charset="utf-8">
  <input id="search" type="search"><textarea id="notes"></textarea>
  <div id="editor" contenteditable="true"></div><input id="password" type="password">`;

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mj-edge-e2e-"));

  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edgePath,
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);

    await page.locator("#search").pressSequentially("mJ");
    await page.waitForSelector('[id^="mj-effect-"]', { state: "attached", timeout: 3000 });
    assert.equal(await page.locator("#search").inputValue(), "mJ");
    await page.waitForSelector('[id^="mj-effect-"]', { state: "detached", timeout: 5000 });

    await page.locator("#editor").pressSequentially("MJ");
    await page.waitForSelector('[id^="mj-effect-"]', { state: "attached", timeout: 3000 });
    assert.equal(await page.locator("#editor").textContent(), "MJ");
    await page.waitForSelector('[id^="mj-effect-"]', { state: "detached", timeout: 5000 });

    await page.locator("#password").pressSequentially("mj");
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[id^="mj-effect-"]').count(), 0);

    console.log("Edge 端到端验证通过：文本框、contenteditable、输入保留、自动清理、密码框排除");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

