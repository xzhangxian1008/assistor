import { contextBridge, ipcRenderer } from "electron";
import type { CommandId, CreateEntryInput, ZoomAction } from "../shared/types";

const api = {
  platform: process.platform,
  listTasks: (includeArchived = false) => ipcRenderer.invoke("tasks:list", includeArchived),
  getTask: (taskId: number) => ipcRenderer.invoke("tasks:get", taskId),
  createTask: (name: string) => ipcRenderer.invoke("tasks:create", name),
  renameTask: (taskId: number, name: string) => ipcRenderer.invoke("tasks:rename", taskId, name),
  archiveTask: (taskId: number) => ipcRenderer.invoke("tasks:archive", taskId),
  restoreTask: (taskId: number) => ipcRenderer.invoke("tasks:restore", taskId),
  deleteTask: (taskId: number) => ipcRenderer.invoke("tasks:delete", taskId),
  listEntries: (taskId: number) => ipcRenderer.invoke("entries:list", taskId),
  listAllEntries: () => ipcRenderer.invoke("entries:list-all"),
  getEntry: (entryId: number) => ipcRenderer.invoke("entries:get", entryId),
  createEntry: (input: CreateEntryInput) => ipcRenderer.invoke("entries:create", input),
  onCommand: (listener: (command: CommandId) => void) => {
    ipcRenderer.on("command", (_, command: CommandId) => listener(command));
  },
  getZoomLevel: () => ipcRenderer.invoke("zoom:get"),
  applyZoom: (action: ZoomAction) => ipcRenderer.invoke("zoom:apply", action),
  onZoomChanged: (listener: (zoomLevel: number) => void) => {
    ipcRenderer.on("zoom:changed", (_, zoomLevel: number) => listener(zoomLevel));
  },
};

contextBridge.exposeInMainWorld("assistor", api);
