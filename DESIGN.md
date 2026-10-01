# EAC Market Client UI 设计与验证记录

版本：2026-09-27 Worker D 客户端实现记录。事实以当前源码、`tests/client` 自动化结果、客户端单包构建产物和测试夹具截图为准；没有真实运行证据的项目统一放在“未验证项”。

## 1. 范围与不变边界

本次只修改：

- `D:\eac-market\packages\market\src\client\**`
- `D:\eac-market\tests\client\**`
- `D:\eac-market\DESIGN.md`

没有修改 Host、`src/contracts`、公共依赖、`package.json` 或锁文件。Client 通过冻结的 `MarketRemote` 读取 `hello / catalog / inventory`；测试夹具只存在于 `tests/client`。MVP 不包含 Star、GitHub 登录、在线投稿、认领或自行发布。

## 2. 技术决策与备选方案

| 技术点 | 方案 A | 方案 B | 方案 C | 当前选择与理由 |
|---|---|---|---|---|
| 页面视觉 | 官方主题上的克制应用商店 | 大幅图文编辑首页 | 独立炫酷视觉壳 | A。符合 Operate/Read 和 UI 任务书，不使用营销 Hero、随机风格、背景视频或重动画。 |
| 控件实现 | 直接导入官方 UI primitives | 语义化原生控件 + 官方 `--dsw-*` tokens | 自建完整组件库 | B。当前包的 primitives 作为外部模块在真实 Host 中可提供，但本地 Node 测试会因其未安装的内部依赖（如 `clsx`）无法加载；B 保持官方主题、键盘语义和可测试性，不改公共依赖。 |
| 状态来源 | Remote 真实状态优先，缺能力时明确禁用 | Client mock 驱动演示 | 伪造成功/进度 | A。mock 只在测试夹具中使用；运行时没有能力就显示真实原因。 |
| 安装确认 | Host `createPlan` 正式计划后确认 | Client 先算清单再执行 | 不确认直接安装 | A。未验证内容必须有明确确认，硬性不兼容不能绕过。 |
| 任务反馈 | Host `TaskState` + 有界事件 | Client 假进度轮询 | 只显示最终结果 | A。支持部分完成、待脚本授权、等待重启、取消中、unknown。 |
| 作者附件 | `TransferChunkRequest.data` 为 base64 文本块 | `Uint8Array` 直接发送 | 单个大文件请求 | A。遵循契约修订，分块、校验总量、超限/失败可追踪。 |
| 作者 Markdown | 安全 Markdown 子集（标题、段落、列表、代码、链接、图片） | 完全复用重型富文本平台 | 只允许纯文本 | A。代码只复制不执行，HTTPS 外链/图片受协议白名单约束。 |
| 导航状态 | EAC 内部 view state | 复用 Host 私有路由 | 每页整页刷新 | A。只切换 EAC 面板，不影响当前 DSH 会话。 |
| 激活顺序 | `remote.$mount` → namespace → locale → main/sidebar | 先读 namespace 再 mount | 只注册 UI 不 mount remote | A。`$mount` 才创建 `eacMarket` namespace；B 是本次真实 Client 失败的最小根因。 |

如需改变视觉或交互方向，请直接回复上表中的方案编号；当前实现按 A/B 组合继续，避免在验收前混入冲突风格。

## 3. 页面与状态覆盖

主导航固定为“发现 / 全部插件 / 我的插件”。任务、帮助、设置、作者工具从次级入口进入。

- 发现：真实目录精选、分类、套餐、空目录引导、三步上手。
- 全部插件：搜索（名称/作者/简介/标签/英文包名）、用途、验证状态、安装状态、分页、空结果清除筛选。
- 我的插件：已安装/启用/停用/加载失败/只读原因/卸载/需要重启/unknown 条目。
- 详情：固定版本、来源、兼容、安装状态、截图画廊、作者 Markdown、许可证、产物摘要；已知不兼容和缺少 bundle 不可安装。
- 套餐确认：正式 `PlanResult.ready/stale/blocked`、版本升级/降级/新增/保持/阻止、部分成功保留。
- 任务抽屉：排队、下载、校验、安装、部分完成、失败、取消中、待脚本授权、等待重启、unknown、取消/授权/继续操作。
- 作者工具：本地草稿、Markdown 编辑/预览、README 导入、附件 base64 分块传输、资料包准备下载、往返导入；没有在线投稿按钮。
- 设置/教程：目录刷新/来源/缓存能力/宿主主题/重看教程/诊断导出；没有 Star 提醒、登录或发布服务假开关。
- 生命周期：加载、错误重试、空目录、空列表、长文本、窄面板、减少动态、焦点恢复和错误清理。

## 4. Client 激活最小复现与修复

### 最小复现

旧顺序：

```ts
const remote = ctx.remote.eacMarket
await ctx.remote.$mount(TYPERT_REMOTE)
```

在真实 Cordis Context 中，`eacMarket` namespace 由 `$mount` 创建。Host 的 MarketService 已能 `hello`，但 Client 在 mount 前读取 namespace，必然抛出“ EAC market Remote is not mounted”，于是表现为整屏长期 Loading plugins，crash 只记 `@dsh-eac/market: failed`。

### 修复

`packages/market/src/client/activation.ts` 固定顺序：

1. `await ctx.remote.$mount(TYPERT_REMOTE)`；
2. mount 成功后读取 `ctx.remote.eacMarket`；
3. 注册 locale；
4. 注册 `main` slot；
5. 注册 `sidebar.panellist` slot；
6. 返回逆序清理函数。

任一阶段失败会回滚已经成功的 mount、locale 和 slot 注册，并输出 `[eac-market/client:activation]` 阶段日志。`index.ts` 只负责传入 generated remote、MarketPage 和图标，不再提前读 namespace。

### 自动证据

`tests/client/activation.test.ts` 使用“mount 前读取 namespace 就抛错”的 fake Context，断言真实顺序：

`mount → namespace → locale → main → sidebar`

同时验证失败回滚和正常卸载的逆序清理。13 个客户端测试通过。

## 5. 文件清单

- `packages/market/src/client/activation.ts`：激活顺序、阶段日志、局部清理。
- `packages/market/src/client/index.ts`：DSH Client 入口、`remote/slots/locale/layout` inject。
- `packages/market/src/client/MarketPage.tsx`：三主导航、发现/全部/我的、详情、设置、教程、作者工具。
- `packages/market/src/client/components.tsx`：插件卡、安装方案、任务抽屉、库存卡、截图画廊、文件分块字段。
- `packages/market/src/client/model.ts`：契约投影、筛选、状态文案、只读原因、任务辅助函数。
- `packages/market/src/client/transfer.ts`：base64 文件块、SHA-256、`uploadBytes`。
- `packages/market/src/client/ui.tsx`：语义控件、可访问 Modal、安全 Markdown 子集。
- `packages/market/src/client/marketStyles.ts`：仅市场根/弹层作用域的官方 tokens 适配、容器查询、深浅主题和减少动态。
- `tests/client/fixtures.ts`：只测试的真实形状夹具。
- `tests/client/*.test.ts(x)`：状态、激活顺序、base64 分块、SSR/窄面板证据。
- `tests/client/build-client.mjs`：客户端单包构建与 CJS wrapper 验证。
- `tests/client/screenshots/*`：Edge headless 测试夹具截图。

## 6. 测试与截图证据

- `pnpm exec tsc -p tests/client/tsconfig.json --pretty false`：通过。
- `pnpm exec vitest run tests/client --reporter=verbose`：4 个测试文件、13 个测试通过。
- `node tests/client/build-client.mjs`：客户端 bundle 生成成功，首尾为 `window.__ModuleLoader__.load` / `return module.exports` wrapper，包含 generated `TYPERT_REMOTE` 与 `apply`。
- `tests/client/screenshots/discover-1440.png`：发现页宽屏。
- `tests/client/screenshots/plugins-1280.png`：插件状态卡片、已安装/未验证/硬性不兼容/缺少安装包。
- `tests/client/screenshots/tasks-960.png`：任务抽屉、部分完成和依赖暂停。
- `tests/client/screenshots/narrow-480.png`：约 480px 内容区窄面板。

这些截图由真实 Client React 组件与测试夹具在 Edge headless 生成，不是官方 Desktop 截图；用途是布局和状态回归证据。

## 7. 未验证项

1. 尚未在修复后重新安装 tgz 并打开真实官方 Desktop 0.1.7-rc.2；因此不能声称官方 Desktop 已验收。
2. 尚未在真实 DSH 中验证 `slots.register` 的最终渲染、侧栏按钮 label、主题 token 具体值和焦点恢复。
3. 当前 generated Remote 只有 `hello/catalog/inventory`；安装、任务、作者 Host 传输等可选方法在真实 Host 未提供时会显示“当前运行时未开放能力”，不伪造成功。
4. `pnpm build` 受 B/C 未完成的非 Client 文件影响；本记录只验证 Client bundle 构建。
5. 真实插件截图、目录首批内容、套餐打包和 Desktop 集成测试尚未完成。
6. 真实键盘/读屏、120–200% 缩放、深浅主题和减少动态效果仍需官方 Desktop 验收。

## 8. 机械检查与收尾

按 `impeccable detect --json packages/market/src/client tests/client` 运行过一次机械检查，主要发现并批量修复：

- 语义成功/警告色在测试浅色背景上对比略低，已加深 fallback；
- 进度条对 `width` 做了布局过渡，已移除，改为无布局抖动更新；
- 测试预览容器缺少内边距，已补 1px 校验内距。

修复后重新生成四张同视口截图并人工复核；按技能要求没有重复运行第二次 detector。`pnpm test` 当前被工作区依赖供应链校验/网络重试阻塞在测试脚本之前，未进入 Vitest；等价的 `pnpm exec vitest run tests/client` 与客户端类型检查已通过，不能把网络阻塞写成测试通过。

## 9. 2026-09-29 交互与视觉升级

本节记录当前 Client 升级，不覆盖前文历史证据。

- 三个主导航的滚动、高亮和详情来源上下文已统一。
- 次级页面不再错误高亮“发现”。
- 已安装卡片提供“管理”入口；官方插件页入口提升到“我的插件”页头。
- 系统组件说明去重；禁用操作显示可见理由。
- 截图失败使用结构化占位、真实来源和重试，不伪造图片。
- 任务抽屉显示真实逐项进度和错误下一步；不伪造百分比。
- 安装 unsafe 预检提供真实“重新预检”按钮。
- 新增 `navigation.test.tsx`、`visual-polish.test.tsx`、`dialogs.test.tsx`。
- 本批 `pnpm check`、`pnpm typecheck`、Client 86 项测试、browser-check 26 项及 `impeccable detect` 均通过。
- 官方 Desktop、真实读屏、真实缩放和真实网络截图重试仍未验证，详见 [当前交互审查](docs/handoff/INTERACTION-AUDIT-2026-09-30.md) 和 [UI 重构合同](docs/handoff/UI-REBUILD-CONTRACT-2026-09-30.md)。

## 10. 2026-09-30 视觉与兼容性基础优化

本轮继续采用“官方 DSH 原生增强 + 编辑型发现页”的方向，只修改 Client、Client 测试和设计记录，不修改 Host、Core、公共合同、依赖或锁文件。

- 发现页首推轮播监听 `prefers-reduced-motion` 变化；后台页面暂停自动轮换；目录项目变化时限制当前索引；自动切换不触发持续读屏播报，手动切换保留可读提示。
- 首推海报与普通插件卡片保持一致的真实状态边界：已安装条目进入管理，不兼容或缺少制品时禁用安装，并显示真实原因。
- CSS 先提供安全基础样式，再使用容器查询、动态视口高度、主题增强和渐变作为可选增强。没有容器查询时使用单列安全布局，避免嵌入式窄面板出现三列挤压。
- 增加旧引擎焦点环、主题颜色 fallback、强制颜色模式、触控尺寸、`100vh` 基础高度和 `100dvh` 增强覆盖。
- 视觉证据由当前源码重新生成，当前批次输出位于 `D:/eac-market-verify/implementation-20260928/C-UI`；不再把 9 月 28 日旧截图当作当前视觉基线。

当前仍需真实官方 Desktop 验证：DSH 容器中 fixed Modal/overlay 的覆盖范围、真实主题 token 值、读屏、120–200% 缩放、强制颜色模式和真实网络图片失败重试。合成 browser-check 通过不能替代这些验收。

## 11. 2026-09-30 交互连续性与动效规则

本轮修复发现页到全部插件页的隐式跳转。发现页用途标签只在当前页筛选规则发现；只有明确的“浏览全部插件”或“查看该分类全部插件”操作才进入完整目录。进入完整目录会记录 `source/category/section/query/page/scrollTop`，在页面顶部显示来源上下文，并在返回详情或次级页面时恢复原位置和焦点。

页面切换只使用 Client 内部 view state，不引入 DSH 私有路由。内容区域使用一次性的 opacity/translateY 过渡，240ms 后回到静止状态；减少动态效果时完全关闭。分类结果使用 180ms 的局部过渡，不改变外层滚动容器。连续点击只保留最新意图，旧的滚动和焦点回调自动失效。

动效不得改变真实状态、安装确认、失败结果或 Remote 协议。不得用动画代替文字状态；旧浏览器、窄面板、forced-colors、图片失败和 Remote 缺能力时必须直接进入可读的静态状态。

## 12. 2026-09-30 商城视觉重构

本轮根据产品要求重新整理发现页和全部插件页，而不是继续堆叠普通卡片：

- 发现页明确按首推海报、推荐皮肤、高分插件、高分 skill、规则发现的顺序组织；没有真实数据的可选区块隐藏。
- 首推是整页第一视觉焦点，图片、标题、简介和推荐理由形成统一舞台；无图时使用同尺寸文字海报。
- 推荐皮肤使用独立视觉带；高分内容使用评分辅助的内容网格；规则发现保持紧凑目录密度。
- 全部插件默认展示内核完整目录，搜索、用途、安装状态和验证状态是目录工具，不再默认把用户限制在可安装条目中。
- 皮肤管理器入口在没有皮肤内容时不占据发现页首屏大面积。
- 页面继续只使用官方主题变量和原生控件，不引入独立视觉框架；渐变、阴影和动画只能增强层次，不能成为信息可读性的前提。
- 发现页与全部插件页不共享同一套密度：发现页偏编辑与展示，全部插件页偏目录与筛选。

本轮视觉基线由当前源码重新生成，合成 browser-check 26 项通过；真实 DSH Desktop、读屏、强制颜色和 120–200% 缩放仍需独立验收。

## 13. 2026-10-01 编辑型视觉系统实施阶段

本轮按照 [视觉与交互方向合同](docs/handoff/VISUAL-INTERACTION-DIRECTION-2026-10-01.md) 和 [实施计划](docs/handoff/VISUAL-INTERACTION-EXECUTION-PLAN-2026-10-01.md) 开始落地，不修改 Core、Remote、Host 或安装协议。

已完成的第一批实现：

- 页面壳、顶栏、品牌标记、主导航 active indicator 和内容轨道重新分层；
- 发现页去掉旧 eyebrow 依赖，调整页面标题、首推舞台、内容留白和区块节奏；
- 首推舞台使用不等宽媒体/信息关系，图片和文字降级保持同一布局；
- 推荐皮肤、高分区和规则发现使用不同密度，不再全部套同一张卡片；
- 目录工具栏、结果数量、筛选摘要、详情事实栏、任务面板、皮肤中心和作者工作台使用新的 surface/spacing 体系；
- 高级筛选改为 draft → apply，应用后才更新结果和分页，清除筛选仍会恢复第一页；
- 480px 窄面板下作者工具改为单列工作台；
- 动效预算收敛到 120–260ms 的局部反馈，并保留 reduced-motion / forced-colors fallback。

当前阶段证据：

- `pnpm typecheck` 通过；
- Client 定向测试通过；
- browser-check 27 项通过；
- `impeccable detect --json packages/market/src/client` 无问题；
- 完整 `pnpm check` 通过，包含构建、lint、测试和包验证。

仍未完成的真实宿主项目：DSH Desktop 真实主题 token、读屏、120%–200% 缩放、forced-colors、嵌入式 Modal 覆盖范围、真实网络图片加载和官方 pluginManager 长链路。
