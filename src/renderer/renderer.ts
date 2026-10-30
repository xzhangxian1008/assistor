import type { CommandId, Entry, EntryStatus, Task } from "../shared/types";

type View = "all" | number;
type SidebarView = "entries" | "archive";

interface State {
  tasks: Task[];
  archivedTasks: Task[];
  openTaskIds: number[];
  currentView: View;
  allEntries: Entry[];
  entries: Entry[];
  selectedEntryId: number | null;
  selectedArchiveId: number | null;
  collapsedDates: Set<string>;
  sidebarView: SidebarView;
}

const state: State = {
  tasks: [],
  archivedTasks: [],
  openTaskIds: [],
  currentView: "all",
  allEntries: [],
  entries: [],
  selectedEntryId: null,
  selectedArchiveId: null,
  collapsedDates: new Set(),
  sidebarView: "entries",
};

const isMac = window.assistor.platform === "darwin";
const modKey = isMac ? "⌘" : "Ctrl+";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const tabs = $("taskTabs");
const entryTree = $("entryTree");
const archiveList = $("archiveList");
const statusSelect = $<HTMLSelectElement>("statusSelect");
const taskSelect = $<HTMLSelectElement>("taskSelect");
const endField = $("endField");
const endEntryInput = $<HTMLInputElement>("endEntryInput");
const startEntryList = $("startEntryList");
const contentInput = $<HTMLTextAreaElement>("contentInput");

/* ---------------------------------------------------------------- helpers */

const ICONS = {
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  chevronRight: '<path d="M6 4l4 4-4 4"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  task: '<path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5v3.5h3.5M5.5 9h5M5.5 11.5h3"/>',
  all: '<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"/>',
  start: '<circle cx="8" cy="8" r="5.5"/><path d="M6.5 5.5l4 2.5-4 2.5z"/>',
  startDone: '<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8.2l1.8 1.8 3.4-3.8"/>',
  end: '<circle cx="8" cy="8" r="5.5"/><rect x="6" y="6" width="4" height="4" rx=".5"/>',
  note: '<path d="M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2.5"/>',
  restore: '<path d="M3 8a5 5 0 1 0 1.5-3.5L3 6M3 2.5V6h3.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9M7 7v4.5M9 7v4.5"/>',
  archive: '<rect x="2" y="2.5" width="12" height="3.5" rx=".5"/><path d="M3 6v7.5h10V6M6.5 9h3"/>',
};

function icon(name: keyof typeof ICONS, className = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  if (className) svg.setAttribute("class", className);
  svg.innerHTML = ICONS[name];
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^(Assistor)?Error:\s*/, "");
}

const pad = (value: number) => String(value).padStart(2, "0");

function formatDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${formatDate(value)} ${formatTime(value)}:${pad(date.getSeconds())}`;
}

function relativeDay(date: string): string {
  const today = formatDate(new Date().toISOString());
  const yesterday = formatDate(new Date(Date.now() - 86_400_000).toISOString());
  if (date === today) return "今天";
  if (date === yesterday) return "昨天";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T00:00:00`).getDay()];
}

function statusText(entry: Entry): string {
  if (entry.status === "start") return entry.is_completed ? "开始 · 已结束" : "开始 · 进行中";
  if (entry.status === "end") return `结束 #${entry.end_of_entry_id}`;
  return "记录";
}

function statusClass(entry: Entry): string {
  if (entry.status === "start" && !entry.is_completed) return "status-open";
  if (entry.status === "note") return "status-note";
  return "status-done";
}

function statusIcon(entry: Entry): keyof typeof ICONS {
  if (entry.status === "start") return entry.is_completed ? "startDone" : "start";
  return entry.status === "end" ? "end" : "note";
}

function currentTask(): Task | undefined {
  return typeof state.currentView === "number" ? state.tasks.find((task) => task.id === state.currentView) : undefined;
}

function openStarts(taskId?: number): Entry[] {
  return state.allEntries.filter(
    (entry) => entry.status === "start" && !entry.is_completed && (taskId === undefined || entry.task_id === taskId),
  );
}

function setStatus(message: string): void {
  $("statusText").textContent = message;
}

/* ---------------------------------------------------------- notifications */

function notify(message: string, isError = false): void {
  const container = $("notifications");
  const item = el("div", `notification ${isError ? "error" : ""}`);
  const close = el("button", "action-icon");
  close.title = "关闭";
  close.append(icon("close"));
  close.addEventListener("click", () => item.remove());
  item.append(el("div", "notification-icon", isError ? "!" : "i"), el("div", "notification-message", message), close);
  container.append(item);
  while (container.children.length > 3) container.firstElementChild?.remove();
  window.setTimeout(() => item.remove(), isError ? 8000 : 4000);
}

/* ------------------------------------------------------------ quick input */

interface QuickPickItem<T> {
  label: string;
  description?: string;
  keybinding?: string;
  value: T;
}

let closeQuickInput: (() => void) | null = null;

function highlight(target: HTMLElement, text: string, query: string): void {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) {
    target.textContent = text;
    return;
  }
  target.append(text.slice(0, index), el("mark", "", text.slice(index, index + query.length)), text.slice(index + query.length));
}

function openQuickInput<T>(options: {
  title?: string;
  placeholder: string;
  value?: string;
  items?: QuickPickItem<T>[];
  validate?: (value: string) => string | null;
}): Promise<T | string | null> {
  closeQuickInput?.();
  const widget = $("quickInput");
  const box = $<HTMLInputElement>("quickInputBox");
  const list = $("quickInputList");
  const message = $("quickInputMessage");
  const previousFocus = document.activeElement as HTMLElement | null;
  $("quickInputTitle").textContent = options.title ?? "";
  box.placeholder = options.placeholder;
  box.value = options.value ?? "";
  message.textContent = options.items ? "" : "按 Enter 确认，按 Esc 取消";
  message.classList.remove("error");
  widget.classList.remove("hidden");
  box.focus();
  box.select();

  return new Promise((resolve) => {
    let filtered: QuickPickItem<T>[] = [];
    let active = 0;

    const renderList = () => {
      if (!options.items) return;
      const query = box.value.trim();
      filtered = options.items.filter((item) =>
        `${item.label} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      );
      active = Math.min(active, Math.max(filtered.length - 1, 0));
      list.replaceChildren();
      if (filtered.length === 0) list.append(el("div", "quick-empty", "没有匹配的结果"));
      filtered.forEach((item, index) => {
        const row = el("div", `quick-item ${index === active ? "active" : ""}`);
        row.setAttribute("role", "option");
        const label = el("span", "label");
        highlight(label, item.label, query);
        row.append(label);
        if (item.description) row.append(el("span", "description", item.description));
        if (item.keybinding) row.append(el("span", "keybinding", item.keybinding));
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          finish(item.value);
        });
        list.append(row);
      });
      list.querySelector(".quick-item.active")?.scrollIntoView({ block: "nearest" });
    };

    const finish = (value: T | string | null) => {
      box.removeEventListener("keydown", onKey);
      box.removeEventListener("input", onInput);
      box.removeEventListener("blur", onBlur);
      widget.classList.add("hidden");
      list.replaceChildren();
      closeQuickInput = null;
      previousFocus?.focus?.();
      resolve(value);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (options.items) {
          if (filtered[active]) finish(filtered[active].value);
          return;
        }
        const error = options.validate?.(box.value) ?? null;
        if (error) {
          message.textContent = error;
          message.classList.add("error");
          return;
        }
        finish(box.value);
      } else if (options.items && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        if (filtered.length === 0) return;
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
        renderList();
      }
    };
    const onInput = () => {
      active = 0;
      if (options.items) renderList();
      else {
        message.textContent = "按 Enter 确认，按 Esc 取消";
        message.classList.remove("error");
      }
    };
    const onBlur = () => finish(null);

    box.addEventListener("keydown", onKey);
    box.addEventListener("input", onInput);
    box.addEventListener("blur", onBlur);
    closeQuickInput = () => finish(null);
    renderList();
  });
}

const showInputBox = (options: { title?: string; placeholder: string; value?: string; validate?: (value: string) => string | null }) =>
  openQuickInput<never>(options) as Promise<string | null>;

const showQuickPick = <T>(items: QuickPickItem<T>[], placeholder: string) =>
  openQuickInput<T>({ items, placeholder }) as Promise<T | null>;

/* ----------------------------------------------------------------- dialog */

function showConfirm(message: string, detail: string, confirmLabel: string): Promise<boolean> {
  const backdrop = $("dialogBackdrop");
  const confirm = $<HTMLButtonElement>("dialogConfirm");
  const cancel = $<HTMLButtonElement>("dialogCancel");
  $("dialogMessage").textContent = message;
  $("dialogDetail").textContent = detail;
  confirm.textContent = confirmLabel;
  confirm.classList.add("danger");
  backdrop.classList.remove("hidden");
  cancel.focus();
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      backdrop.classList.add("hidden");
      confirm.removeEventListener("click", onConfirm);
      cancel.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onConfirm = () => done(true);
    const onCancel = () => done(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        done(false);
      }
    };
    confirm.addEventListener("click", onConfirm);
    cancel.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey, true);
  });
}

/* ----------------------------------------------------------- context menu */

interface MenuAction {
  label: string;
  keybinding?: string;
  run: () => void;
}

function showContextMenu(event: MouseEvent, actions: (MenuAction | "-")[], anchor?: HTMLElement): void {
  event.preventDefault();
  const menu = $("contextMenu");
  menu.replaceChildren();
  for (const action of actions) {
    if (action === "-") {
      menu.append(el("div", "menu-separator"));
      continue;
    }
    const item = el("div", "menu-item");
    item.setAttribute("role", "menuitem");
    item.append(el("span", "", action.label));
    if (action.keybinding) item.append(el("span", "keybinding", action.keybinding));
    item.addEventListener("click", () => {
      hideContextMenu();
      action.run();
    });
    menu.append(item);
  }
  menu.classList.remove("hidden");
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect();
  const x = anchorRect ? anchorRect.left : event.clientX;
  const y = anchorRect ? anchorRect.top - rect.height - 2 : event.clientY;
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
}

function hideContextMenu(): void {
  $("contextMenu").classList.add("hidden");
}

/* -------------------------------------------------------------- rendering */

function renderTabs(): void {
  tabs.replaceChildren();
  const all = el("div", `tab pinned ${state.currentView === "all" ? "active" : ""}`);
  all.setAttribute("role", "tab");
  all.title = "全部任务的所有条目";
  all.append(icon("all", "tab-icon"), el("span", "tab-label", "全部"));
  all.addEventListener("click", () => void selectView("all"));
  tabs.append(all);

  for (const taskId of state.openTaskIds) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) continue;
    const tab = el("div", `tab ${state.currentView === task.id ? "active" : ""}`);
    tab.setAttribute("role", "tab");
    tab.dataset.taskId = String(task.id);
    const pending = openStarts(task.id).length;
    tab.title = `${task.name}${pending ? `（${pending} 个未结束的开始条目）` : ""}\n双击重命名，关闭即存档`;
    const close = el("span", "tab-close");
    close.title = `关闭并存档 (${modKey}W)`;
    close.append(icon("close"));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void archiveTask(task.id);
    });
    tab.append(icon("task", "tab-icon"), el("span", "tab-label", task.name));
    if (pending) tab.append(el("span", "tab-dot"));
    tab.append(close);
    tab.addEventListener("click", () => void selectView(task.id));
    tab.addEventListener("dblclick", () => void renameTask(task.id));
    tab.addEventListener("auxclick", (event) => {
      if (event.button === 1) void archiveTask(task.id);
    });
    tab.addEventListener("contextmenu", (event) =>
      showContextMenu(event, [
        { label: "重命名任务", keybinding: "F2", run: () => void renameTask(task.id) },
        "-",
        { label: "关闭并存档", keybinding: `${modKey}W`, run: () => void archiveTask(task.id) },
      ]),
    );
    tabs.append(tab);
  }
  tabs.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function groupByDate(entries: Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const date = formatDate(entry.created_at);
    const items = groups.get(date) ?? [];
    items.push(entry);
    groups.set(date, items);
  }
  return groups;
}

function renderTree(): void {
  const task = currentTask();
  $("paneTitle").textContent = task ? task.name : "全部任务";
  $("paneBadge").textContent = String(state.entries.length);
  entryTree.replaceChildren();
  if (state.entries.length === 0) {
    entryTree.append(el("div", "empty-tree", "还没有条目。在下方“新建条目”面板输入内容并保存，就会出现在这里。"));
    return;
  }
  for (const [date, entries] of groupByDate(state.entries)) {
    const collapsed = state.collapsedDates.has(date);
    const header = el("div", `tree-row date-row ${collapsed ? "collapsed" : ""}`);
    header.setAttribute("role", "treeitem");
    header.setAttribute("aria-expanded", String(!collapsed));
    header.dataset.date = date;
    const twistie = el("span", "twistie");
    twistie.append(icon("chevronDown"));
    const label = el("span", "tree-label");
    label.append(el("span", "text date-label", date), el("span", "description", relativeDay(date)));
    header.append(twistie, el("span", "tree-icon"), label, el("span", "count-badge", String(entries.length)));
    header.querySelector(".tree-icon")!.append(icon("calendar"));
    header.addEventListener("click", () => toggleDate(date));
    entryTree.append(header);
    if (!collapsed) for (const entry of entries) entryTree.append(createEntryRow(entry));
  }
  entryTree.querySelector(".tree-row.selected")?.scrollIntoView({ block: "nearest" });
}

function createEntryRow(entry: Entry): HTMLElement {
  const row = el("div", `tree-row entry ${statusClass(entry)} ${state.selectedEntryId === entry.id ? "selected" : ""}`);
  row.setAttribute("role", "treeitem");
  row.dataset.entryId = String(entry.id);
  row.title = `#${entry.id} · ${formatDateTime(entry.created_at)} · ${statusText(entry)}\n\n${entry.content}`;
  const iconBox = el("span", "tree-icon");
  iconBox.append(icon(statusIcon(entry)));
  const label = el("span", "tree-label");
  const text = el("span", "text");
  const firstLine = entry.content.split("\n")[0];
  text.append(el("span", "entry-id", `#${entry.id}`), el("span", "entry-time", formatTime(entry.created_at)), `-${firstLine}`);
  label.append(text);
  if (state.currentView === "all" && entry.task_name) label.append(el("span", "description", entry.task_name));
  const decoration = el("span", "decoration", entry.status === "start" ? (entry.is_completed ? "已结束" : "进行中") : entry.status === "end" ? `结束 #${entry.end_of_entry_id}` : "");
  row.append(el("span", "tree-indent"), iconBox, label, decoration);
  row.addEventListener("click", () => selectEntry(entry.id));
  row.addEventListener("contextmenu", (event) => {
    selectEntry(entry.id);
    const actions: (MenuAction | "-")[] = [];
    if (entry.status === "start" && !entry.is_completed) {
      actions.push({ label: "结束此条目…", run: () => prepareEnd(entry) }, "-");
    }
    actions.push(
      { label: "复制内容", run: () => void copyText(entry.content, "已复制条目内容") },
      { label: "复制编号", run: () => void copyText(String(entry.id), `已复制编号 #${entry.id}`) },
    );
    if (state.currentView === "all") {
      actions.push("-", { label: `在任务“${entry.task_name}”中显示`, run: () => void revealEntry(entry) });
    }
    showContextMenu(event, actions);
  });
  return row;
}

function renderBreadcrumbs(): void {
  const crumbs = $("breadcrumbs");
  crumbs.replaceChildren();
  const entry = state.entries.find((item) => item.id === state.selectedEntryId);
  const parts: [keyof typeof ICONS, string][] = [[state.currentView === "all" ? "all" : "task", currentTask()?.name ?? "全部"]];
  if (entry) {
    parts.push(["calendar", formatDate(entry.created_at)]);
    parts.push([statusIcon(entry), `#${entry.id}`]);
  }
  parts.forEach(([name, text], index) => {
    if (index > 0) crumbs.append(icon("chevronRight", "sep"));
    const crumb = el("span", "crumb");
    crumb.append(icon(name), el("span", "", text));
    crumbs.append(crumb);
  });
}

function renderDetail(): void {
  const entry = state.entries.find((item) => item.id === state.selectedEntryId);
  $("emptyDetail").classList.toggle("hidden", Boolean(entry));
  $("detailView").classList.toggle("hidden", !entry);
  renderBreadcrumbs();
  if (!entry) return;
  $("detailId").textContent = `#${entry.id}`;
  const chip = $("detailStatus");
  chip.className = `status-chip ${statusClass(entry)}`;
  chip.textContent = statusText(entry);

  const meta = $("detailMeta");
  meta.replaceChildren(el("span", "", `保存时间：${formatDateTime(entry.created_at)}`));
  if (entry.task_name) meta.append(el("span", "", `任务：${entry.task_name}`));
  const linkTo = (label: string, targetId: number) => {
    const span = el("span", "", label);
    const link = el("a", "", `#${targetId}`);
    link.addEventListener("click", () => selectEntry(targetId));
    span.append(link);
    meta.append(span);
  };
  if (entry.status === "end" && entry.end_of_entry_id) linkTo("对应开始条目：", entry.end_of_entry_id);
  if (entry.status === "start" && entry.ending_entry_id) linkTo("结束条目：", entry.ending_entry_id);
  if (entry.status === "start" && !entry.is_completed) meta.append(el("span", "", "尚未结束"));

  const content = $("detailContent");
  content.replaceChildren();
  entry.content.split("\n").forEach((line, index) => {
    const row = el("div", "code-line");
    row.append(el("span", "line-number", String(index + 1)), el("span", "line-text", line || "\u200b"));
    content.append(row);
  });
  content.scrollTop = 0;
}

function renderTaskSelect(): void {
  const previous = Number(taskSelect.value);
  taskSelect.replaceChildren();
  for (const task of state.tasks) {
    const option = el("option", "", task.name);
    option.value = String(task.id);
    taskSelect.append(option);
  }
  const preferred = typeof state.currentView === "number" ? state.currentView : previous;
  if (preferred && state.tasks.some((task) => task.id === preferred)) taskSelect.value = String(preferred);
  if (!taskSelect.value && state.tasks[0]) taskSelect.value = String(state.tasks[0].id);
}

function refreshEndOptions(): void {
  startEntryList.replaceChildren();
  const taskId = Number(taskSelect.value);
  if (!taskId) return;
  for (const entry of openStarts(taskId)) {
    const option = el("option");
    option.value = String(entry.id);
    option.label = `#${entry.id} · ${formatTime(entry.created_at)} · ${entry.content.split("\n")[0].slice(0, 40)}`;
    startEntryList.append(option);
  }
}

function renderStatusBar(): void {
  const pending = openStarts(typeof state.currentView === "number" ? state.currentView : undefined).length;
  const open = $("statusOpen");
  open.textContent = pending ? `● ${pending} 个进行中` : "";
  open.classList.toggle("warning", pending > 0);
  $("statusView").textContent = `${currentTask()?.name ?? "全部"} · ${state.entries.length} 条`;
}

function renderArchive(): void {
  archiveList.replaceChildren();
  if (state.archivedTasks.length === 0) {
    archiveList.append(el("div", "empty-tree", "当前没有已存档的任务。"));
    return;
  }
  for (const task of state.archivedTasks) {
    const row = el("div", `tree-row archive-row ${state.selectedArchiveId === task.id ? "selected" : ""}`);
    row.setAttribute("role", "listitem");
    row.title = `${task.name}\n存档于 ${formatDateTime(task.updated_at)}`;
    const iconBox = el("span", "tree-icon");
    iconBox.append(icon("archive"));
    const label = el("span", "tree-label");
    label.append(el("span", "text", task.name), el("span", "description", formatDateTime(task.updated_at)));
    const actions = el("span", "row-actions");
    const restore = el("button", "action-icon");
    restore.title = "恢复并打开";
    restore.append(icon("restore"));
    restore.addEventListener("click", (event) => {
      event.stopPropagation();
      void restoreTask(task.id);
    });
    const remove = el("button", "action-icon danger");
    remove.title = "彻底删除";
    remove.append(icon("trash"));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void deleteTask(task);
    });
    actions.append(restore, remove);
    row.append(el("span", "twistie"), iconBox, label, actions);
    row.addEventListener("click", () => {
      state.selectedArchiveId = task.id;
      renderArchive();
    });
    row.addEventListener("dblclick", () => void restoreTask(task.id));
    row.addEventListener("contextmenu", (event) =>
      showContextMenu(event, [
        { label: "恢复并打开", run: () => void restoreTask(task.id) },
        "-",
        { label: "彻底删除…", run: () => void deleteTask(task) },
      ]),
    );
    archiveList.append(row);
  }
}

async function refreshTasks(): Promise<void> {
  const all = await window.assistor.listTasks(true);
  state.tasks = all.filter((task) => !task.is_archived);
  state.archivedTasks = all.filter((task) => task.is_archived);
  state.openTaskIds = state.openTaskIds.filter((id) => state.tasks.some((task) => task.id === id));
}

async function render(): Promise<void> {
  state.allEntries = await window.assistor.listAllEntries();
  state.entries = state.currentView === "all" ? state.allEntries : state.allEntries.filter((entry) => entry.task_id === state.currentView);
  if (state.selectedEntryId && !state.entries.some((entry) => entry.id === state.selectedEntryId)) state.selectedEntryId = null;
  renderTabs();
  renderTree();
  renderDetail();
  renderTaskSelect();
  refreshEndOptions();
  renderArchive();
  renderStatusBar();
  endField.classList.toggle("hidden", statusSelect.value !== "end");
}

/* ---------------------------------------------------------------- actions */

async function selectView(view: View): Promise<void> {
  if (state.currentView !== view) state.selectedEntryId = null;
  state.currentView = view;
  showSidebarView("entries");
  await render();
}

function selectEntry(entryId: number): void {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  state.collapsedDates.delete(formatDate(entry.created_at));
  state.selectedEntryId = entryId;
  renderTree();
  renderDetail();
}

async function revealEntry(entry: Entry): Promise<void> {
  if (!state.openTaskIds.includes(entry.task_id)) state.openTaskIds.push(entry.task_id);
  await selectView(entry.task_id);
  selectEntry(entry.id);
}

function toggleDate(date: string): void {
  if (state.collapsedDates.has(date)) state.collapsedDates.delete(date);
  else state.collapsedDates.add(date);
  renderTree();
}

function setAllCollapsed(collapsed: boolean): void {
  state.collapsedDates = collapsed ? new Set(groupByDate(state.entries).keys()) : new Set();
  renderTree();
}

async function copyText(text: string, message: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  setStatus(message);
}

function prepareEnd(entry: Entry): void {
  taskSelect.value = String(entry.task_id);
  statusSelect.value = "end";
  endField.classList.remove("hidden");
  refreshEndOptions();
  endEntryInput.value = String(entry.id);
  contentInput.focus();
}

const validateTaskName = (value: string) => (value.trim() ? null : "任务名称不能为空。");

async function createTask(): Promise<void> {
  const name = await showInputBox({ title: "新建任务", placeholder: "输入任务名称", validate: validateTaskName });
  if (name === null) return;
  try {
    const task = await window.assistor.createTask(name);
    await refreshTasks();
    if (!state.openTaskIds.includes(task.id)) state.openTaskIds.push(task.id);
    await selectView(task.id);
    setStatus(`已创建任务：${task.name}`);
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

async function openTask(): Promise<void> {
  type Target = { kind: "all" } | { kind: "open"; id: number } | { kind: "archived"; id: number };
  const items: QuickPickItem<Target>[] = [{ label: "全部", description: "所有任务的所有条目", value: { kind: "all" } }];
  for (const task of state.tasks) {
    const pending = openStarts(task.id).length;
    items.push({
      label: task.name,
      description: pending ? `${pending} 个进行中` : `更新于 ${formatDateTime(task.updated_at)}`,
      value: { kind: "open", id: task.id },
    });
  }
  for (const task of state.archivedTasks) {
    items.push({ label: task.name, description: "已存档 · 选择后恢复并打开", value: { kind: "archived", id: task.id } });
  }
  const target = await showQuickPick(items, "输入任务名称以打开");
  if (!target) return;
  if (target.kind === "all") await selectView("all");
  else if (target.kind === "archived") await restoreTask(target.id);
  else {
    if (!state.openTaskIds.includes(target.id)) state.openTaskIds.push(target.id);
    await selectView(target.id);
  }
}

async function renameTask(taskId?: number): Promise<void> {
  const task = taskId ? state.tasks.find((item) => item.id === taskId) : currentTask();
  if (!task) {
    notify("请先切换到一个具体任务的标签，再重命名。", true);
    return;
  }
  const name = await showInputBox({ title: "重命名任务", placeholder: "输入新的任务名称", value: task.name, validate: validateTaskName });
  if (name === null || name.trim() === task.name) return;
  try {
    await window.assistor.renameTask(task.id, name);
    await refreshTasks();
    await render();
    setStatus(`任务已重命名为：${name.trim()}`);
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

async function archiveTask(taskId: number): Promise<void> {
  try {
    await window.assistor.archiveTask(taskId);
    const index = state.openTaskIds.indexOf(taskId);
    state.openTaskIds = state.openTaskIds.filter((id) => id !== taskId);
    if (state.currentView === taskId) {
      state.currentView = state.openTaskIds[Math.min(index, state.openTaskIds.length - 1)] ?? "all";
      state.selectedEntryId = null;
    }
    await refreshTasks();
    await render();
    setStatus("任务已存档，可在“存档任务”视图中恢复");
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

async function restoreTask(taskId: number): Promise<void> {
  try {
    const restored = await window.assistor.restoreTask(taskId);
    await refreshTasks();
    if (!state.openTaskIds.includes(restored.id)) state.openTaskIds.push(restored.id);
    state.selectedArchiveId = null;
    await selectView(restored.id);
    setStatus(`已恢复任务：${restored.name}`);
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

async function deleteTask(task: Task): Promise<void> {
  const confirmed = await showConfirm(
    `确定要彻底删除任务“${task.name}”吗？`,
    "该任务下的所有条目也会被永久删除，此操作无法撤销。",
    "彻底删除",
  );
  if (!confirmed) return;
  try {
    await window.assistor.deleteTask(task.id);
    await refreshTasks();
    await render();
    setStatus("任务已彻底删除");
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

async function saveEntry(): Promise<void> {
  const taskId = Number(taskSelect.value);
  const status = statusSelect.value as EntryStatus;
  if (!taskId) {
    notify("请先创建或恢复一个任务。", true);
    return;
  }
  if (!contentInput.value.trim()) {
    notify("条目内容不能为空。", true);
    contentInput.focus();
    return;
  }
  let endOfEntryId: number | null = null;
  if (status === "end") {
    const parsed = Number(endEntryInput.value.trim().replace(/^#/, ""));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      notify("结束状态必须填写有效的开始条目 ID。", true);
      endEntryInput.focus();
      return;
    }
    endOfEntryId = parsed;
  }
  try {
    const entry = await window.assistor.createEntry({ taskId, status, content: contentInput.value, endOfEntryId });
    contentInput.value = "";
    statusSelect.value = "note";
    endEntryInput.value = "";
    if (state.currentView !== "all" && state.currentView !== entry.task_id) {
      if (!state.openTaskIds.includes(entry.task_id)) state.openTaskIds.push(entry.task_id);
      state.currentView = entry.task_id;
    }
    state.selectedEntryId = entry.id;
    await render();
    setStatus(`条目 #${entry.id} 已保存`);
  } catch (error) {
    notify(errorMessage(error), true);
  }
}

function showSidebarView(view: SidebarView): void {
  state.sidebarView = view;
  $("workbenchBody").classList.remove("sidebar-hidden");
  $("entriesView").classList.toggle("hidden", view !== "entries");
  $("archiveView").classList.toggle("hidden", view !== "archive");
  document.querySelectorAll<HTMLElement>(".activity-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
}

function onActivityClick(view: SidebarView): void {
  const body = $("workbenchBody");
  if (state.sidebarView === view && !body.classList.contains("sidebar-hidden")) {
    body.classList.add("sidebar-hidden");
    document.querySelectorAll(".activity-item[data-view]").forEach((item) => item.classList.remove("active"));
    return;
  }
  showSidebarView(view);
  if (view === "archive") void refreshTasks().then(renderArchive);
}

/* --------------------------------------------------------------- commands */

const COMMANDS: { id: CommandId; label: string; keybinding?: string; run: () => void }[] = [
  { id: "task.new", label: "任务: 新建任务", keybinding: `${modKey}N`, run: () => void createTask() },
  { id: "task.open", label: "任务: 打开任务…", keybinding: `${modKey}P`, run: () => void openTask() },
  { id: "task.rename", label: "任务: 重命名当前任务", keybinding: "F2", run: () => void renameTask() },
  {
    id: "task.close",
    label: "任务: 关闭并存档当前任务",
    keybinding: `${modKey}W`,
    run: () => {
      if (typeof state.currentView === "number") void archiveTask(state.currentView);
      else setStatus("“全部”是永久标签，不能关闭");
    },
  },
  { id: "entry.save", label: "条目: 保存条目", keybinding: `${modKey}S`, run: () => void saveEntry() },
  { id: "view.entries", label: "视图: 显示条目", keybinding: `${modKey}Shift+E`, run: () => showSidebarView("entries") },
  { id: "view.archive", label: "视图: 显示存档任务", keybinding: `${modKey}Shift+A`, run: () => onActivityClick("archive") },
  { id: "view.toggleSidebar", label: "视图: 切换侧边栏", keybinding: `${modKey}B`, run: () => $("workbenchBody").classList.toggle("sidebar-hidden") },
];

const ZOOM_COMMANDS: { label: string; keybinding: string; run: () => void }[] = [
  { label: "视图: 放大", keybinding: `${modKey}=`, run: () => void window.assistor.applyZoom("in") },
  { label: "视图: 缩小", keybinding: `${modKey}-`, run: () => void window.assistor.applyZoom("out") },
  { label: "视图: 重置缩放", keybinding: `${modKey}0`, run: () => void window.assistor.applyZoom("reset") },
];

function renderZoom(zoomLevel: number): void {
  const percent = Math.round(Math.pow(1.2, zoomLevel) * 100);
  $("statusZoom").classList.toggle("hidden", zoomLevel === 0);
  $("statusZoomText").textContent = `${percent}%`;
  $("statusZoom").title = `缩放 ${percent}%（点击调整，${modKey}0 重置）`;
}

function runCommand(id: CommandId): void {
  hideContextMenu();
  if (id === "view.commandPalette") {
    void showCommandPalette();
    return;
  }
  if (!$("dialogBackdrop").classList.contains("hidden")) return;
  COMMANDS.find((command) => command.id === id)?.run();
}

async function showCommandPalette(): Promise<void> {
  const extra: QuickPickItem<() => void>[] = [
    { label: "视图: 全部折叠", value: () => setAllCollapsed(true) },
    { label: "视图: 全部展开", value: () => setAllCollapsed(false) },
    { label: "条目: 聚焦到新建条目输入框", value: () => contentInput.focus() },
  ];
  const items = [...COMMANDS, ...ZOOM_COMMANDS].map((command) => ({
    label: command.label,
    keybinding: command.keybinding,
    value: command.run,
  }));
  const run = await showQuickPick([...items, ...extra], "输入命令名称");
  run?.();
}

/* ------------------------------------------------------------ keyboard nav */

function onTreeKeydown(event: KeyboardEvent): void {
  const rows = [...entryTree.querySelectorAll<HTMLElement>(".tree-row")];
  if (rows.length === 0) return;
  let index = rows.findIndex((row) => row.classList.contains("selected") || row.classList.contains("focused"));
  const current = rows[index];
  const move = (next: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
    if (row.dataset.entryId) selectEntry(Number(row.dataset.entryId));
    else {
      state.selectedEntryId = null;
      renderTree();
      renderDetail();
      entryTree.querySelector<HTMLElement>(`.date-row[data-date="${row.dataset.date}"]`)?.classList.add("selected", "focused");
    }
  };
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index < 0 ? 0 : index - 1);
  else if (event.key === "Home") move(0);
  else if (event.key === "End") move(rows.length - 1);
  else if ((event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Enter") && current?.dataset.date) {
    const collapsed = state.collapsedDates.has(current.dataset.date);
    if (event.key === "Enter" || (event.key === "ArrowLeft") !== collapsed) toggleDate(current.dataset.date);
    entryTree.querySelector<HTMLElement>(`.date-row[data-date="${current.dataset.date}"]`)?.classList.add("selected", "focused");
  } else if (event.key === "ArrowLeft" && current?.dataset.entryId) {
    while (index > 0 && !rows[index].dataset.date) index -= 1;
    move(index);
  } else return;
  event.preventDefault();
}

/* ------------------------------------------------------------------- sash */

function setupSash(): void {
  const sash = $("sash");
  const saved = Number(localStorage.getItem("sidebarWidth"));
  if (saved) document.documentElement.style.setProperty("--sidebar-width", `${saved}px`);
  sash.addEventListener("mousedown", (event) => {
    event.preventDefault();
    sash.classList.add("active");
    const sidebar = $("sidebar");
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    const onMove = (move: MouseEvent) => {
      const width = Math.max(180, Math.min(window.innerWidth * 0.7, startWidth + move.clientX - startX));
      document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    };
    const onUp = () => {
      sash.classList.remove("active");
      localStorage.setItem("sidebarWidth", String(Math.round(sidebar.getBoundingClientRect().width)));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  sash.addEventListener("dblclick", () => {
    document.documentElement.style.removeProperty("--sidebar-width");
    localStorage.removeItem("sidebarWidth");
  });
}

/* ------------------------------------------------------------------- init */

function bindEvents(): void {
  window.assistor.onCommand(runCommand);
  window.assistor.onZoomChanged(renderZoom);
  let lastWheelZoom = 0;
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY === 0 || event.timeStamp - lastWheelZoom < 120) return;
      lastWheelZoom = event.timeStamp;
      void window.assistor.applyZoom(event.deltaY < 0 ? "in" : "out");
    },
    { passive: false },
  );
  $("statusZoom").addEventListener("click", (event) =>
    showContextMenu(
      event,
      ZOOM_COMMANDS.map((command) => ({ label: command.label.replace("视图: ", ""), keybinding: command.keybinding, run: command.run })),
      $("statusZoom"),
    ),
  );
  document.querySelectorAll<HTMLElement>(".activity-item[data-view]").forEach((item) => {
    item.addEventListener("click", () => onActivityClick(item.dataset.view as SidebarView));
  });
  $("paletteButton").addEventListener("click", () => void showCommandPalette());
  $("newTaskButton").addEventListener("click", () => void createTask());
  $("tabsNewTaskButton").addEventListener("click", () => void createTask());
  $("openTaskButton").addEventListener("click", () => void openTask());
  $("collapseAllButton").addEventListener("click", () => setAllCollapsed(true));
  $("expandAllButton").addEventListener("click", () => setAllCollapsed(false));
  $("saveButton").addEventListener("click", () => void saveEntry());
  statusSelect.addEventListener("change", () => {
    endField.classList.toggle("hidden", statusSelect.value !== "end");
    if (statusSelect.value === "end") endEntryInput.focus();
  });
  taskSelect.addEventListener("change", refreshEndOptions);
  entryTree.addEventListener("keydown", onTreeKeydown);
  contentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveEntry();
    }
  });
  document.addEventListener("mousedown", (event) => {
    if (!(event.target as HTMLElement).closest("#contextMenu")) hideContextMenu();
  });
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
  });
  document.querySelectorAll("kbd[data-mod]").forEach((kbd) => {
    if (isMac) kbd.textContent = "⌘";
  });
  setupSash();
}

async function initialize(): Promise<void> {
  bindEvents();
  renderZoom(await window.assistor.getZoomLevel());
  await refreshTasks();
  if (state.tasks.length === 0 && state.archivedTasks.length === 0) {
    await window.assistor.createTask("我的任务");
    await refreshTasks();
  }
  state.openTaskIds = state.tasks.map((task) => task.id);
  await render();
}

void initialize().catch((error) => {
  notify(`应用初始化失败：${errorMessage(error)}`, true);
  setStatus("初始化失败");
});
