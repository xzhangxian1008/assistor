import fs from "node:fs";
import path from "node:path";

export interface Settings {
  zoomLevel: number;
}

const DEFAULTS: Settings = { zoomLevel: 0 };

export class SettingsStore {
  private settings: Settings;

  constructor(private readonly filePath: string) {
    this.settings = { ...DEFAULTS };
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<Settings>;
      if (typeof saved.zoomLevel === "number" && Number.isFinite(saved.zoomLevel)) this.settings.zoomLevel = saved.zoomLevel;
    } catch {
      // 文件不存在或损坏时使用默认设置
    }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf8");
  }
}
