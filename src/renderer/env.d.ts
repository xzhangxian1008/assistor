import type { CommandId, CreateEntryInput, Entry, Task, ZoomAction } from "../shared/types";

declare global {
  interface Window {
    assistor: {
      platform: string;
      listTasks(includeArchived?: boolean): Promise<Task[]>;
      getTask(taskId: number): Promise<Task | null>;
      createTask(name: string): Promise<Task>;
      renameTask(taskId: number, name: string): Promise<Task>;
      archiveTask(taskId: number): Promise<void>;
      restoreTask(taskId: number): Promise<Task>;
      deleteTask(taskId: number): Promise<void>;
      listEntries(taskId: number): Promise<Entry[]>;
      listAllEntries(): Promise<Entry[]>;
      getEntry(entryId: number): Promise<Entry | null>;
      createEntry(input: CreateEntryInput): Promise<Entry>;
      onCommand(listener: (command: CommandId) => void): void;
      getZoomLevel(): Promise<number>;
      applyZoom(action: ZoomAction): Promise<number>;
      onZoomChanged(listener: (zoomLevel: number) => void): void;
    };
  }
}

export {};
