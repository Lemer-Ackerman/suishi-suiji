const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const MAX_BYTES = 1024 * 1024;

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function noteDay(now = new Date()) {
  const day = new Date(now);
  // Calendar arithmetic, not subtracting milliseconds: correct across DST changes.
  if (day.getHours() < 4) day.setDate(day.getDate() - 1);
  return dateKey(day);
}
function validDate(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = new Date(`${key}T12:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === key;
}
function atomicWrite(file, text) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temp);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
class NoteStore {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  file(key) {
    if (!validDate(key)) throw new Error("日期格式不正确。");
    return path.join(this.root, `${key}.txt`);
  }
  read(key) {
    try {
      return fs.readFileSync(this.file(key), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw e;
    }
  }
  save(key, text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES)
      throw new Error("单日笔记请保持在 1 MB 以内。");
    const file = this.file(key);
    if (!text.trim()) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return;
    }
    atomicWrite(file, text);
  }
  list() {
    return fs
      .readdirSync(this.root)
      .filter(
        (name) =>
          /^\d{4}-\d{2}-\d{2}\.txt$/.test(name) && validDate(name.slice(0, -4)),
      )
      .map((name) => name.slice(0, -4))
      .sort();
  }
}
function copyNotes(source, target) {
  const dates = source.list();
  for (const date of dates) {
    if (
      fs.existsSync(target.file(date)) &&
      target.read(date) !== source.read(date)
    ) {
      throw new Error(
        `目标文件夹中的 ${date}.txt 内容不同，未切换位置。请选择空文件夹。`,
      );
    }
  }
  for (const date of dates) {
    if (!fs.existsSync(target.file(date))) target.save(date, source.read(date));
  }
}
module.exports = {
  dateKey,
  noteDay,
  validDate,
  atomicWrite,
  NoteStore,
  MAX_BYTES,
  copyNotes,
};
