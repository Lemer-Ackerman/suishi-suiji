const $ = (id) => document.getElementById(id);
let state, month, pendingShortcut, deletion, toastTimer;
let sending = false,
  navigating = false;
let composerId = null;
function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parse(date) {
  return new Date(`${date}T12:00:00`);
}
function shortcutLabel(value) {
  return value
    .replaceAll(
      "CommandOrControl",
      navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
    )
    .replaceAll("Command", "⌘")
    .replaceAll("Control", "Ctrl")
    .replaceAll("Super", navigator.platform.includes("Mac") ? "⌘" : "Win")
    .replaceAll("+", " + ");
}
function toast(message, error = false) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  if (!error) toastTimer = setTimeout(() => ($("toast").hidden = true), 2800);
}
async function call(action, payload) {
  try {
    const result = await window.daynote.call(action, payload);
    if (!result.ok) throw new Error(result.error || "操作未完成。");
    return result;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}
function closeMenu() {
  $("menu").hidden = true;
  $("more").setAttribute("aria-expanded", "false");
}
function resizeComposer() {
  $("editor").style.height = "auto";
  $("editor").style.height = Math.min($("editor").scrollHeight, 140) + "px";
  $("send").disabled = sending || !$("editor").value.trim();
}
function renderCalendar() {
  $("month-label").textContent =
    `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  $("calendar-days").replaceChildren();
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const dateKey = key(date);
    const button = document.createElement("button");
    button.textContent = date.getDate();
    button.dataset.date = dateKey;
    button.setAttribute(
      "aria-label",
      `${dateKey}${state.dates.includes(dateKey) ? " 有记录" : ""}${state.draftDates.includes(dateKey) ? " 有未发送草稿" : ""}`,
    );
    button.setAttribute("aria-pressed", String(dateKey === state.date));
    if (date.getMonth() !== month.getMonth()) button.classList.add("outside");
    if (dateKey === state.date) button.classList.add("selected");
    if (dateKey === state.today) button.classList.add("today");
    if (state.dates.includes(dateKey)) button.classList.add("has-note");
    if (state.draftDates.includes(dateKey)) button.classList.add("has-draft");
    button.onclick = () => select(dateKey);
    $("calendar-days").append(button);
  }
}
function askDelete(entry) {
  closeMenu();
  deletion = { date: state.date, ...(entry ? { id: entry.id } : {}) };
  $("delete-title").textContent = entry
    ? "删除这条记录？"
    : "删除当天全部记录？";
  $("delete-description").textContent = entry
    ? entry.text
    : `即将删除 ${state.date} 的全部 ${state.entries.length} 条记录及对应文本文件。`;
  $("delete-dialog").showModal();
  $("cancel-delete").focus();
}
function renderMessages() {
  const list = $("messages");
  list.replaceChildren();
  for (const entry of state.entries) {
    const article = document.createElement("article");
    article.className = "message";
    article.dataset.id = entry.id;
    if (entry.time) {
      const time = document.createElement("time");
      time.className = "message-time";
      time.textContent = entry.time.slice(11, 19);
      time.dateTime = entry.time.replace(" ", "T");
      time.title = entry.time;
      article.append(time);
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = entry.text;
    article.append(bubble);
    const controls = document.createElement("div");
    controls.className = "message-tools";
    const copy = document.createElement("button");
    copy.textContent = "复制";
    copy.setAttribute("aria-label", "复制这条记录");
    copy.onclick = () =>
      call("copy", { text: entry.text })
        .then(() => toast("已复制"))
        .catch(() => {});
    const remove = document.createElement("button");
    remove.textContent = "删除";
    remove.className = "danger";
    remove.setAttribute("aria-label", "删除这条记录");
    remove.onclick = () => askDelete(entry);
    controls.append(copy, remove);
    article.append(controls);
    list.append(article);
  }
  $("empty-state").hidden = state.entries.length > 0;
  $("copy-all").disabled = $("delete-all").disabled = !state.entries.length;
  list.scrollTop = list.scrollHeight;
}
function apply(next) {
  const changed = state && state.date !== next.date;
  if (!state || changed) {
    $("editor").value = next.draft?.text || "";
    composerId = next.draft?.id || null;
  }
  if (changed) {
    $("delete-dialog").close();
  }
  state = next;
  const date = parse(state.date);
  month = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  $("page-title").textContent =
    state.date === state.today
      ? "日笺"
      : `${date.getMonth() + 1}月${date.getDate()}日 · 往日记录`;
  $("menu-date").textContent =
    `${state.date}${state.date === state.today ? " · 今天" : ""}`;
  $("pin").setAttribute("aria-pressed", String(state.pinned));
  $("pin-label").textContent = state.pinned ? "取消窗口置顶" : "窗口置顶";
  $("shortcut-hint").textContent = state.shortcutActive
    ? shortcutLabel(state.shortcut)
    : "快捷键待设置";
  $("folder-path").textContent = state.folder;
  $("start-on-login").checked = state.startOnLogin;
  $("start-on-login").disabled = !state.startupSupported;
  $("startup-help").textContent = state.startupSupported
    ? "登录电脑后在后台待命，按快捷键随时唤出。"
    : "安装正式版本后可设置开机启动。";
  renderMessages();
  renderCalendar();
  resizeComposer();
  $("compose-help").textContent = $("editor").value.trim()
    ? "草稿已保存 · Enter 发送 · Shift + Enter 换行"
    : "Enter 发送 · Shift + Enter 换行";
  if (state.error) toast(state.error, true);
}
async function select(date) {
  if (navigating || sending) return;
  navigating = true;
  try {
    const result = await call("select", { date });
    apply(result.state);
    $("calendar-dialog").close();
    $("editor").focus();
  } catch {
  } finally {
    navigating = false;
  }
}
function run(action, payload) {
  return call(action, payload)
    .then((result) => {
      if (result.state) apply(result.state);
    })
    .catch(() => {});
}
$("composer").onsubmit = async (event) => {
  event.preventDefault();
  if (sending || !state || !$("editor").value.trim()) return;
  const text = $("editor").value,
    date = state.date,
    id = composerId || crypto.randomUUID();
  composerId = id;
  sending = true;
  $("editor").readOnly = true;
  resizeComposer();
  try {
    const result = await call("send", { date, text, id });
    if (state.date === date && $("editor").value === text) {
      $("editor").value = "";
      composerId = null;
    }
    apply(result.state);
    $("toast").hidden = true;
  } catch {
  } finally {
    sending = false;
    $("editor").readOnly = false;
    resizeComposer();
    $("editor").focus();
  }
};
$("editor").addEventListener("input", () => {
  resizeComposer();
  if (!state) return;
  composerId ||= crypto.randomUUID();
  const date = state.date,
    text = $("editor").value,
    id = composerId;
  $("compose-help").textContent = "正在保存草稿…";
  call("draft", { date, text, id })
    .then(() => {
      const dates = new Set(state.draftDates);
      if (text.trim()) dates.add(date);
      else dates.delete(date);
      state.draftDates = [...dates];
      if (state.date === date && $("editor").value === text)
        $("compose-help").textContent = text.trim()
          ? "草稿已保存 · Enter 发送 · Shift + Enter 换行"
          : "Enter 发送 · Shift + Enter 换行";
    })
    .catch(() => {
      $("compose-help").textContent = "草稿保存失败，请暂时不要退出";
    });
});
$("editor").addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});
$("more").onclick = () => {
  $("menu").hidden = !$("menu").hidden;
  $("more").setAttribute("aria-expanded", String(!$("menu").hidden));
};
document.addEventListener("click", (event) => {
  if (!event.target.closest("#menu") && !event.target.closest("#more"))
    closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
$("calendar-toggle").onclick = () => {
  closeMenu();
  renderCalendar();
  $("calendar-dialog").showModal();
};
$("close-calendar").onclick = () => $("calendar-dialog").close();
$("prev-month").onclick = () => {
  month.setMonth(month.getMonth() - 1);
  renderCalendar();
};
$("next-month").onclick = () => {
  month.setMonth(month.getMonth() + 1);
  renderCalendar();
};
$("today").onclick = () => select(state.today);
$("pin").onclick = () => {
  closeMenu();
  run("pin");
};
$("hide").onclick = () => {
  closeMenu();
  run("hide");
};
$("copy-all").onclick = () => {
  closeMenu();
  call("copy", { text: state.entries.map((e) => e.text).join("\n\n") })
    .then(() => toast("已复制当天全部记录"))
    .catch(() => {});
};
$("delete-all").onclick = () => askDelete();
$("cancel-delete").onclick = () => $("delete-dialog").close();
$("confirm-delete").onclick = async () => {
  $("confirm-delete").disabled = true;
  try {
    const result = await call("delete", deletion);
    apply(result.state);
    $("delete-dialog").close();
    toast("记录已删除");
  } catch {
  } finally {
    $("confirm-delete").disabled = false;
  }
};
$("settings").onclick = () => {
  closeMenu();
  pendingShortcut = state.shortcut;
  $("shortcut-input").value = shortcutLabel(pendingShortcut);
  $("settings-status").textContent = state.shortcutActive
    ? ""
    : "当前快捷键不可用，请重新设置。";
  $("settings-dialog").showModal();
};
$("close-settings").onclick = () => $("settings-dialog").close();
$("shortcut-input").addEventListener("keydown", (event) => {
  if (
    event.key === "Tab" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey
  )
    return;
  if (event.key === "Escape") return;
  event.preventDefault();
  const parts = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey)
    parts.push(navigator.platform.includes("Mac") ? "Command" : "Super");
  if (!parts.length || ["Control", "Alt", "Shift", "Meta"].includes(event.key))
    return;
  const aliases = {
    Space: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  const pressed =
    aliases[event.code] || event.code.replace(/^Key/, "").replace(/^Digit/, "");
  if (
    !/^(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(
      pressed,
    )
  )
    return;
  parts.push(pressed);
  pendingShortcut = parts.join("+");
  $("shortcut-input").value = shortcutLabel(pendingShortcut);
});
$("reset-shortcut").onclick = () => {
  pendingShortcut = "Shift+Space";
  $("shortcut-input").value = shortcutLabel(pendingShortcut);
};
$("save-shortcut").onclick = async () => {
  try {
    const result = await call("shortcut", { shortcut: pendingShortcut });
    apply(result.state);
    $("settings-status").textContent = "快捷键已保存";
  } catch (e) {
    $("settings-status").textContent = e.message;
  }
};
$("open-folder").onclick = () => run("folder");
$("start-on-login").onchange = async () => {
  const enabled = $("start-on-login").checked;
  $("start-on-login").disabled = true;
  try {
    const result = await call("startup", { enabled });
    apply(result.state);
    $("settings-status").textContent = enabled
      ? "已开启，下次登录电脑时生效"
      : "已关闭开机自动启动";
  } catch (e) {
    $("start-on-login").checked = state.startOnLogin;
    $("settings-status").textContent = e.message;
  } finally {
    $("start-on-login").disabled = !state.startupSupported;
  }
};
$("change-folder").onclick = async () => {
  $("change-folder").disabled = true;
  try {
    const result = await call("change-folder");
    if (result.state) {
      apply(result.state);
      $("settings-status").textContent = "保存位置已更换，已有记录已复制。";
    }
  } catch (e) {
    $("settings-status").textContent = e.message;
  } finally {
    $("change-folder").disabled = false;
  }
};
$("quit").onclick = () => run("quit");
window.daynote.onState((next) => {
  const flipped = state && next.today !== state.today;
  apply(next);
  if (flipped) {
    $("calendar-dialog").close();
    toast("凌晨 4 点，已翻开新的一页");
  }
});
window.daynote.onStatus((status) => toast(status.message, status.error));
call("load")
  .then((result) => {
    apply(result.state);
    if (result.state.draft) toast("已恢复上次未发送的内容");
    $("editor").focus();
  })
  .catch(() => {});
