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
const validId = (id) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
class DraftStore {
  constructor(notesRoot) {
    this.root = path.join(notesRoot, ".drafts");
  }
  file(date) {
    if (!validDate(date)) throw new Error("日期格式不正确。");
    return path.join(this.root, `${date}.json`);
  }
  read(date) {
    try {
      const draft = JSON.parse(fs.readFileSync(this.file(date), "utf8"));
      if (!validId(draft.id) || typeof draft.text !== "string")
        throw new Error("草稿文件格式不正确。");
      return draft;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  save(date, draft) {
    const file = this.file(date);
    if (
      !validId(draft.id) ||
      typeof draft.text !== "string" ||
      Buffer.byteLength(draft.text, "utf8") > MAX_BYTES
    )
      throw new Error("草稿格式不正确或超过 1 MB。");
    if (!draft.text.trim()) return this.clear(date);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    atomicWrite(
      file,
      JSON.stringify({ id: draft.id, text: draft.text, updatedAt: Date.now() }),
    );
  }
  clear(date) {
    try {
      fs.unlinkSync(this.file(date));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  list() {
    try {
      return fs
        .readdirSync(this.root)
        .filter(
          (name) =>
            /^\d{4}-\d{2}-\d{2}\.json$/.test(name) &&
            validDate(name.slice(0, -5)),
        )
        .map((name) => name.slice(0, -5));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
}
function copyNotes(source, target) {
  const dates = source.list();
  const sourceDrafts = new DraftStore(source.root),
    targetDrafts = new DraftStore(target.root);
  for (const date of sourceDrafts.list()) {
    const existing = targetDrafts.read(date);
    if (existing && existing.text !== sourceDrafts.read(date).text)
      throw new Error(`目标文件夹中 ${date} 的草稿内容不同，未切换位置。`);
  }
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
  for (const date of sourceDrafts.list()) {
    if (!targetDrafts.read(date))
      targetDrafts.save(date, sourceDrafts.read(date));
  }
}
module.exports = {
  dateKey,
  noteDay,
  validDate,
  atomicWrite,
  NoteStore,
  DraftStore,
  validId,
  MAX_BYTES,
  copyNotes,
};
