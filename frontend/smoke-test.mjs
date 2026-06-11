/* 冒烟测试：用 headless Chromium 验证纯前端模式核心流程。
 * 运行：npm run build && node smoke-test.mjs
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import os from "node:os";

const STATIC_DIR = decodeURIComponent(new URL("../backend/app/static", import.meta.url).pathname);
const PORT = 41730;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = join(STATIC_DIR, p);
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});

const exe = join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell"
);

const fails = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, err) => {
  console.log(`  ✗ ${name}: ${err}`);
  fails.push(name);
};

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  // 1. 首页加载（任务记录）
  await page.goto(`http://localhost:${PORT}/#/`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=客服AI评测台", { timeout: 10000 });
  ok("首页加载");

  // 2. 数据集上传（CSV → IndexedDB）
  const csvPath = join(os.tmpdir(), "smoke_ds.csv");
  writeFileSync(csvPath, "query,answer\n你好,hello\n再见,goodbye\n");
  await page.goto(`http://localhost:${PORT}/#/datasets`, { waitUntil: "networkidle" });
  await page.locator("button", { hasText: "新建数据集" }).first().click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(csvPath);
  await page.waitForSelector("text=smoke_ds.csv", { timeout: 10000 });
  ok("数据集上传并显示");

  // 3. 刷新后数据仍在（IndexedDB 持久化）
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=smoke_ds.csv", { timeout: 10000 });
  ok("刷新后数据持久化");

  // 4. 提示词页 / 批注页 / 清洗页加载
  for (const [path, sel] of [
    ["#/prompts", "text=提示词"],
    ["#/annotate", "text=人工批注"],
    ["#/annotate/templates", "text=模版"],
    ["#/cleaning", "text=数据清洗"],
    ["#/new", "text=新建评测"],
  ]) {
    await page.goto(`http://localhost:${PORT}/${path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(sel, { timeout: 10000 });
    ok(`页面 ${path}`);
  }

  // 5. 用 UI 流程跑清洗：从数据集导入 → 运行默认脚本（Web Worker 跑 JS）
  await page.goto(`http://localhost:${PORT}/#/cleaning?dataset_id=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const runBtn = page.locator("button", { hasText: "运行" }).first();
  if (await runBtn.isVisible().catch(() => false)) {
    await runBtn.click();
    await page.waitForTimeout(2500);
    const hasResult = await page
      .locator("text=/运行成功|结果|输出/")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasResult) ok("清洗脚本执行（Web Worker）");
    else bad("清洗脚本执行", "未见运行结果提示（可能 UI 文案不同，需人工确认）");
  } else {
    bad("清洗脚本执行", "未找到运行按钮");
  }

  // 6. 默认批注模版已种入
  await page.goto(`http://localhost:${PORT}/#/annotate/templates`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=东东客服助手复用适配评测", { timeout: 10000 });
  ok("默认批注模版种入");

  rmSync(csvPath, { force: true });
} catch (e) {
  bad("流程异常中断", e.message);
  console.log("\n页面 HTML 片段:", (await page.content()).slice(0, 500));
}

const realErrors = consoleErrors.filter((e) => !e.includes("favicon"));
if (realErrors.length) {
  console.log("\n控制台错误:");
  realErrors.slice(0, 10).forEach((e) => console.log("  " + e.slice(0, 200)));
}

await browser.close();
server.close();
console.log(fails.length ? `\n失败 ${fails.length} 项` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
