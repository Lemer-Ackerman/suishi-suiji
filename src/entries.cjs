const { createHash, randomUUID } = require("node:crypto");
const HEADER =
  /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|未标注时间) \[([a-f0-9-]{36})\]$/;
function timestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function newEntry(text, now = new Date()) {
  return { id: randomUUID(), time: timestamp(now), text };
}
function serializeEntries(entries) {
  return entries
    .map((entry) => {
      const text = entry.text
        .split("\n")
        .map((line) =>
          line.startsWith("\\") || HEADER.test(line) ? `\\${line}` : line,
        )
        .join("\n");
      return `## ${entry.time || "未标注时间"} [${entry.id}]\n${text}`;
    })
    .join("\n\n");
}
function parseEntries(raw) {
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  if (!HEADER.test(lines[0])) {
    const hex = createHash("sha256").update(raw).digest("hex").slice(0, 32);
    return [
      {
        id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        time: null,
        text: raw,
      },
    ];
  }
  const entries = [];
  let current,
    body = [];
  const finish = (separator) => {
    if (!current) return;
    if (separator && body.at(-1) === "") body.pop();
    current.text = body
      .map((line) =>
        line.startsWith("\\") &&
        (line[1] === "\\" || HEADER.test(line.slice(1)))
          ? line.slice(1)
          : line,
      )
      .join("\n");
    entries.push(current);
  };
  for (const line of lines) {
    const match = HEADER.exec(line);
    if (match) {
      finish(true);
      current = {
        id: match[2],
        time: match[1] === "未标注时间" ? null : match[1],
      };
      body = [];
    } else body.push(line);
  }
  finish(false);
  return entries;
}
module.exports = { parseEntries, serializeEntries, newEntry };
