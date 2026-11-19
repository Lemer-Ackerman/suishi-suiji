const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { NoteStore, noteDay, validDate, copyNotes } = require("../src/core.cjs");
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daynote-core-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("4 AM boundary, month/year/leap-day boundaries", () => {
  assert.equal(noteDay(new Date(2026, 10, 19, 3, 59, 59)), "2026-11-18");
  assert.equal(noteDay(new Date(2026, 10, 19, 4, 0, 0)), "2026-11-19");
  assert.equal(noteDay(new Date(2026, 0, 1, 1)), "2025-12-31");
  assert.equal(noteDay(new Date(2024, 2, 1, 2)), "2024-02-29");
});
test("DST transitions use local calendar dates", () => {
  const script = `const { noteDay } = require('./src/core.cjs'); console.log(noteDay(new Date(2026,2,8,4)), noteDay(new Date(2026,10,1,3)), noteDay(new Date(2026,10,1,4)));`;
  const result = execFileSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, TZ: "America/New_York" },
  })
    .toString()
    .trim();
  assert.equal(result, "2026-03-08 2026-10-31 2026-11-01");
});
test("no files for absent/whitespace notes; exact UTF-8 contents survive restart", (t) => {
  const root = temp(t);
  const store = new NoteStore(root);
  assert.equal(store.read("2026-11-19"), "");
  store.save("2026-11-19", " \n\t");
  assert.deepEqual(fs.readdirSync(root), []);
  store.save("2026-11-19", "你好，世界 🌱\n第二行\n");
  assert.equal(
    new NoteStore(root).read("2026-11-19"),
    "你好，世界 🌱\n第二行\n",
  );
  assert.deepEqual(store.list(), ["2026-11-19"]);
  store.save("2026-11-19", "");
  assert.deepEqual(store.list(), []);
});
test("invalid dates/path traversal and oversized notes cannot overwrite valid data", (t) => {
  const store = new NoteStore(temp(t));
  for (const date of ["../../secret", "2026-02-30", "2026-1-01", null]) {
    assert.equal(validDate(date), false);
    assert.throws(() => store.save(date, "bad"));
  }
  store.save("2026-11-19", "original");
  assert.throws(() => store.save("2026-11-19", "中".repeat(400000)));
  assert.equal(store.read("2026-11-19"), "original");
});
test("failed atomic replacement preserves the previous file", (t) => {
  const root = temp(t),
    store = new NoteStore(root);
  store.save("2026-11-19", "safe");
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("Simulated disk failure");
  };
  try {
    assert.throws(() => store.save("2026-11-19", "replacement"));
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(store.read("2026-11-19"), "safe");
  assert.deepEqual(fs.readdirSync(root), ["2026-11-19.txt"]);
});
test("folder migration copies notes and refuses conflicting contents", (t) => {
  const root = temp(t),
    source = new NoteStore(path.join(root, "a")),
    target = new NoteStore(path.join(root, "b"));
  source.save("2026-11-18", "one");
  source.save("2026-11-19", "two");
  target.save("2026-11-19", "different");
  assert.throws(() => copyNotes(source, target), /内容不同/);
  assert.equal(target.read("2026-11-18"), "");
  assert.equal(source.read("2026-11-19"), "two");
  target.save("2026-11-19", "");
  copyNotes(source, target);
  assert.deepEqual(target.list(), source.list());
  assert.equal(target.read("2026-11-19"), "two");
  copyNotes(source, target);
  assert.equal(source.read("2026-11-18"), "one");
});
const {
  newEntry,
  parseEntries,
  serializeEntries,
} = require("../src/entries.cjs");
test("message format preserves multiline text, trailing newlines, backslashes and header-looking content", () => {
  const fake = "## 2026-11-19 01:02:03 [12345678-1234-1234-1234-123456789012]";
  const entries = [
    newEntry("你好 🌱\n\n换行\n"),
    newEntry(`${fake}\n\\${fake}\n\\path\n\n`),
    newEntry("last"),
  ];
  assert.deepEqual(parseEntries(serializeEntries(entries)), entries);
  assert.deepEqual(parseEntries(" \n"), []);
  const legacy = parseEntries("旧笔记\n\n没有时间戳");
  assert.equal(legacy[0].text, "旧笔记\n\n没有时间戳");
  assert.deepEqual(parseEntries(serializeEntries(legacy)), legacy);
  assert.equal(serializeEntries([]), "");
});
const { createStartup, launchAgent } = require("../src/startup.cjs");
test("macOS startup registration is reversible and safely escapes executable paths", (t) => {
  const home = temp(t),
    executable = "/Applications/A & B <test>.app/Contents/MacOS/Daynote";
  const startup = createStartup(
    { isPackaged: true },
    { platform: "darwin", home, executable },
  );
  assert.equal(startup.enabled(), false);
  startup.set(true);
  assert.equal(startup.enabled(), true);
  const file = path.join(home, "Library/LaunchAgents/com.lemer.daynote.plist");
  const plist = fs.readFileSync(file, "utf8");
  assert.ok(plist.includes("A &amp; B &lt;test&gt;"));
  assert.ok(plist.includes("--hidden"));
  assert.ok(plist.includes("<key>RunAtLoad</key><true/>"));
  if (process.platform === "darwin")
    execFileSync("/usr/bin/plutil", ["-lint", file]);
  startup.set(false);
  assert.equal(startup.enabled(), false);
  assert.equal(fs.existsSync(file), false);
  startup.set(false);
});
test("Windows startup uses the same executable and hidden args to set and read, observes disabled state", (t) => {
  let enabled = false,
    disabled = false;
  const executable = "D:\\Apps\\Daynote.exe";
  const app = {
    isPackaged: true,
    setLoginItemSettings(value) {
      assert.equal(value.path, executable);
      assert.deepEqual(value.args, ["--hidden"]);
      enabled = value.openAtLogin;
    },
    getLoginItemSettings(value) {
      assert.equal(value.path, executable);
      assert.deepEqual(value.args, ["--hidden"]);
      return {
        openAtLogin: enabled,
        executableWillLaunchAtLogin: enabled && !disabled,
      };
    },
  };
  const startup = createStartup(app, {
    platform: "win32",
    home: temp(t),
    executable,
  });
  startup.set(true);
  assert.equal(startup.enabled(), true);
  disabled = true;
  assert.equal(startup.enabled(), false);
  disabled = false;
  startup.set(false);
  assert.equal(startup.enabled(), false);
});
const { DraftStore } = require("../src/core.cjs");
test("drafts persist independently, migrate safely and never create empty daily text files", (t) => {
  const root = temp(t),
    source = new NoteStore(path.join(root, "a")),
    target = new NoteStore(path.join(root, "b"));
  const drafts = new DraftStore(source.root),
    targetDrafts = new DraftStore(target.root);
  const draft = { id: crypto.randomUUID(), text: "没有发送的文字\n第二行" };
  drafts.save("2026-11-19", draft);
  assert.equal(new DraftStore(source.root).read("2026-11-19").text, draft.text);
  assert.deepEqual(source.list(), []);
  copyNotes(source, target);
  assert.equal(targetDrafts.read("2026-11-19").text, draft.text);
  targetDrafts.save("2026-11-19", { ...draft, text: "不同的草稿" });
  assert.throws(() => copyNotes(source, target), /草稿内容不同/);
  drafts.save("2026-11-19", { ...draft, text: "" });
  assert.deepEqual(drafts.list(), []);
  assert.deepEqual(source.list(), []);
});
