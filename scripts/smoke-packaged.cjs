// Run only on disposable GitHub-hosted runners; never writes personal notes.
if (!process.env.CI)
  throw new Error("Packaged smoke test requires a disposable CI runner.");
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { noteDay } = require("../src/core.cjs");
const { parseEntries } = require("../src/entries.cjs");
(async () => {
  let executablePath;
  if (process.platform === "win32") {
    const setup = fs
      .readdirSync("dist")
      .find((name) => name.endsWith("-setup.exe"));
    const install = path.join(os.tmpdir(), "DaynoteInstalledSmoke");
    execFileSync(path.resolve("dist", setup), ["/S", `/D=${install}`], {
      timeout: 120000,
    });
    executablePath = path.join(install, "日笺.exe");
    assert.ok(
      fs.existsSync(executablePath),
      "Installer must produce the executable",
    );
  } else {
    const folder = process.arch === "arm64" ? "mac-arm64" : "mac";
    executablePath = path.resolve(
      "dist",
      folder,
      "日笺.app/Contents/MacOS/日笺",
    );
  }
  const app = await electron.launch({ executablePath });
  try {
    const page = await app.firstWindow();
    try {
      await page.waitForFunction(() => window.daynote && document.querySelector("#menu-date").textContent.includes("今天"));
    } catch (error) {
      console.error("PACKAGED_UI", await page.evaluate(() => ({ url: location.href, bridge: typeof window.daynote, text: document.body.innerText })));
      console.error("PACKAGED_MAIN", await app.evaluate(({app, BrowserWindow}) => ({ appPath: app.getAppPath(), page: BrowserWindow.getAllWindows()[0].webContents.getURL() })));
      throw error;
    }
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
      ),
      true,
    );
    await page.locator("#editor").fill("Packaged smoke test: UTF-8 记事 🌱");
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".bubble")
        ?.textContent.includes("Packaged smoke test"),
    );
    const folder = await page.locator("#folder-path").textContent();
    if (process.platform === "win32") assert.equal(folder, "D:\\Daynote");
    const file = path.join(folder, `${noteDay()}.txt`);
    assert.equal(
      parseEntries(fs.readFileSync(file, "utf8"))[0].text,
      "Packaged smoke test: UTF-8 记事 🌱",
    );
    assert.match(
      await page.locator(".message-time").textContent(),
      /^\d{2}:\d{2}:\d{2}$/,
    );
    await page.locator("#more").click();
    await page.locator("#settings").click();
    await page.locator("#start-on-login").check();
    await page.waitForFunction(() =>
      document
        .querySelector("#settings-status")
        .textContent.includes("下次登录"),
    );
    if (process.platform === "darwin") {
      const agent = path.join(
        os.homedir(),
        "Library/LaunchAgents/com.lemer.daynote.plist",
      );
      execFileSync("/usr/bin/plutil", ["-lint", agent]);
      assert.ok(fs.readFileSync(agent, "utf8").includes("--hidden"));
    } else {
      assert.equal(
        await app.evaluate(
          ({ app }) =>
            app.getLoginItemSettings({
              path: process.execPath,
              args: ["--hidden"],
            }).executableWillLaunchAtLogin,
        ),
        true,
      );
    }
    await page.locator("#start-on-login").uncheck();
    await page.waitForFunction(() =>
      document.querySelector("#settings-status").textContent.includes("已关闭"),
    );
    console.log(
      "Installed app launched, saved timestamped records, and enabled/disabled startup.",
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
