const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite } = require("./core.cjs");
const LABEL = "com.lemer.daynote";
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
function launchAgent(executable) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>--hidden</string></array>\n<key>RunAtLoad</key><true/>\n<key>LimitLoadToSessionType</key><string>Aqua</string>\n<key>ProcessType</key><string>Interactive</string>\n</dict></plist>\n`;
}
function createStartup(app, options = {}) {
  const platform = options.platform || process.platform;
  const executable =
    options.executable ||
    process.env.PORTABLE_EXECUTABLE_FILE ||
    process.execPath;
  const home = options.home || app.getPath("home");
  const agent = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const supported = app.isPackaged && ["darwin", "win32"].includes(platform);
  const windows = { path: executable, args: ["--hidden"] };
  function enabled() {
    if (!supported) return false;
    if (platform === "win32") {
      const value = app.getLoginItemSettings(windows);
      return value.openAtLogin && value.executableWillLaunchAtLogin;
    }
    try {
      return fs.readFileSync(agent, "utf8") === launchAgent(executable);
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }
  function set(value) {
    if (!supported) throw new Error("请安装正式版本后设置开机启动。");
    if (typeof value !== "boolean") throw new Error("开机启动设置不正确。");
    if (platform === "win32")
      app.setLoginItemSettings({
        ...windows,
        openAtLogin: value,
        enabled: value,
        name: LABEL,
      });
    else if (value) {
      fs.mkdirSync(path.dirname(agent), { recursive: true, mode: 0o700 });
      atomicWrite(agent, launchAgent(executable));
    } else {
      try {
        fs.unlinkSync(agent);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    if (enabled() !== value)
      throw new Error("系统未接受开机启动设置，请检查系统的启动项设置。");
  }
  return { supported, enabled, set };
}
module.exports = { createStartup, launchAgent };
