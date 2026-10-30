export type EntryStatus = "note" | "start" | "end";

export interface Task {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  is_archived: number;
}

export interface Entry {
  id: number;
  task_id: number;
  task_name?: string;
  status: EntryStatus;
  content: string;
  created_at: string;
  end_of_entry_id: number | null;
  ending_entry_id: number | null;
  is_completed: number;
}

export interface CreateEntryInput {
  taskId: number;
  status: EntryStatus;
  content: string;
  endOfEntryId?: number | null;
}

export type ZoomAction = "in" | "out" | "reset";

export type CommandId =
  | "task.new"
  | "task.open"
  | "task.rename"
  | "task.close"
  | "entry.save"
  | "view.commandPalette"
  | "view.entries"
  | "view.archive"
  | "view.toggleSidebar";
