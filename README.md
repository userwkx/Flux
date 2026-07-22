# Flux (Tauri / Rust)

白 + 淡蓝渐变启动器。后端已迁到 **Rust + Tauri 2**，前端在 `ui/`。

## 运行

需要代理时（拉 crate / npm）：

```powershell
$env:HTTP_PROXY='http://127.0.0.1:10808'
$env:HTTPS_PROXY='http://127.0.0.1:10808'
```

```powershell
cd <项目目录>
npm install
npm run dev
# 或
cd src-tauri
cargo run
```

直接跑已编译版本：

```powershell
.\src-tauri\target\debug\flux.exe
```

## 功能

- 全局热键（Alt+Q 等）
- 开始菜单 + 桌面快捷方式 + `C:\software` 绿色软件
- 首次完整建立应用与图标缓存，后续按安装来源变化增量同步
- 拼音 / 首字母搜索
- 图标持久化、最近 10 个应用拖拽排序
- 托盘图标
- 多供应商 AI 对话、翻译和网页搜索，保留最近 10 个会话

## 目录

| 路径 | 说明 |
|------|------|
| `ui/` | HTML/CSS/JS 前端 |
| `src-tauri/` | Rust 后端 |
| `settings.json` / `recent.json` / `conversations.json` / `icons-cache/` | 运行时数据 |

## 配置样例

首次配置时可参考根目录中的 `*.example.json`。真实的供应商密钥、设置、会话、最近记录和应用缓存均为本地数据，已通过 `.gitignore` 排除，不应提交到仓库。

旧 Electron 壳和重复前端已移除。前端使用 Tauri 全局 API，不需要额外的 npm 运行依赖。
