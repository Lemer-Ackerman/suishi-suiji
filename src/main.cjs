const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  shell,
  clipboard,
  powerMonitor,
  dialog,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { isTrustedPage } = require("./security.cjs");
const {
  NoteStore,
  DraftStore,
  validId,
  noteDay,
  validDate,
  atomicWrite,
  MAX_BYTES,
  copyNotes,
} = require("./core.cjs");
const { parseEntries, serializeEntries, newEntry } = require("./entries.cjs");
const { createStartup } = require("./startup.cjs");
app.setName("Daynote");
if (!app.isPackaged && process.env.DAYNOTE_TEST_DATA)
  app.setPath("userData", process.env.DAYNOTE_TEST_DATA);
const now = () =>
  new Date(
    !app.isPackaged && process.env.DAYNOTE_TEST_NOW
      ? process.env.DAYNOTE_TEST_NOW
      : Date.now(),
  );
let win,
  tray,
  store,
  draftStore,
  settingsFile,
  activeDate,
  currentDay,
  rolloverTimer,
  startup;
const startHidden = process.argv.includes("--hidden");
let quitting = false;
let shortcutActive = false;
let settings = { shortcut: "Shift+Space" };
let lastError = "";
const pageFile = path.join(__dirname, "index.html");

function status(message, error = false) {
  lastError = error ? message : "";
  if (win && !win.isDestroyed())
    win.webContents.send("daynote:status", { message, error });
}
function snapshot() {
  const text = store.read(activeDate);
  return {
    date: activeDate,
    today: currentDay,
    entries: parseEntries(text),
    draft: readDraft(activeDate),
    draftDates: draftStore.list().filter((date) => readDraft(date)),
    dates: store.list(),
    pinned: win.isAlwaysOnTop(),
    shortcut: settings.shortcut,
    shortcutActive,
    startOnLogin: startup.enabled(),
    startupSupported: startup.supported,
    folder: store.root,
    error: lastError,
  };
}
function readDraft(date) {
  const draft = draftStore.read(date);
  // A message committed before a crash is authoritative over its leftover draft.
  if (
    draft &&
    parseEntries(store.read(date)).some((entry) => entry.id === draft.id)
  )
    return null;
  return draft;
}
function emitState() {
  if (win && !win.isDestroyed())
    win.webContents.send("daynote:state", snapshot());
}
function rollover() {
  const next = noteDay(now());
  if (next === currentDay) return;
  // Read first: if the destination is unreadable, preserve the existing editor.
  store.read(next);
  currentDay = next;
  activeDate = next;
  emitState();
}
function safeRollover() {
  try {
    rollover();
  } catch (e) {
    status(`无法打开新一天：${e.message}`, true);
  }
}
function show() {
  safeRollover();
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
function hide() {
  win.hide();
}
function toggle() {
  if (win.isVisible() && !win.isMinimized()) hide();
  else show();
}
function registerShortcut(shortcut) {
  try {
    return globalShortcut.register(shortcut, toggle);
  } catch {
    return false;
  }
}
function setShortcut(shortcut) {
  if (
    typeof shortcut !== "string" ||
    shortcut.length > 100 ||
    !/^(?:(?:CommandOrControl|Command|Control|Alt|Shift|Super)\+)+(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(
      shortcut,
    )
  )
    throw new Error("请按下包含 Shift、Ctrl、Alt 或 Command 的组合键。");
  if (shortcut === settings.shortcut && shortcutActive) return;
  if (!registerShortcut(shortcut))
    throw new Error("此快捷键已被系统或其他程序占用，请换一个组合键。");
  const old = settings.shortcut;
  try {
    atomicWrite(
      settingsFile,
      JSON.stringify({ ...settings, shortcut }, null, 2),
    );
  } catch (e) {
    globalShortcut.unregister(shortcut);
    throw e;
  }
  if (old !== shortcut && shortcutActive) globalShortcut.unregister(old);
  settings.shortcut = shortcut;
  shortcutActive = true;
  updateTray();
}
function updateTray() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 / 隐藏日笺", click: toggle },
      {
        label: "窗口置顶",
        type: "checkbox",
        checked: win.isAlwaysOnTop(),
        click: (item) => {
          win.setAlwaysOnTop(item.checked, "floating");
          emitState();
          updateTray();
        },
      },
      { label: "打开笔记文件夹", click: () => shell.openPath(store.root) },
      { type: "separator" },
      { label: "退出日笺", click: () => app.quit() },
    ]),
  );
}
function createWindow() {
  win = new BrowserWindow({
    width: 540,
    height: 740,
    minWidth: 390,
    minHeight: 500,
    show: false,
    alwaysOnTop: true,
    frame: false,
    backgroundColor: "#f8f7f3",
    title: "日笺 · Daynote",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      hide();
    }
  });
  win.once("ready-to-show", () => {
    if (!startHidden) show();
  });
  win.loadFile(path.join(__dirname, "index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (win && !argv.includes("--hidden")) show();
  });
  app
    .whenReady()
    .then(async () => {
      startup = createStartup(app);
      settingsFile = path.join(app.getPath("userData"), "settings.json");
      try {
        const loaded = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
        if (typeof loaded.shortcut === "string")
          settings.shortcut = loaded.shortcut;
        if (
          typeof loaded.notesDir === "string" &&
          path.isAbsolute(loaded.notesDir)
        )
          settings.notesDir = loaded.notesDir;
      } catch (e) {
        if (e.code !== "ENOENT")
          lastError = "快捷键设置无法读取，已使用默认快捷键。";
      }
      const defaultDir =
        !app.isPackaged && process.env.DAYNOTE_TEST_DATA
          ? path.join(app.getPath("userData"), "notes")
          : process.platform === "win32"
            ? "D:\\Daynote"
            : path.join(app.getPath("documents"), "Daynote");
      try {
        if (
          !settings.notesDir &&
          process.platform === "win32" &&
          !process.env.DAYNOTE_TEST_DATA &&
          !fs.existsSync("D:\\")
        )
          throw new Error("没有可用的 D 盘");
        store = new NoteStore(settings.notesDir || defaultDir);
        fs.accessSync(store.root, fs.constants.W_OK);
      } catch {
        const picked = await dialog.showOpenDialog({
          title: "默认笔记文件夹不可用，请选择保存位置",
          properties: ["openDirectory", "createDirectory"],
        });
        if (picked.canceled) {
          app.quit();
          return;
        }
        store = new NoteStore(picked.filePaths[0]);
      }
      settings.notesDir = store.root;
      atomicWrite(settingsFile, JSON.stringify(settings, null, 2));
      currentDay = activeDate = noteDay(now());
      draftStore = new DraftStore(store.root);
      if (!readDraft(activeDate)) {
        const recovery = draftStore
          .list()
          .map((date) => ({ date, draft: readDraft(date) }))
          .filter((item) => item.draft)
          .sort((a, b) => b.draft.updatedAt - a.draft.updatedAt)[0];
        if (recovery) activeDate = recovery.date;
      }
      createWindow();
      shortcutActive = registerShortcut(settings.shortcut);
      if (!shortcutActive)
        lastError = "快捷键被占用，请在设置中更换；也可从托盘打开窗口。";
      const icon = nativeImage
        .createFromPath(path.join(__dirname, "../build/tray.png"))
        .resize({ width: 18, height: 18 });
      if (process.platform === "darwin") icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setToolTip("日笺 · Daynote");
      tray.on("click", toggle);
      updateTray();
      const menu = [
        {
          label: "日笺",
          submenu: [
            { label: "显示日笺", click: show },
            {
              label: "退出日笺",
              accelerator: "CommandOrControl+Q",
              click: () => app.quit(),
            },
          ],
        },
        { role: "editMenu" },
      ];
      Menu.setApplicationMenu(
        process.platform === "darwin" ? Menu.buildFromTemplate(menu) : null,
      );
      ipcMain.handle("daynote:action", async (event, action, payload = {}) => {
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          !isTrustedPage(event.senderFrame.url, pageFile)
        )
          return { ok: false, error: "不允许的请求。" };
        try {
          switch (action) {
            case "load":
              return { ok: true, state: snapshot() };
            case "draft":
              draftStore.save(payload.date, {
                id: payload.id,
                text: payload.text,
              });
              return { ok: true };
            case "send": {
              if (
                !validDate(payload.date) ||
                !validId(payload.id) ||
                typeof payload.text !== "string" ||
                !payload.text.trim()
              )
                throw new Error("请先输入内容。");
              if (Buffer.byteLength(payload.text, "utf8") > MAX_BYTES)
                throw new Error("单日笔记请保持在 1 MB 以内。");
              const entries = parseEntries(store.read(payload.date));
              const existing = entries.find((entry) => entry.id === payload.id);
              if (existing && existing.text !== payload.text)
                throw new Error("记录已经发送，请重新打开该日期。");
              if (!existing) {
                const entry = newEntry(payload.text, now());
                entry.id = payload.id;
                entries.push(entry);
                store.save(payload.date, serializeEntries(entries));
              }
              // Cleanup can be retried safely; never turn a committed message into a duplicate.
              try {
                if (draftStore.read(payload.date)?.id === payload.id)
                  draftStore.clear(payload.date);
              } catch {}
              lastError = "";
              break;
            }
            case "select": {
              if (!validDate(payload.date)) throw new Error("日期格式不正确。");
              store.read(payload.date);
              activeDate = payload.date;
              break;
            }
            case "delete": {
              if (!validDate(payload.date)) throw new Error("日期格式不正确。");
              // The renderer asks for explicit confirmation before this command.
              if (payload.id) {
                const entries = parseEntries(store.read(payload.date));
                if (!entries.some((entry) => entry.id === payload.id))
                  throw new Error("这条记录已经变更，请重新打开该日期。");
                store.save(
                  payload.date,
                  serializeEntries(
                    entries.filter((entry) => entry.id !== payload.id),
                  ),
                );
              } else store.save(payload.date, "");
              lastError = "";
              break;
            }
            case "copy":
              clipboard.writeText(
                payload.text === undefined
                  ? snapshot()
                      .entries.map((entry) => entry.text)
                      .join("\n\n")
                  : String(payload.text),
              );
              return { ok: true };
            case "pin":
              win.setAlwaysOnTop(!win.isAlwaysOnTop(), "floating");
              updateTray();
              break;
            case "shortcut":
              setShortcut(payload.shortcut);
              break;
            case "startup":
              startup.set(payload.enabled);
              break;
            case "change-folder": {
              const picked = await dialog.showOpenDialog(win, {
                title: "选择笔记保存文件夹",
                defaultPath: store.root,
                properties: ["openDirectory", "createDirectory"],
              });
              if (picked.canceled) return { ok: true };
              const target = new NoteStore(picked.filePaths[0]);
              fs.accessSync(target.root, fs.constants.W_OK);
              copyNotes(store, target);
              const nextSettings = { ...settings, notesDir: target.root };
              atomicWrite(settingsFile, JSON.stringify(nextSettings, null, 2));
              settings = nextSettings;
              store = target;
              draftStore = new DraftStore(store.root);
              break;
            }
            case "folder": {
              const error = await shell.openPath(store.root);
              if (error) throw new Error(error);
              return { ok: true };
            }
            case "hide":
              hide();
              return { ok: true };
            case "quit":
              app.quit();
              return { ok: true };
            default:
              throw new Error("未知操作。");
          }
          return { ok: true, state: snapshot() };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      rolloverTimer = setInterval(safeRollover, 1000);
      powerMonitor.on("resume", safeRollover);
      app.on("activate", show);
    })
    .catch((error) => {
      dialog.showErrorBox("日笺无法启动", error.message);
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    quitting = true;
  });
  app.on("will-quit", () => {
    clearInterval(rolloverTimer);
    globalShortcut.unregisterAll();
  });
}
