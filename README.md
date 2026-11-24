# Open Design · Design Preview（独立前端）

把 [nexu-io/open-design](https://github.com/nexu-io/open-design) 项目工作页**右侧的设计预览面板**
（`apps/web/src/components/FileWorkspace.tsx` + `FileViewer.tsx`）单独提取出来的
Web 前端项目：Vite + React 18 + TypeScript，不依赖 Open Design 的 monorepo、聊天面板或桌面端，
可以单独运行、部署，也可以通过 URL 嵌入到别的页面里。预览之外，评审与编辑工具
（注释、标记、编辑、评论）和草图编辑器也一并提取了出来。

> The design-preview pane of Open Design's project workspace, extracted into a standalone
> Vite + React app — with its review tools (comment, mark, edit, comments panel) and the
> sketch editor. Same sandboxed preview runtime, same look, no chat / agent / monorepo.

## 功能

| 区域 | 能力 |
| --- | --- |
| 标签栏 (`ws-tabs-shell`) | 「设计文件」标签 + 可关闭的文件标签；切换标签不重载预览（保留最近 4 个预览 iframe）；Ctrl+Tab 切换；当前文件的「演示 / 导出」按钮挂在标签栏右侧 |
| 「+」启动菜单 | 上游 `TabLauncherMenu` 原样移植：搜索标签页或文件、按类型筛选、**新建**（新建草图 / 新建文档 / 上传）、**打开文件**、**打开标签页** |
| 设计文件面板 | 面包屑、按类别分页、HTML 页面实时缩略图卡片、图片瀑布流、搜索、行菜单、多选打包 ZIP 下载；空项目时显示「新建草图 / 新建文档 / 上传」 |
| HTML 预览 | 沙箱 iframe（`allow-scripts allow-forms allow-downloads`，不同源），由上游原样的 `buildSrcdoc` 生成 |
| 视口 / 缩放 | 桌面端 / 平板 820×1180 / 移动端 390×844；桌面端宽页面自动适配缩放；手动 50%–200% |
| 幻灯片 (deck) | 自动识别 deck；浮动翻页条、缩略图栏、键盘 ← → Home End R、演讲者备注 |
| 演示 / 导出 | 当前标签页 / 全屏 / 新标签页演示；导出 PDF、PNG、ZIP、独立 HTML、原文件、复制源码 |
| **注释** | 预览工具栏的「注释」：悬停元素显示样式卡片（尺寸、颜色、字体），点选元素后在上游原样的评论气泡（`BoardComposerPopover`）里写评论，可附图片、可追加多条备注 |
| **评论** | 「评论（数量）」按钮：画布上显示带编号的评论钉，右侧浮动评论卡片列出本文件的评论——点开即可修改 / 删除，拖动排序，直接写页面级评论，多选后「标为已解决」或「复制给 Agent」（复制的正是 Open Design 发给 agent 的评论上下文），已解决的评论可展开并重新打开 |
| **标记** | 上游原样的标记层（`PreviewDrawOverlay`）：框选 / 画笔 / 文字、撤销重做、附加图片、写说明；提交时可「保存为评论」（带标注截图，Enter 默认此项）、「复制标注图」或「下载标注图」 |
| **编辑** | 上游手动编辑器：悬停元素出现参数按钮，点开浮动检查器（`ManualEditPanel`）改文字 / 链接 / 图片 / 样式 / 属性 / 选中元素 HTML / 完整源码，页面空白处打开页面样式，可直接在画布里改文字、拖动元素，撤销 / 重做；修改通过上游的 `source-patches` 写回 HTML 源文件 |
| **草图** | `*.sketch.json` 用上游的 Excalidraw 草图编辑器（`SketchEditor`）打开：画图后 800 ms 自动保存、手动保存、清空、「导出图片」把 PNG 写到草图旁边并可直接打开 |
| 文档 | Markdown 源码 / 分栏 / 预览；可写项目里直接编辑，停止输入 700 ms 后自动保存（显示「已自动保存 · 时间」）；「新建文档」生成上游同款模板 |
| 其他查看器 | SVG、图片、视频、音频、PDF、代码 / JSON（行号）、`.jsx/.tsx` React 组件 |
| 外观 | 直接复用上游设计 token 与样式（浅色 / 深色 / 跟随系统），中英文界面（文案取自上游 i18n） |

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5178 ，默认打开内置示例项目
npm run build        # 类型检查 + 生产构建到 dist/
npm run preview      # 预览生产构建
```

需要 Node 20+。Excalidraw 只在打开草图时按需加载。

## 预览什么：四种数据源

左上角的项目按钮可以切换。编辑、草图、新建文档、上传都会写文件；评论单独存放。
项目菜单里会写明当前项目的修改保存到哪里：

| 数据源 | 文件修改写到 | 评论存放在 |
| --- | --- | --- |
| **示例项目** `public/demo-project/` | 当前浏览器（IndexedDB，叠加在只读文件之上，刷新后仍在；项目菜单可「丢弃浏览器中的修改」） | 当前浏览器（IndexedDB） |
| **本地文件夹（实时刷新）**（File System Access API，Chromium） | **直接写回磁盘上的文件夹**，第一次保存时浏览器会请求编辑权限 | 当前浏览器（按文件夹名区分） |
| **本地文件夹 / 文件**（`<input>` 或拖入，没有文件夹句柄时） | 只在当前标签页内存里 | 当前浏览器 |
| **Open Design daemon** | 通过 daemon：`POST /api/projects/:id/files`（文本，或 `encoding: 'base64'` 的二进制） | 通过 daemon 的评论接口（见下），与 Open Design 本体共享 |
| **静态目录**（带 `manifest.json`） | 当前浏览器（同示例项目） | 当前浏览器 |

1. **示例项目** — 落地页、两套幻灯片、移动端页面、看板、Markdown、JSON。
2. **本地文件夹** — 「打开文件夹」或直接把文件夹/文件**拖进窗口**。相对路径的图片、CSS、字体、JS 模块会被内联成
   `data:` URL 再交给沙箱 iframe。Chromium 下「打开文件夹（实时刷新）」磁盘上的改动会自动刷新预览。
3. **Open Design daemon** — 「连接 Open Design…」。读写用的就是上游工作区的接口：
   `GET /api/projects`、`/api/projects/:id/files`、`/raw/*`、`POST /files`，订阅 `/events` 的 `file-changed`、`comment-changed`；
   评论走 `/api/projects/:id/conversations/:cid/comments`（`GET`、`POST`、`PATCH`、`PATCH …/reorder`、`DELETE`），
   挂在项目最近的一个会话上（没有会话时创建一个）。评论附带的图片和上游一样上传到项目里。
   开发服务器会像 `apps/web/next.config.ts` 一样把 `/api/*` 代理到 daemon：

   ```bash
   OD_DAEMON_URL=http://127.0.0.1:7456 npm run dev     # 或 OD_PORT=7456
   ```

   没有装 Open Design 时可以用自带的模拟 daemon（实现了上面所有读写和评论接口，会话和评论存在 `<目录>/.od-mock/`）：

   ```bash
   npm run mock-daemon -- ./my-site --port 7457 --id my-site
   OD_DAEMON_URL=http://127.0.0.1:7457 npm run dev
   ```

4. **静态目录** — 任何带 `manifest.json`（`{ "files": [{ "name", "size", "mtime" }] }`）的静态目录。

## URL 参数 / 嵌入

| 参数 | 说明 |
| --- | --- |
| `source=demo` | 内置示例（默认） |
| `source=daemon&project=<id>[&daemon=<origin>][&name=<label>]` | daemon 项目；`daemon` 留空则走同源 `/api` 代理 |
| `source=static&base=/path/&name=<label>` | 静态目录 |
| `file=<路径>` | 打开指定文件 |
| `embed=1` | 只显示单个查看器（无标签栏、只读，不显示评审与编辑工具），用于嵌入 |
| `lang=zh-CN\|en`、`theme=light\|dark\|system` | 语言 / 主题 |

```html
<iframe src="https://your-host/?source=daemon&project=proj_123&file=index.html&embed=1"
        style="width:100%;height:720px;border:0"></iframe>
```

## 目录结构

```
src/
  app/          App（数据源、URL 状态、主题）、项目切换菜单 + daemon 对话框
  workspace/    PreviewWorkspace（标签栏 + 「+」启动菜单 + 保留式查看器 + 评论浮动卡片宿主）、DesignFilesPanel
  viewer/       FileViewer 分发、HtmlViewer（预览 + 注释 / 标记 / 编辑 / 评论）、Markdown / React / 简单查看器
  review/       评论存储（daemon / IndexedDB）与共享状态、评论卡片、画布评论钉、手动编辑宿主逻辑
  sketch/       草图文件的加载、自动保存、导出图片
  sources/      PreviewSource 接口（读 + 写）：StaticSource / LocalSource / DaemonSource、浏览器叠加层、资源内联
  lib/          小工具（hooks、IndexedDB、zip）
  i18n/         upstream-strings.ts（同步生成）+ 本项目文案
  styles/       upstream.css（同步生成，按用到的选择器裁剪）+ app.css（本项目覆盖）
  vendor/open-design/   从上游原样拷贝的代码（见下）
scripts/
  sync-upstream.mjs   从上游重新同步代码、文案、样式
  smoke.mjs           预览面板端到端测试（用本机 Chrome）
  review-smoke.mjs    评审 / 编辑 / 草图端到端测试
  mock-daemon.mjs     模拟 daemon
```

### 与上游的对应关系

| 上游 (`nexu-io/open-design`) | 本项目 | 方式 |
| --- | --- | --- |
| `apps/web/src/runtime/srcdoc.ts` 等预览运行时、`packages/contracts/src/runtime/*` | `src/vendor/open-design/` | **原样拷贝**，只改写 import 路径 |
| `edit-mode/bridge.ts`、`edit-mode/types.ts`、`edit-mode/source-patches.ts` | 同上 | 原样拷贝（编辑桥、编辑类型、源码补丁） |
| `comments.ts`、`comments/{anchor,owner-anchor,target-index}.ts`、`packages/contracts/src/api/comments.ts`、`comment-target-title.ts`、`runtime/comment-identity.ts` | 同上 | 原样拷贝（评论模型、锚点、编号、Agent 上下文） |
| `components/BoardComposerPopover.tsx` | 同上 | 原样拷贝（评论气泡、悬停样式卡片） |
| `components/PreviewDrawOverlay.tsx` | 同上 | 原样拷贝 + 一处补丁（标记工具） |
| `components/ManualEditPanel.tsx` | 同上 | 原样拷贝（手动编辑检查器） |
| `components/SketchEditor.tsx`、`SketchPreview.tsx`、`sketch-model.ts`、`sketch-colors.ts`、`Toast.tsx` | 同上 | 原样拷贝（草图编辑器） |
| `components/workspace/TabLauncherMenu.tsx`（+ `.module.css`）、`tab-launcher.ts` | 同上 | 原样拷贝（「+」启动菜单） |
| `packages/components` 的 `Button`、`Textarea` | `vendor/open-design/ui-components/` | 原样拷贝 |
| `exports.ts`、`zip.ts`、`speaker-notes.ts`、`deck-thumbnail-parser.ts`、`react-component.ts`、`Icon.tsx`、`DeckThumbnailRail.tsx` 等 | 同上 | 原样拷贝 |
| `@open-design/host`、`collab/workspace-identity`、`i18n`、`types.ts`、`providers/registry.ts`、`contracts/analytics` | `vendor/open-design/shims/` | 手写适配（无宿主、无团队、无埋点；`registry` 只提供草图缩略图需要的读文件） |
| `FileViewer.tsx` 里 `HtmlViewer` 的评论 / 标记 / 编辑宿主逻辑 | `viewer/HtmlViewer.tsx`、`review/useManualEdit.tsx`、`review/review-bridge.ts` | 按同样 DOM/class 和消息协议重写 |
| `FileViewer.tsx` 的 `CommentSidePanel` / `CommentSideDock` / `CommentPreviewOverlays` / `CommentTargetOverlay` | `review/CommentSidePanel.tsx`、`review/CommentPreviewOverlays.tsx` | 按同样 DOM/class 重写，去掉团队协作 |
| `ProjectView.tsx` 的评论状态与 `comment-float-host` | `review/CommentsContext.tsx`、`workspace/PreviewWorkspace.tsx` | 重写 |
| `FileWorkspace.tsx` 的草图标签、`startNewSketch`、`createMarkdownDocument`、上传 | `sketch/SketchFileViewer.tsx`、`workspace/PreviewWorkspace.tsx` | 重写 |
| `FileViewer.tsx` 的 `MarkdownViewer`（编辑 + 自动保存） | `viewer/MarkdownViewer.tsx` | 重写 |
| `components/FileWorkspace.tsx` 的标签栏与保留式查看器、`DesignFilesPanel.tsx` | `workspace/*` | 按同样 DOM/class 重写 |
| `styles/**/*.css`（`index.css` 的整个导入链） | `styles/upstream.css` | PurgeCSS 按本项目用到的选择器裁剪 |
| `i18n/locales/{en,zh-CN}.ts` | `i18n/upstream-strings.ts` | 抽取 `fileViewer.* / designFiles.* / workspace.* / manualEdit.* / sketch.* / comment.* / chat.comments.* / chat.annotation*` 等 |

上游 `FileViewer.tsx` 约 2 万行、`FileWorkspace.tsx` 约 9 千行，深度耦合聊天、协作、分享、计费与埋点，
因此宿主层是按相同结构、类名和 iframe 消息协议重写的；真正决定行为的部分——srcdoc 注入、选择 / 评论桥、
手动编辑桥、源码补丁、评论模型、评论气泡、标记层、编辑检查器、草图编辑器、启动菜单——都是上游原样代码。

### 和上游行为不同的地方

- **没有聊天**：上游评论和标记的「发送给 agent / 加入输入框 / 排队」在这里不存在。评论卡片的多选操作改为
  「标为已解决」和「复制给 Agent」（复制内容由上游 `commentsToAttachments` + `messageContentWithCommentAttachments` 生成）；
  标记工具的三个提交按钮改为「保存为评论」「复制标注图」「下载标注图」（通过翻译重映射实现，未改上游组件），
  同步脚本对 `PreviewDrawOverlay.tsx` 打了一行补丁：说明框里按 Enter 执行「保存为评论」（上游是排队到下一轮对话）。
- **评论存放**：上游评论只存在 daemon 里；非 daemon 项目这里存进浏览器 IndexedDB（跨标签页同步）。没有团队协作，
  评论没有作者，评论钉和卡片头像显示评论编号（daemon 返回作者名时显示作者首字）。
- **编辑写回**：上游编辑通过 daemon 写文件并记录版本；这里写到当前数据源（见上表），不记录版本历史。
  评论 / 编辑以外上游工具栏里的「Inspect」、圈选（pod）在上游工具栏中也未开放，这里同样没有。
- 浮动翻页条：上游靠 `.comment-preview-canvas:hover` 显示，这里额外注入了一个只上报指针活动的小脚本来显示它。
- 深色模式下设计文件卡片：上游写死了 `#fff` 背景，这里在 `app.css` 里改成主题色。
- 缩放菜单多了「适应」项；导出菜单多了「下载原始文件」「复制源码」。
- PNG / PDF 导出：上游纯 Web 路径把隐藏的导出 iframe 放在 `left:-100000px`，Chrome 会停掉屏幕外跨源 iframe 的
  `requestAnimationFrame`，导出永远等不到结果。同步脚本对 `runtime/exports.ts` 打了一行补丁（见 `PATCHES`）。

### 没有提取的部分

聊天 / agent、版本历史、分享与部署、PPTX 导出、Live Artifact、设计系统标签、内置浏览器 / 终端标签、
重命名 / 删除文件、团队协作（作者、同步横幅、锚点漂移持久化）、Inspect 样式面板——这些依赖账号体系、
agent 运行时或桌面端，留在 Open Design 本体。

## 与上游保持同步

```bash
# 默认读取 ../source（与本项目同级的上游 clone），也可以传路径或设置 OD_UPSTREAM
npm run sync:upstream
npm run sync:upstream -- /path/to/open-design
OD_SYNC_ONLY=styles npm run sync:upstream     # 只重新生成样式（code,i18n,styles 可组合）
```

同步脚本按上游目录结构解析每个相对 import，指向对应的拷贝或 `shims/` 适配层；如果上游新增了不在拷贝范围内的依赖，
会打印警告。组件里新用到上游 class 名后，重新跑一次 `styles` 同步即可。当前同步的上游提交记录在 `src/vendor/open-design/UPSTREAM.json`。

## 测试

```bash
npm run dev                      # 先启动开发服务器
npm run smoke                    # 预览面板：37 项端到端检查（含导出；需要本机安装 Google Chrome）
npm run smoke:review             # 注释 / 评论 / 标记 / 编辑 / 草图 / 启动菜单 / 文档 / 上传

# 同时验证 daemon 数据源（读写文件、评论接口、实时刷新）
npm run mock-daemon -- /tmp/demo-copy --id proj_demo &
OD_DAEMON_URL=http://127.0.0.1:7457 npm run dev &
SMOKE_DAEMON_PROJECT=proj_demo SMOKE_DAEMON_DIR=/tmp/demo-copy npm run smoke
SMOKE_DAEMON_PROJECT=proj_demo SMOKE_DAEMON_DIR=/tmp/demo-copy npm run smoke:review
```

`SMOKE_SCREENSHOTS=<目录>` 会把每一步截图保存下来。`smoke:review` 会先清空浏览器里示例项目的修改和评论；
对 daemon 会检查修改确实写进了项目文件、评论确实存进了 daemon。

## 许可证

Apache-2.0。`src/vendor/open-design/`、`src/styles/upstream.css`、`src/i18n/upstream-strings.ts`、
`public/fonts/` 以及示例里的 `pitch-deck.html`、`dashboard.html` 来自 nexu-io/open-design，见 `NOTICE`。
草图编辑器依赖 Excalidraw（MIT）。
