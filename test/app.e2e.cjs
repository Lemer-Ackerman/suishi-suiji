const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { parseEntries } = require("../src/entries.cjs");
let app, page, root;
async function launch() {
  app = await electron.launch({
    args: [path.join(__dirname, "..")],
    env: {
      ...process.env,
      DAYNOTE_TEST_DATA: root,
      DAYNOTE_TEST_NOW: "2026-11-19T03:59:30",
    },
  });
  page = await app.firstWindow();
  await expect(page.locator("#page-title")).toHaveText("日笺");
  await expect(page.locator("#editor")).toBeEnabled();
}
async function menu(item) {
  await page.locator("#more").click();
  await page.locator(`#${item}`).click();
}
async function send(text) {
  await page.locator("#editor").fill(text);
  await page.locator("#send").click();
  await expect(page.locator("#editor")).toHaveValue("");
}
function readEntries(file) {
  return fs.existsSync(file)
    ? parseEntries(fs.readFileSync(file, "utf8")).map((e) => e.text)
    : [];
}
test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "daynote-e2e-"));
  await launch();
});
test.afterEach(async () => {
  if (app) await app.close();
  fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
});
test("chat recording, calendar, clipboard, confirm deletion, rollover, hide and restart", async () => {
  const notes = path.join(root, "notes"),
    file = path.join(notes, "2026-11-18.txt");
  expect(fs.readdirSync(notes)).toEqual([]);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
  ).toBe(true);
  await page.locator("#editor").fill("只是草稿");
  expect(fs.readdirSync(notes).filter((name) => name.endsWith(".txt"))).toEqual(
    [],
  );
  await send("一个值得记住的想法 🌱\n明天继续。");
  await send("第二条独立记录");
  expect(readEntries(file)).toEqual([
    "一个值得记住的想法 🌱\n明天继续。",
    "第二条独立记录",
  ]);
  await expect(page.locator(".bubble")).toHaveCount(2);
  await expect(page.locator(".message-time").first()).toHaveText("03:59:30");
  await page.locator(".message").first().hover();
  await page.getByLabel("复制这条记录", { exact: true }).first().click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    "一个值得记住的想法 🌱\n明天继续。",
  );
  await menu("calendar-toggle");
  await expect(page.locator('[data-date="2026-11-18"]')).toHaveClass(
    /has-note/,
  );
  await page.locator('[data-date="2026-11-17"]').click();
  await expect(page.locator(".bubble")).toHaveCount(0);
  expect(fs.existsSync(path.join(notes, "2026-11-17.txt"))).toBe(false);
  await menu("calendar-toggle");
  await page.locator('[data-date="2026-11-18"]').click();
  await expect(page.locator(".bubble")).toHaveCount(2);
  await page.locator(".message").first().hover();
  await page.getByLabel("删除这条记录", { exact: true }).first().click();
  await expect(page.locator("#delete-dialog")).toBeVisible();
  await page.locator("#cancel-delete").click();
  expect(readEntries(file)).toHaveLength(2);
  await page.locator(".message").first().hover();
  await page.getByLabel("删除这条记录", { exact: true }).first().click();
  await page.locator("#confirm-delete").click();
  await expect(page.locator(".bubble")).toHaveCount(1);
  expect(readEntries(file)).toEqual(["第二条独立记录"]);
  await app.evaluate(() => {
    process.env.DAYNOTE_TEST_NOW = "2026-11-19T04:00:01";
  });
  await expect(page.locator("#menu-date")).toHaveText("2026-11-19 · 今天");
  await expect(page.locator(".bubble")).toHaveCount(0);
  expect(fs.existsSync(path.join(notes, "2026-11-19.txt"))).toBe(false);
  await send("新的一天");
  await menu("hide");
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(false);
  expect(readEntries(path.join(notes, "2026-11-19.txt"))).toEqual(["新的一天"]);
  await app.evaluate(({ app }) => app.emit("activate"));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await app.close();
  app = null;
  await launch();
  await expect(page.locator(".bubble")).toHaveText(["第二条独立记录"]);
  await menu("delete-all");
  await page.locator("#confirm-delete").click();
  await expect(page.locator(".bubble")).toHaveCount(0);
  expect(fs.existsSync(file)).toBe(false);
});
test("shortcut settings persist, conflict preserves old shortcut, folder migration", async () => {
  await send("保存位置测试");
  await menu("settings");
  await page.locator("#shortcut-input").focus();
  await page.keyboard.press("Control+Alt+K");
  await page.locator("#save-shortcut").click();
  await expect(page.locator("#settings-status")).toHaveText("快捷键已保存");
  expect(
    await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("Control+Alt+K"),
    ),
  ).toBe(true);
  await app.evaluate(({ globalShortcut }) => {
    globalShortcut.register("Control+Alt+J", () => {});
  });
  await page.locator("#shortcut-input").focus();
  await page.keyboard.press("Control+Alt+J");
  await page.locator("#save-shortcut").click();
  await expect(page.locator("#settings-status")).toContainText(
    "已被系统或其他程序占用",
  );
  expect(
    await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("Control+Alt+K"),
    ),
  ).toBe(true);
  const target = path.join(root, "custom-folder");
  fs.mkdirSync(target);
  // Substitute only the OS folder picker. All migration and persistence use real disk IO.
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [target],
    });
  }, target);
  await page.locator("#change-folder").click();
  await expect(page.locator("#folder-path")).toHaveText(target);
  expect(readEntries(path.join(target, "2026-11-18.txt"))).toEqual([
    "保存位置测试",
  ]);
  await page.locator("#close-settings").click();
  await send("新路径继续记录");
  expect(readEntries(path.join(target, "2026-11-18.txt"))).toEqual([
    "保存位置测试",
    "新路径继续记录",
  ]);
  expect(readEntries(path.join(root, "notes", "2026-11-18.txt"))).toEqual([
    "保存位置测试",
  ]);
  await app.close();
  app = null;
  await launch();
  await expect(page.locator(".bubble")).toHaveText([
    "保存位置测试",
    "新路径继续记录",
  ]);
  await expect(page.locator("#shortcut-hint")).toHaveText("Ctrl + Alt + K");
});
test("failed send retains draft and previous records, retry works after storage recovery", async () => {
  await send("不能丢失");
  const notes = path.join(root, "notes");
  fs.renameSync(notes, notes + "-backup");
  fs.writeFileSync(notes, "not a directory");
  await page.locator("#editor").fill("保存失败时仍保留");
  await page.locator("#send").click();
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#editor")).toHaveValue("保存失败时仍保留");
  await expect(page.locator(".bubble")).toHaveText(["不能丢失"]);
  fs.unlinkSync(notes);
  fs.renameSync(notes + "-backup", notes);
  await page.locator("#send").click();
  await expect(page.locator("#editor")).toHaveValue("");
  expect(readEntries(path.join(notes, "2026-11-18.txt"))).toEqual([
    "不能丢失",
    "保存失败时仍保留",
  ]);
});
test("Enter sends, Shift+Enter preserves multiline, whitespace creates no file", async () => {
  await page.locator("#editor").fill("  \n");
  await expect(page.locator("#send")).toBeDisabled();
  expect(fs.readdirSync(path.join(root, "notes"))).toEqual([]);
  await page.locator("#editor").fill("第一行");
  await page.locator("#editor").press("Shift+Enter");
  await page.keyboard.insertText("第二行");
  await page.locator("#editor").press("Enter");
  await expect(page.locator(".bubble")).toHaveText(["第一行\n第二行"]);
  await expect(page.locator("#editor")).toHaveValue("");
});

test("login launch remains hidden until explicitly summoned", async () => {
  await app.close();
  app = await electron.launch({
    args: [path.join(__dirname, ".."), "--hidden"],
    env: {
      ...process.env,
      DAYNOTE_TEST_DATA: root,
      DAYNOTE_TEST_NOW: "2026-11-19T03:59:30",
    },
  });
  page = await app.firstWindow();
  await expect(page.locator("#menu-date")).toHaveText("2026-11-18 · 今天");
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
  ).toBe(false);
  await app.evaluate(({ app }) => app.emit("activate"));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    )
    .toBe(true);
  await menu("settings");
  await expect(page.locator("#start-on-login")).toBeDisabled();
});

test("force-kill recovery restores unsent draft without creating a daily text file", async () => {
  await page.locator("#editor").fill("紧急退出也要留下的文字\n多行内容 🌱");
  await expect(page.locator("#compose-help")).toContainText("草稿已保存");
  expect(fs.existsSync(path.join(root, "notes", "2026-11-18.txt"))).toBe(false);
  const child = app.process();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  // Windows Electron uses a launcher process. End its entire tree, as Task Manager does.
  if (process.platform === "win32")
    execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"]);
  else child.kill("SIGKILL");
  await exited;
  app = null;
  await launch();
  await expect(page.locator("#editor")).toHaveValue(
    "紧急退出也要留下的文字\n多行内容 🌱",
  );
  await expect(page.locator(".bubble")).toHaveCount(0);
  await page.locator("#send").click();
  await expect(page.locator("#editor")).toHaveValue("");
  expect(readEntries(path.join(root, "notes", "2026-11-18.txt"))).toEqual([
    "紧急退出也要留下的文字\n多行内容 🌱",
  ]);
  expect(
    fs.existsSync(path.join(root, "notes", ".drafts", "2026-11-18.json")),
  ).toBe(false);
});
test("crash after message commit cannot restore a sent draft or duplicate retries", async () => {
  await send("只保存一次");
  const file = path.join(root, "notes", "2026-11-18.txt");
  const entry = parseEntries(fs.readFileSync(file, "utf8"))[0];
  const draftFile = path.join(root, "notes", ".drafts", "2026-11-18.json");
  fs.mkdirSync(path.dirname(draftFile), { recursive: true });
  fs.writeFileSync(
    draftFile,
    JSON.stringify({ ...entry, updatedAt: Date.now() }),
  );
  await app.close();
  app = null;
  await launch();
  await expect(page.locator("#editor")).toHaveValue("");
  await expect(page.locator(".bubble")).toHaveText(["只保存一次"]);
  const result = await page.evaluate(
    (entry) =>
      window.daynote.call("send", {
        date: "2026-11-18",
        id: entry.id,
        text: entry.text,
      }),
    entry,
  );
  expect(result.ok).toBe(true);
  expect(readEntries(file)).toEqual(["只保存一次"]);
});
