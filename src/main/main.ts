import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { AssistorError, resolveDatabasePath, Store } from "./database";
import { SettingsStore } from "./settings";
import type { CommandId, CreateEntryInput, ZoomAction } from "../shared/types";

let store: Store;
let settings: SettingsStore;

// 与 Chromium 一致：缩放倍数 = 1.2 ^ zoomLevel；每步 0.5 级约 10%
const ZOOM_STEP = 0.5;
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 6;

function applyZoom(action: ZoomAction): number {
  const current = settings.get("zoomLevel");
  const next =
    action === "reset" ? 0 : Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, current + (action === "in" ? ZOOM_STEP : -ZOOM_STEP)));
  if (next !== current) settings.set("zoomLevel", next);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.setZoomLevel(next);
    window.webContents.send("zoom:changed", next);
  }
  return next;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#ffffff",
    title: "Assistor",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: Math.pow(1.2, settings.get("zoomLevel")),
      preload: path.join(__dirname, "../preload/preload.js"),
    },
  });
  window.once("ready-to-show", () => window.show());
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
  return window;
}

function sendCommand(command: CommandId): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const item = (label: string, command: CommandId, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendCommand(command),
  });
  const zoomItem = (label: string, action: ZoomAction, accelerator: string, visible = true): MenuItemConstructorOptions => ({
    label,
    accelerator,
    visible,
    acceleratorWorksWhenHidden: true,
    click: () => applyZoom(action),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "文件",
      submenu: [
        item("新建任务", "task.new", "CmdOrCtrl+N"),
        item("打开任务…", "task.open", "CmdOrCtrl+P"),
        item("重命名任务", "task.rename", "F2"),
        item("关闭并存档任务", "task.close", "CmdOrCtrl+W"),
        { type: "separator" },
        item("保存条目", "entry.save", "CmdOrCtrl+S"),
        { type: "separator" },
        isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "查看",
      submenu: [
        item("命令面板…", "view.commandPalette", "CmdOrCtrl+Shift+P"),
        item("条目", "view.entries", "CmdOrCtrl+Shift+E"),
        item("存档任务", "view.archive", "CmdOrCtrl+Shift+A"),
        item("切换侧边栏", "view.toggleSidebar", "CmdOrCtrl+B"),
        { type: "separator" },
        {
          label: "外观",
          submenu: [
            zoomItem("放大", "in", "CmdOrCtrl+="),
            zoomItem("缩小", "out", "CmdOrCtrl+-"),
            zoomItem("重置缩放", "reset", "CmdOrCtrl+0"),
            zoomItem("放大", "in", "CmdOrCtrl+Shift+=", false),
            zoomItem("放大", "in", "CmdOrCtrl+numadd", false),
            zoomItem("缩小", "out", "CmdOrCtrl+Shift+-", false),
            zoomItem("缩小", "out", "CmdOrCtrl+numsub", false),
            zoomItem("重置缩放", "reset", "CmdOrCtrl+num0", false),
          ],
        },
        { type: "separator" },
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("tasks:list", (_, includeArchived = false) => store.listTasks(Boolean(includeArchived)));
  ipcMain.handle("tasks:get", (_, taskId: number) => store.getTask(Number(taskId)) ?? null);
  ipcMain.handle("tasks:create", (_, name: string) => store.createTask(name));
  ipcMain.handle("tasks:rename", (_, taskId: number, name: string) => store.renameTask(Number(taskId), name));
  ipcMain.handle("tasks:archive", (_, taskId: number) => store.archiveTask(Number(taskId)));
  ipcMain.handle("tasks:restore", (_, taskId: number) => store.restoreTask(Number(taskId)));
  ipcMain.handle("tasks:delete", (_, taskId: number) => store.deleteTask(Number(taskId)));
  ipcMain.handle("entries:list", (_, taskId: number) => store.listEntries(Number(taskId)));
  ipcMain.handle("entries:list-all", () => store.listAllEntries());
  ipcMain.handle("entries:get", (_, entryId: number) => store.getEntry(Number(entryId)) ?? null);
  ipcMain.handle("entries:create", (_, input: CreateEntryInput) => store.createEntry(input));
  ipcMain.handle("zoom:get", () => settings.get("zoomLevel"));
  ipcMain.handle("zoom:apply", (_, action: ZoomAction) => applyZoom(action));
}

app.setName("Assistor");

app.whenReady().then(() => {
  const filePath = resolveDatabasePath(app.getPath("appData"), app.getPath("userData"));
  store = new Store(filePath);
  settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => store?.close());

process.on("uncaughtException", (error) => {
  if (error instanceof AssistorError) console.error(error.message);
  else console.error(error);
});
