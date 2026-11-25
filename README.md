# Open Design · Design Preview（Vue 3 业务组件库）

把 [nexu-io/open-design](https://github.com/nexu-io/open-design) 项目工作页**右侧的设计预览面板**
（`apps/web/src/components/FileWorkspace.tsx` + `FileViewer.tsx`）连同评审与编辑工具（注释、标记、编辑、评论）
和草图编辑器单独提取出来，做成 **pnpm Workspace Monorepo 的 Vue 3 业务组件库** + 一个演示应用。
组件库以源码形式分发（和同仓库其它子包一样由宿主的 Vite 直接编译），可以整包复制到现有系统里使用。

## 技术栈

| 类别 | 选型 | 版本 |
| --- | --- | --- |
| 核心框架 | Vue 3（Composition API、`<script setup>`） | 3.5.13 |
| 开发语言 | TypeScript | 5.7.3 |
| 构建工具 | Vite（`@vitejs/plugin-vue` 5.2.4，`vue-tsc` 2.2.12） | 6.4.4（根声明 `^6.0.0`） |
| UI 组件库 | Ant Design Vue（演示应用外壳：主题 / 国际化、daemon 连接对话框、确认框、错误页） | 4.2.6 |
| 状态管理 | Pinia（演示应用：数据源、主题、当前文件） | 3.0.1 |
| 路由 | Vue Router（演示应用：URL 查询参数即状态） | 4.5.0 |
| 国际化 | vue-i18n（组件库自带一个实例，跟随宿主语言） | 11.1.3 |
| HTTP | Axios，可注入平台 apiCenter 实例 | 1.9.0 |
| 样式 | SCSS + CSS 变量 | Sass 1.105.2 |
| 包管理 | pnpm workspace | 10.34.9 |

草图编辑器依赖的 Excalidraw 本身是 React 组件：组件库内部用一个很小的 React 岛（`createRoot`）挂载它，
只在打开 `*.sketch.json` 时按需加载；宿主不需要了解或安装 React（它是组件库自己的 dependency）。其余全部是 Vue。

## 目录结构

```
pnpm-workspace.yaml          apps/* + packages/*
packages/design-preview/     @od-design/preview —— 业务组件库（源码分发，main/types → src/index.ts）
  src/index.ts               对外导出：组件、数据源、插件、i18n、主题、HTTP
  src/plugin.ts              createDesignPreview({ http, i18n, locale })
  src/theme.ts               主题 + 样式作用域（.odp-scope）
  src/components/
    workspace/               PreviewWorkspace（标签栏 +「+」启动菜单 + 保留式查看器 + 评论浮动卡片宿主）、
                             DesignFilesPanel、EmbeddedViewer
    viewer/                  FileViewer 分发、HtmlViewer（预览 + 注释 / 标记 / 编辑 / 评论 + 演示 / 导出）、
                             MarkdownViewer、SVG / 图片 / 音视频 / 文本 / React 组件查看器
    review/                  评论卡片、画布评论钉
    sketch/                  草图文件的加载、自动保存、导出图片
    ui/                      AnchoredPopover、ToastHost、TranslationScope
    DesignPreviewProvider.vue  提示条 + 悬浮提示层（挂一次）
    ErrorBoundary.vue
  src/review/                评论存储（daemon / IndexedDB）、provideComments / useComments、手动编辑 useManualEdit
  src/sources/               PreviewSource 接口（读 + 写）：StaticSource / LocalSource / DaemonSource、浏览器叠加层、资源内联
  src/http/request.ts        Axios 请求层（setPreviewHttpClient）
  src/locales/               组件库 vue-i18n 实例；upstream-strings.ts（同步生成）+ app-strings.ts
  src/composables/ lib/ ui/  组合式函数、小工具、toast
  src/styles/                upstream.css（同步生成）→ upstream.scoped.css（作用域化，实际发布的文件）+ app.scss
  src/vendor/open-design/    上游代码：框架无关部分原样拷贝；React 组件移植为 .vue（见下）
apps/preview/                @od-design/preview-app —— 演示应用（独立运行 / 部署 / 嵌入）
  src/main.ts                Pinia + vue-i18n + Vue Router + createDesignPreview
  src/App.vue                a-config-provider（主题算法 / 语言）+ DesignPreviewProvider + ErrorBoundary
  src/views/PreviewPage.vue  数据源、URL 同步、拖放、项目切换
  src/components/            ProjectSwitcher、DaemonConnectModal（a-modal）、CrashScreen（a-result）
  src/stores/preview.ts      Pinia
  src/http.ts                平台 apiCenter 的替身（演示拦截器写法）
  public/demo-project/       内置示例项目
scripts/
  sync-upstream.mjs          从上游重新同步代码、文案、样式（含作用域化）
  smoke.mjs                  预览面板端到端测试（本机 Chrome）
  review-smoke.mjs           评审 / 编辑 / 草图端到端测试
  isolation-check.mjs        样式隔离检查（不污染宿主）
  mock-daemon.mjs            模拟 Open Design daemon
```

## 快速开始

```bash
pnpm install
pnpm dev             # http://localhost:5178 ，默认打开内置示例项目
pnpm build           # 两个包的 vue-tsc 类型检查 + 演示应用生产构建（apps/preview/dist）
pnpm preview         # 预览生产构建
```

需要 Node 20+、pnpm 9+。

## 接入现有系统（复制即用）

1. **复制组件库**：把 `packages/design-preview` 整个目录复制到你们 monorepo 的 `packages/` 下
   （包名 `@od-design/preview`，可按需改名）。它只依赖 `vue`、`vue-i18n`、`axios`（peer）以及自己的
   `@excalidraw/excalidraw`、`react`、`dompurify`、`micromark`、`jspdf`。
2. **业务应用里加依赖**：`"@od-design/preview": "workspace:*"`，然后 `pnpm install`。
3. **注册插件 + 引入样式**（`main.ts`）：

   ```ts
   import { createDesignPreview } from '@od-design/preview';
   import '@od-design/preview/styles';
   import apiCenter from '@/api/apiCenter';   // 平台的 Axios 实例
   import i18n from '@/locales';              // 平台的 vue-i18n 实例

   app.use(createDesignPreview({ http: apiCenter, i18n }));
   ```

4. **页面里使用**：

   ```vue
   <script setup lang="ts">
   import { DaemonSource, DesignPreviewProvider, PreviewWorkspace, setPreviewTheme } from '@od-design/preview';
   const source = new DaemonSource('', 'proj_123', '首页改版');   // '' = 走同源 /api 代理
   setPreviewTheme('light');                                      // 'light' | 'dark'
   </script>

   <template>
     <DesignPreviewProvider>
       <!-- 工作区需要一个有高度的容器 -->
       <div style="height: calc(100vh - 64px); display: flex">
         <PreviewWorkspace :source="source" initial-file="index.html" @active-file-change="onFile">
           <template #leading>…标签栏左侧插槽…</template>
           <template #trailing>…标签栏右侧插槽…</template>
         </PreviewWorkspace>
       </div>
     </DesignPreviewProvider>
   </template>
   ```

   只读嵌入单个文件用 `<EmbeddedViewer :source="source" file="index.html" />`。
   `DesignPreviewProvider` 在应用里挂一次即可（负责提示条和悬浮提示层）。

5. **Vite 配置**：开发时把 `/api`（以及 `/artifacts`、`/frames`）代理到 Open Design daemon，参考
   `apps/preview/vite.config.ts` 的 `proxy`；vue-i18n 的 feature flag（`__VUE_I18N_LEGACY_API__` 等）按平台已有配置即可，
   组件库只用 Composition API。`optimizeDeps.include` 可选，写法是 `'@od-design/preview > react'`
   （pnpm 下组件库的依赖不能从应用根目录直接解析）。

### apiCenter（Axios）约定

组件库所有请求（daemon 文件接口、评论接口、静态项目清单 / 文件）都走注入的 Axios 实例，因此平台的
**请求拦截器**（鉴权头、网关前缀）同样生效。组件库按 fetch 的语义读响应：自己检查 `status`、文本 / 二进制自己指定
`responseType`，所以**响应拦截器要原样放行它的请求**。这些请求都带 `config.odPreview === true`：

```ts
apiCenter.interceptors.response.use((res) => {
  if (res.config.odPreview) return res;   // 设计预览：原样返回
  return unwrap(res);                     // 平台自己的 { code, data } 解包 / 错误处理
});
```

也可以给组件库单独建一个实例：`createDesignPreview({ http: axios.create({ baseURL: … }) })`。
不传 `http` 时组件库用自带的实例（Fetch adapter，支持 `cache: 'no-store'`）。

### 样式隔离

上游 Open Design 的样式是整站样式（`:root` 设计 token、`body` 字体、`*` / `button` / `input` 重置）。
组件库发布的是作用域化后的 `upstream.scoped.css`：每条规则只作用于带 `.odp-scope` 的元素及其后代，
设计 token 定义在 `.odp-scope` 上，选择器优先级与上游完全一致（用 `:where()` 包裹）。
组件库渲染的每个根节点——工作区，以及传送到 `<body>` 的菜单、提示条、悬浮提示、演示层——都自动带上
`.odp-scope` 和当前 `data-theme`，所以：

- 宿主页面的按钮、输入框、文字、CSS 变量和 Ant Design Vue 组件都不受影响（`pnpm check:isolation` 验证）；
- 主题由 `setPreviewTheme('light' | 'dark')` 控制，与宿主页面的主题互不干扰；
- 组件库自己的 `app.scss` 只写类选择器。

### 国际化

组件库自带 vue-i18n 实例（中文 / 英文，文案取自上游）。传入宿主 `i18n` 后自动跟随宿主语言；
不传时按 `?lang=` → 本地记录 → 浏览器语言 选择，也可以调用 `setLocale('zh-CN' | 'en')`。
上游文案里有 vue-i18n 默认语法会误解析的字符（`|`、`@`、非占位的 `{}`），所以组件库实例用了与上游一致的
`{name}` 占位符编译器；宿主自己的文案不受影响。

### 主要导出

| 导出 | 说明 |
| --- | --- |
| `PreviewWorkspace` | 完整工作区：设计文件 + 文件标签 + 全部查看器与评审 / 编辑工具。props：`source`、`initialFile`；事件：`activeFileChange`、`dropFiles`；插槽：`leading`、`trailing` |
| `EmbeddedViewer` / `FileViewer` / `HtmlViewer` / `MarkdownViewer` / `DesignFilesPanel` | 单独使用的查看器与面板 |
| `DesignPreviewProvider` / `ErrorBoundary` | 提示条 + 悬浮提示层；错误边界（`#fallback="{ error, reset }"`） |
| `StaticSource` / `DaemonSource` / `LocalSource` / `localSourceFromDrop` / `listDaemonProjects` | 数据源 |
| `createDesignPreview` / `setPreviewHttpClient` | 插件 / 注入 Axios |
| `setLocale` / `useLocale` / `useT` / `previewI18n` | 国际化 |
| `setPreviewTheme` / `usePreviewScope` / `PREVIEW_SCOPE_CLASS` | 主题与样式作用域（自定义根节点时用 `v-bind="usePreviewScope().value"`） |
| `useToast` / `showToast` / `provideComments` / `useComments` / `Icon` / `RemixIcon` / `AnchoredPopover` | 其它 |

## 功能

| 区域 | 能力 |
| --- | --- |
| 标签栏 (`ws-tabs-shell`) | 「设计文件」标签 + 可关闭的文件标签；切换标签不重载预览（保留最近 4 个预览 iframe）；Ctrl+Tab 切换；当前文件的「演示 / 导出」按钮挂在标签栏右侧 |
| 「+」启动菜单 | 上游 `TabLauncherMenu`：搜索标签页或文件、按类型筛选、**新建**（新建草图 / 新建文档 / 上传）、**打开文件**、**打开标签页** |
| 设计文件面板 | 面包屑、按类别分页、HTML 页面实时缩略图卡片、图片瀑布流、搜索、行菜单、多选打包 ZIP 下载；空项目时显示「新建草图 / 新建文档 / 上传」 |
| HTML 预览 | 沙箱 iframe（`allow-scripts allow-forms allow-downloads`，不同源），由上游原样的 `buildSrcdoc` 生成 |
| 视口 / 缩放 | 桌面端 / 平板 820×1180 / 移动端 390×844；桌面端宽页面自动适配缩放；手动 50%–200% |
| 幻灯片 (deck) | 自动识别 deck；浮动翻页条、缩略图栏、键盘 ← → Home End R、演讲者备注 |
| 演示 / 导出 | 当前标签页 / 全屏 / 新标签页演示；导出 PDF、PNG、ZIP、独立 HTML、原文件、复制源码 |
| **注释** | 悬停元素显示样式卡片（尺寸、颜色、字体），点选元素后在上游的评论气泡（`BoardComposerPopover`）里写评论，可附图片、可追加多条备注 |
| **评论** | 画布上显示带编号的评论钉，浮动评论卡片列出本文件的评论——点开即可修改 / 删除，拖动排序，直接写页面级评论，多选后「标为已解决」或「复制给 Agent」，已解决的评论可展开并重新打开 |
| **标记** | 上游标记层（`PreviewDrawOverlay`）：框选 / 画笔 / 文字、撤销重做、附加图片、写说明；提交时「保存为评论」（Enter 默认此项）、「复制标注图」或「下载标注图」 |
| **编辑** | 上游手动编辑器：悬停元素出现参数按钮，浮动检查器（`ManualEditPanel`）改文字 / 链接 / 图片 / 样式 / 属性 / HTML / 完整源码，画布里直接改文字、拖动元素，撤销 / 重做；修改通过上游的 `source-patches` 写回 HTML 源文件 |
| **草图** | `*.sketch.json` 用上游的 Excalidraw 草图编辑器打开：800 ms 自动保存、手动保存、清空、「导出图片」把 PNG 写到草图旁边并可直接打开 |
| 文档 | Markdown 源码 / 分栏 / 预览；可写项目里直接编辑，停止输入 700 ms 后自动保存；「新建文档」生成上游同款模板 |
| 其他查看器 | SVG、图片、视频、音频、PDF、代码 / JSON（行号）、`.jsx/.tsx` React 组件 |
| 外观 | 上游设计 token 与样式（浅色 / 深色 / 跟随系统），中英文界面 |

## 数据源

演示应用左上角的项目按钮可以切换。编辑、草图、新建文档、上传都会写文件；评论单独存放：

| 数据源 | 文件修改写到 | 评论存放在 |
| --- | --- | --- |
| **示例项目** `apps/preview/public/demo-project/` | 当前浏览器（IndexedDB，叠加在只读文件之上；项目菜单可「丢弃浏览器中的修改」） | 当前浏览器（IndexedDB） |
| **本地文件夹（实时刷新）**（File System Access API，Chromium） | **直接写回磁盘上的文件夹** | 当前浏览器 |
| **本地文件夹 / 文件**（`<input>` 或拖入） | 只在当前标签页内存里 | 当前浏览器 |
| **Open Design daemon** | `POST /api/projects/:id/files` | daemon 的评论接口，与 Open Design 本体共享 |
| **静态目录**（带 `manifest.json`） | 当前浏览器 | 当前浏览器 |

daemon 读写用的是上游工作区接口：`GET /api/projects`、`/api/projects/:id/files`、`/raw/*`、`POST /files`，
订阅 `/events` 的 `file-changed`、`comment-changed`；评论走 `/api/projects/:id/conversations/:cid/comments`。

```bash
OD_DAEMON_URL=http://127.0.0.1:7456 pnpm dev            # 开发服务器把 /api 代理到 daemon（或 OD_PORT=7456）
pnpm mock-daemon -- ./my-site --port 7457 --id my-site   # 没有 Open Design 时用模拟 daemon
OD_DAEMON_URL=http://127.0.0.1:7457 pnpm dev
```

## URL 参数 / 嵌入（演示应用）

| 参数 | 说明 |
| --- | --- |
| `source=demo` | 内置示例（默认） |
| `source=daemon&project=<id>[&daemon=<origin>][&name=<label>]` | daemon 项目；`daemon` 留空走同源 `/api` 代理 |
| `source=static&base=/path/&name=<label>` | 静态目录 |
| `file=<路径>` | 打开指定文件 |
| `embed=1` | 只显示单个查看器（无标签栏、只读），用于嵌入 |
| `lang=zh-CN\|en`、`theme=light\|dark\|system` | 语言 / 主题 |

## 与上游的对应关系

| 上游 (`nexu-io/open-design`) | 本项目（`packages/design-preview/src/`） | 方式 |
| --- | --- | --- |
| 预览运行时 `runtime/*`、`packages/contracts/src/runtime/*`、`edit-mode/*`、评论模型 `comments*`、`sketch-model.ts`、`tab-launcher.ts`、`modal-stack.ts` 等 | `vendor/open-design/` | **原样拷贝**，只改写 import 路径（+ `PATCHES` 里记录的两处补丁） |
| `BoardComposerPopover`、`PreviewDrawOverlay`、`ManualEditPanel`、`SketchEditor`、`SketchPreview`、`TabLauncherMenu`、`TooltipLayer`、`DeckThumbnailRail`、`Toast`、`Icon`、`Button` / `Textarea` 等 React 组件 | `vendor/open-design/**/*.vue` | **移植为 Vue 3**：保留 DOM、class、data-testid 和行为；`Icon.ts`、`sketch/editor-helpers.ts`、`sketch/preview-model.ts` 由同步脚本从上游源码生成 |
| `@open-design/host`、`i18n`、`types.ts`、`providers/registry.ts` 等 | `vendor/open-design/shims/` | 手写适配 |
| `FileViewer.tsx` 的 `HtmlViewer` 与评论 / 标记 / 编辑宿主逻辑 | `components/viewer/HtmlViewer.vue`、`review/useManualEdit.ts` | 按同样 DOM/class 和 iframe 消息协议重写 |
| `CommentSidePanel` / `CommentPreviewOverlays` / `CommentTargetOverlay` | `components/review/*` | 按同样 DOM/class 重写，去掉团队协作 |
| `ProjectView.tsx` 的评论状态与 `comment-float-host` | `review/comments.ts`、`components/workspace/PreviewWorkspace.vue` | 重写（provide / inject） |
| `FileWorkspace.tsx` 标签栏与保留式查看器、`DesignFilesPanel.tsx`、草图标签、`MarkdownViewer` | `components/workspace/*`、`components/sketch/*`、`components/viewer/MarkdownViewer.vue` | 按同样 DOM/class 重写 |
| `styles/**/*.css` | `styles/upstream.css` → `styles/upstream.scoped.css` | PurgeCSS 裁剪 + `.odp-scope` 作用域化 |
| `i18n/locales/{en,zh-CN}.ts` | `locales/upstream-strings.ts` | 抽取用到的 key |

### 和上游行为不同的地方

- **没有聊天**：评论卡片多选操作为「标为已解决」「复制给 Agent」；标记工具三个按钮为「保存为评论」「复制标注图」「下载标注图」
  （通过翻译重映射实现），说明框按 Enter 执行「保存为评论」。
- **评论存放**：非 daemon 项目存进浏览器 IndexedDB；没有团队协作，评论钉显示评论编号。
- **编辑写回**：写到当前数据源，不记录版本历史。
- 浮动翻页条额外注入了一个只上报指针活动的小脚本来显示；深色模式下设计文件卡片背景改为主题色；
  缩放菜单多了「适应」，导出菜单多了「下载原始文件」「复制源码」。
- PNG / PDF 导出：同步脚本对 `runtime/exports.ts` 打了一行补丁，让隐藏的导出 iframe 留在视口内（否则 Chrome 停掉
  屏幕外跨源 iframe 的 `requestAnimationFrame`，导出永远等不到结果）。
- 样式：上游的全局样式被作用域化到 `.odp-scope`（见「样式隔离」）。

没有提取：聊天 / agent、版本历史、分享与部署、PPTX 导出、Live Artifact、设计系统标签、内置浏览器 / 终端、
重命名 / 删除文件、团队协作、Inspect 样式面板。

## 与上游保持同步

```bash
pnpm sync:upstream                         # 默认读取 ../source（与本项目同级的上游 clone），或 OD_UPSTREAM
pnpm sync:upstream -- /path/to/open-design
OD_SYNC_ONLY=styles pnpm sync:upstream     # 只重新生成样式（code,i18n,styles 可组合）
```

框架无关的代码直接覆盖；已移植为 Vue 的 React 组件不会被覆盖——脚本把上游源码写到 `.upstream-ref/`（已忽略），
把哈希记在 `vendor/open-design/UPSTREAM.json`，并列出自上次同步以来上游改动过的组件，按 diff 跟进对应的 `.vue` 即可。
样式同步后会自动重新生成 `upstream.scoped.css`。

## 测试

```bash
pnpm dev                         # 先启动开发服务器（默认 5178，可用 PORT=… 改）
pnpm smoke                       # 预览面板：34 项端到端检查（含导出；需要本机安装 Google Chrome）
pnpm smoke:review                # 注释 / 评论 / 标记 / 编辑 / 草图 / 启动菜单 / 文档 / 上传：34 项
pnpm check:isolation             # 样式不污染宿主：8 项

# 同时验证 daemon 数据源（读写文件、评论接口、实时刷新）：smoke 37 项、smoke:review 68 项
pnpm mock-daemon -- /tmp/demo-copy --id proj_demo &
OD_DAEMON_URL=http://127.0.0.1:7457 pnpm dev &
SMOKE_DAEMON_PROJECT=proj_demo SMOKE_DAEMON_DIR=/tmp/demo-copy pnpm smoke
SMOKE_DAEMON_PROJECT=proj_demo SMOKE_DAEMON_DIR=/tmp/demo-copy pnpm smoke:review
```

测试脚本可以传服务器地址（`pnpm smoke -- http://127.0.0.1:4173`），也能对 `pnpm preview` 的生产构建跑
（其中「本地文件夹写回」一项依赖开发服务器，会自动跳过）。`SMOKE_SCREENSHOTS=<目录>` 会保存每一步截图。

## 许可证

Apache-2.0。来自 nexu-io/open-design 的代码与资源见 `NOTICE`；草图编辑器依赖 Excalidraw（MIT）。
