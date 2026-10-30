# Assistor

Assistor 是一个跨 Windows 和 macOS 的工作日志小工具，用来在多个任务之间切换时，快速找回“上次做到哪里、哪些事情还没结束”。

技术栈：

- **Electron**：桌面应用框架，跨 Windows / macOS
- **TypeScript + HTML + CSS**：界面仿照 VS Code（Light Modern 主题）
- **SQLite**（通过 `better-sqlite3`）：本地存储

## 功能

- **条目**：写一段文字并保存就生成一条条目，保存时自动记录年月日时分秒；每条条目有全局唯一、递增的纯数字编号。
- **状态**：每条条目是 `记录`、`开始`、`结束` 之一。
  - `结束` 条目必须填写对应 `开始` 条目的编号；找不到该开始条目、它不是开始状态、不属于同一个任务、或已经被结束过，都会直接报错并且不保存。
  - 没有对应结束条目的 `开始` 条目显示为橙色（标签页上也会出现橙色圆点），被结束后恢复为正常颜色。
- **任务**：像 VS Code 打开的文件一样以标签页并排显示在编辑区上方。
  - 永久标签 `全部`：显示所有任务的所有条目。
  - 在某个任务标签下记录，新条目自动属于这个任务；也可以在“保存到”下拉框里改选其他任务。
  - 双击标签或按 `F2` 重命名；关闭标签（`×`、中键或 `Ctrl/⌘ + W`）会把任务存档。
  - 左侧活动栏的“存档任务”视图可以恢复或彻底删除任务（彻底删除会连同条目一起删除，需要确认）。
- **布局**：条目在左侧侧边栏，内容在右侧编辑区，和 VS Code 一样。
  - 条目按时间倒序排列，按天折叠成类似文件夹的分组。
  - 每行格式为 `#编号 时:分-内容`，例如 `#42 13:21-修复登录问题`；`全部` 视图下还会显示所属任务。
  - 右侧编辑区带行号显示完整内容，上方面包屑显示 任务 › 日期 › 编号。
- **其他**：命令面板、右键菜单（结束此条目、复制内容/编号、在任务中显示）、侧边栏宽度可拖动、树形列表支持方向键导航。

## 快捷键

macOS 上把 `Ctrl` 换成 `⌘`。

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + Shift + P` | 命令面板 |
| `Ctrl + P` | 打开任务（可直接恢复已存档任务） |
| `Ctrl + N` | 新建任务 |
| `Ctrl + S` / `Ctrl + Enter` | 保存条目 |
| `F2` | 重命名当前任务 |
| `Ctrl + W` | 关闭并存档当前任务 |
| `Ctrl + B` | 显示/隐藏侧边栏 |
| `Ctrl + =` / `Ctrl + -` / 按住 `Ctrl` 滚动滚轮 | 放大 / 缩小整个界面 |
| `Ctrl + 0` | 重置缩放 |

缩放级别会保存在用户数据目录的 `settings.json` 中，下次启动自动恢复；不是 100% 时状态栏会显示当前比例，点击可调整。

## 项目结构

```text
assistor/
├─ src/
│  ├─ main/
│  │  ├─ main.ts          # Electron 主进程：窗口、菜单、IPC
│  │  └─ database.ts      # SQLite 表结构与数据校验
│  ├─ preload/
│  │  └─ preload.ts       # 通过 contextBridge 暴露给界面的 API
│  ├─ renderer/
│  │  ├─ index.html       # 界面结构
│  │  ├─ styles.css       # VS Code Light Modern 风格样式
│  │  ├─ renderer.ts      # 界面逻辑
│  │  └─ env.d.ts         # window.assistor 类型声明
│  └─ shared/
│     └─ types.ts         # 主进程和界面共用的类型
├─ scripts/
│  └─ copy-assets.cjs     # 构建时复制 HTML/CSS
├─ package.json
├─ tsconfig.json          # 主进程 / preload（CommonJS）
└─ tsconfig.renderer.json # 界面（ES Module）
```

## 运行

需要 Node.js 20 或更高版本。Windows PowerShell 如果禁止执行 `npm.ps1`，请使用 `npm.cmd`。

```powershell
npm.cmd install     # 会自动为 Electron 重新编译 better-sqlite3
npm.cmd start       # 构建并启动
```

## 打包

```powershell
npm.cmd run dist:win   # 在 Windows 上打包，输出到 release/
npm.cmd run dist:mac   # 在 macOS 上打包，输出到 release/
```

`better-sqlite3` 是原生模块，需要在目标平台上打包（Windows 安装包在 Windows 上打，macOS 安装包在 Mac 上打）。

## 数据位置

如果存在旧版 PySide6 程序的数据库，会继续使用它，旧数据无需迁移：

```text
Windows: %APPDATA%\Assistor\Assistor\assistor.sqlite3
macOS:   ~/Library/Application Support/Assistor/Assistor/assistor.sqlite3
```

否则使用 Electron 默认的用户数据目录：

```text
Windows: %APPDATA%\Assistor\assistor.sqlite3
macOS:   ~/Library/Application Support/Assistor/assistor.sqlite3
```

也可以用环境变量 `ASSISTOR_DB` 指定数据库文件（例如用于测试）。
