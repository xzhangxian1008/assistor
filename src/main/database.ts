import DatabaseDriver from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { CreateEntryInput, Entry, Task } from "../shared/types";

export class AssistorError extends Error {}

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1))
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('start', 'end', 'note')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TEXT NOT NULL,
  end_of_entry_id INTEGER REFERENCES entries(id) ON DELETE RESTRICT,
  CHECK (
    (status = 'end' AND end_of_entry_id IS NOT NULL)
    OR (status IN ('start', 'note') AND end_of_entry_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_end_for_one_start
ON entries(end_of_entry_id)
WHERE status = 'end' AND end_of_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entries_by_task_and_time
ON entries(task_id, created_at DESC, id DESC);
`;

// 与旧版 PySide6 数据保持同一格式（本地时间 + 时区偏移，精确到秒），保证按字符串排序正确。
function nowIso(): string {
  const now = new Date();
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

export function resolveDatabasePath(appDataPath: string, userDataPath: string): string {
  if (process.env.ASSISTOR_DB) return path.resolve(process.env.ASSISTOR_DB);
  const legacyPath = path.join(appDataPath, "Assistor", "Assistor", "assistor.sqlite3");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return path.join(userDataPath, "assistor.sqlite3");
}

export class Store {
  private readonly db: DatabaseDriver.Database;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseDriver(filePath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  listTasks(includeArchived = false): Task[] {
    const query = includeArchived
      ? "SELECT * FROM tasks ORDER BY updated_at DESC, id DESC"
      : "SELECT * FROM tasks WHERE is_archived = 0 ORDER BY updated_at DESC, id DESC";
    return this.db.prepare(query).all() as Task[];
  }

  getTask(taskId: number): Task | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
  }

  createTask(name: string): Task {
    const cleaned = name.trim();
    if (!cleaned) throw new AssistorError("任务名称不能为空。");
    const timestamp = nowIso();
    const result = this.db
      .prepare("INSERT INTO tasks(name, created_at, updated_at) VALUES (?, ?, ?)")
      .run(cleaned, timestamp, timestamp);
    return this.getTask(Number(result.lastInsertRowid))!;
  }

  renameTask(taskId: number, name: string): Task {
    const cleaned = name.trim();
    if (!cleaned) throw new AssistorError("任务名称不能为空。");
    const result = this.db
      .prepare("UPDATE tasks SET name = ?, updated_at = ? WHERE id = ? AND is_archived = 0")
      .run(cleaned, nowIso(), taskId);
    if (result.changes === 0) throw new AssistorError("任务不存在或已经归档。");
    return this.getTask(taskId)!;
  }

  archiveTask(taskId: number): void {
    const result = this.db
      .prepare("UPDATE tasks SET is_archived = 1, updated_at = ? WHERE id = ?")
      .run(nowIso(), taskId);
    if (result.changes === 0) throw new AssistorError("任务不存在。");
  }

  restoreTask(taskId: number): Task {
    const result = this.db
      .prepare("UPDATE tasks SET is_archived = 0, updated_at = ? WHERE id = ? AND is_archived = 1")
      .run(nowIso(), taskId);
    if (result.changes === 0) throw new AssistorError("任务不存在或当前没有处于存档状态。");
    return this.getTask(taskId)!;
  }

  deleteTask(taskId: number): void {
    const task = this.getTask(taskId);
    if (!task) throw new AssistorError("任务不存在。");
    if (!task.is_archived) throw new AssistorError("只能从存档中彻底删除任务。");
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM entries WHERE task_id = ? AND status = 'end'").run(taskId);
      this.db.prepare("DELETE FROM entries WHERE task_id = ?").run(taskId);
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    });
    transaction();
  }

  private entriesQuery(condition: string, params: unknown[]): Entry[] {
    const query = `
      SELECT e.*, t.name AS task_name,
        CASE WHEN e.status = 'start' AND ending.id IS NULL THEN 0 ELSE 1 END AS is_completed,
        ending.id AS ending_entry_id
      FROM entries e
      JOIN tasks t ON t.id = e.task_id
      LEFT JOIN entries ending ON ending.end_of_entry_id = e.id
      ${condition}
      ORDER BY e.created_at DESC, e.id DESC
    `;
    return this.db.prepare(query).all(...params) as Entry[];
  }

  listEntries(taskId: number): Entry[] {
    return this.entriesQuery("WHERE e.task_id = ?", [taskId]);
  }

  listAllEntries(): Entry[] {
    return this.entriesQuery("", []);
  }

  getEntry(entryId: number): Entry | undefined {
    return this.entriesQuery("WHERE e.id = ?", [entryId])[0];
  }

  createEntry(input: CreateEntryInput): Entry {
    const content = input.content.trim();
    if (!content) throw new AssistorError("条目内容不能为空。");
    const task = this.getTask(input.taskId);
    if (!task || task.is_archived) throw new AssistorError("目标任务不存在或已经存档。");
    if (!["note", "start", "end"].includes(input.status)) {
      throw new AssistorError("条目状态无效。");
    }

    const transaction = this.db.transaction(() => {
      if (input.status === "end") {
        if (!input.endOfEntryId) throw new AssistorError("结束条目必须填写对应的开始条目 ID。");
        const start = this.db
          .prepare("SELECT id, task_id, status FROM entries WHERE id = ?")
          .get(input.endOfEntryId) as { id: number; task_id: number; status: string } | undefined;
        if (!start) throw new AssistorError(`找不到开始条目 ${input.endOfEntryId}。`);
        if (start.status !== "start") throw new AssistorError(`条目 ${input.endOfEntryId} 不是开始状态。`);
        if (start.task_id !== input.taskId) throw new AssistorError("开始条目和结束条目必须属于同一个任务。");
        const existing = this.db
          .prepare("SELECT id FROM entries WHERE status = 'end' AND end_of_entry_id = ?")
          .get(input.endOfEntryId) as { id: number } | undefined;
        if (existing) throw new AssistorError(`开始条目 ${input.endOfEntryId} 已经由结束条目 ${existing.id} 结束。`);
      } else if (input.endOfEntryId != null) {
        throw new AssistorError("只有结束状态可以关联开始条目。");
      }

      const result = this.db
        .prepare(
          "INSERT INTO entries(task_id, status, content, created_at, end_of_entry_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run(input.taskId, input.status, content, nowIso(), input.endOfEntryId ?? null);
      this.db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(nowIso(), input.taskId);
      return Number(result.lastInsertRowid);
    });
    return this.getEntry(transaction())!;
  }
}
