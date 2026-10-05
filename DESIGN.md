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

## 14. 2026-10-01 Phase 6 合成兼容矩阵

新增 `node tests/client/browser-check.mjs --compatibility-only`，覆盖：

- forced-colors + reduced-motion；
- 120% 页面缩放；
- 200% 页面缩放；
- 长内容和目录横向溢出检查；
- 当前证据目录 `D:/eac-market-verify/implementation-20260928/C-UI/compatibility`。

该矩阵只证明 Client 在合成 Edge 中的静态兼容分支，官方 DeepSeek Harness Desktop 仍须在登录/API Key 可用后单独验收。


## 15. 2026-10-02 前后端现有接口接入与设置可用性

本轮遵循既有 [视觉与交互方向合同](docs/handoff/VISUAL-INTERACTION-DIRECTION-2026-10-01.md)，不重新设计整套页面，也不在 Client 内复制 Core 业务逻辑：

- 设置页把已登记来源、维护快照、手动只读版本比较和检查偏好组织成一组可理解的分区；来源列表只读宿主配置，不接收任意 URL 或本机路径。
- 来源刷新使用已登记 `sourceId`；离线包来源不提供不支持的网络刷新按钮；Agent Forge 行为同时检查宿主 capability、Remote 方法和来源是否启用。
- 维护快照只在 `environmentId` 与当前 Host 相同才显示，防止跨 Profile 状态串显。来源状态只展示结构化状态和安全的下一步提示，不显示 Host 原始错误文本（可能包含 URL、凭据或本机路径）。
- `taskEvents` 只在用户展开任务记录后读取，按 100 条一页追加历史，游标按实际返回页末推进（不信任旧 Host 全历史末端值），并合并仍在更新的任务摘要事件；旧 Host 缺方法时保留摘要中的最近事件，失败可手动重读。
- `checkUpdates` 的 `refreshFirst:false` 是只读比较，不走写入握手；要求刷新已登记来源时仍走写入握手。策略保存发送当前 `expectedRevision`，失败后重新读取但不自动重放。
- 当前 Core 调度器在 DSH 生命周期运行，面板关闭不停止；DSH 退出则暂停，重启恢复。但旧 Host 的 update-policy capability 只证明策略读写，UI 因此不把保存策略当成调度已启动或已执行的回执；返回的旧自动写入偏好也如实展示，用户保存才关闭。最近/下次后台检查状态还没有公开 Remote 查询合同；待 G0 选择冻结后再增加显示。

验证记录：`pnpm check` 通过（72 个测试文件通过、1 个固定协议文件跳过；675 项通过、2 项跳过；Remote descriptors 37 个）。全量合成 browser-check 当前记录 42 项通过；设置专项还覆盖 480px/1280px、明暗主题、活动按钮对比度/44px 目标、旧宿主/capability 缺失、revision 冲突、offline-pack 按钮边界、来源刷新错误脱敏、跨 Profile 快照拒绝，以及 `taskEvents` 分页读取/旧 Host 无此方法时的降级。截图在 `D:/eac-market-verify/market-client-20261002/integration-cursor-and-scheduler-20261002-1536/` 与专项输出目录。

未验证：官方 DeepSeek Harness Desktop `0.2.0-rc.1` 的真实 Remote/生命周期；真实读屏、主题 token、120%–200% 缩放、forced-colors、嵌入 Modal、网络来源刷新和 pluginManager 长链路。合成 browser-check 不替代这些验收。


## 16. 2026-10-02 官方试用反馈：首推与安装提示修复

用户选择方案 A：在既有 Quiet Editorial Utility 方向上修复 Client 和市场宿主适配，不重写官方程序、不自动处理旧皮肤，不批准 G0 新合同。

- 海报优先使用真实精选；没有精选时将现有目录中已有安装包且非硬不兼容的功能条目展示为“插件探索”，明示不是团队精选或评分。只做视觉组织，不构造虚假的 DiscoveryCard/推荐记录。没有图片或图片失败保留同尺寸排版海报；皮肤、高分分区仍无数据不显示。
- 大海报位于皮肤入口之前，保留详情、安装方案、分页、手动暂停；手动暂停与悬停/焦点暂停独立，后台隐藏监听不依赖轮播 timer，返回后可恢复。减少动态时不自动轮播和淡入。标题使用平衡换行，避免长中文孤字。
- 列表中 unverified 是中性事实，不等同已知危险；硬不兼容保留 danger。安装采用「预检 → 方案 → 一次最终确认」（2026-10-05 定案，本句为唯一规则）：不额外要求试装勾选，未验证理由在方案内以中性状态与折叠说明呈现，不自动开始任务。
- inventory:unverified-state 单独解释为环境状态待核对，不宣称目标插件有风险；该状态下隐藏无法解除阻断的试装勾选，提供官方插件页与重新预检。现有库存 unknownItems 仅投影安全包名和通俗类别，不输出原始路径/URL/凭据。
- 常驻冗长保护说明折叠收纳；降级第二次确认、校验/缺包/硬阻断、未知提交不重放等保护不变。

新增 9 项 Client 回归、Client 全量 244 项、Adapter 定向 68 项通过；主控串行完整检查 736 项通过、2 项固定协议跳过，类型/包边界通过；合成浏览器全量 48 项通过，Impeccable detect 为 []。新包尚未覆盖用户官方版，最终本机重装和安装预检实机边界以最新交接记录为准。

## 17. 2026-10-04 StoryStream 重造与触感层

用户选择方案 B 血统的 The Verge 方向并要求"完全重新设计 + 每个部件有独立且协调的设计"。本节记录两轮实施。

### 17.1 骨架重造（StoryStream）

- 全局：频道刊头条（薄荷徽标 + 01/02/03 频道标签，当前频道薄荷压纸块）。
- 发现页：刊头（DISCOVER 小标 + 超大标题 + EDITION 版次线）+ `00–06` 编号章节 + 左侧虚线轨道流（单列）；无图海报整块紫外光。
- 全部插件：卡片网格改行情表（等宽序号 + 行分隔 + 扫光悬停）；我的插件改机架条（状态色带 + 整宽行）。
- 详情页双层壳带头；设置台账化；任务日志化。视觉基底按 `awesome-design-md/theverge` 重写：薄荷/紫外/黄/粉危险色、等宽大写小标、20/24px 圆角、零投影、宿主主题变量跟随。

### 17.2 触感层（同日第二轮）

五个签名母题：危险色标签 tab、硬边立体台阶（2/4/6px 实色投影）、编号牌、虚线轨道、贴纸/盖章。

- 按钮实体物理：hover 抬升 1px 加深台阶，active 位移 +2px 台阶归零，disabled 平灰虚线无台阶。
- 主按钮磁吸（原生 JS，ref+rAF，仅精确指针且非 reduced-motion，位移 ≤3px）；徽标有任务时脉冲、页面隐藏暂停（visibilitychange）。
- 入场：刊头错峰淡入、章节编号 rotateX 翻牌、轨道自上而下画入、节点错峰点亮（上限 6）；海报切换 clip 翻页。
- 状态时刻：成功盖章动效、失败单程抖动、运行中紫外块呼吸；同一任务首次安装/更新成功时16 片四色纸屑 900ms 自动清理，失败与 reduced-motion 绝不撒纸。
- 部件性格：皮肤卡拍立得轻倾 hover 摆正、高分前三名黄/粉/薄荷奖牌、RESTART/BLOCK 贴纸角标（data-sticker 定点，不滥用）、详情带头双层壳、画廊 hover 透视倾斜、目录计数进页滚动一次（aria-hidden 可见层 + sr-only 播报层分离）。
- 降级：`prefers-reduced-motion` 关闭全部位移/翻牌/彩纸/脉冲，保留颜色与台阶的即时状态；forced-colors 移除台阶回系统色。禁渐变、禁模糊阴影、禁 prefers-color-scheme 媒体查询。

### 17.3 验证

typecheck/lint 通过；Client 248 项通过（新增触感层断言）；browser-check 54 项通过（新增"按压台阶/成功彩纸/reduced-motion 降级"微交互检查）；兼容专项（forced-colors+reduced-motion、120%/200% 缩放）通过；全量 `pnpm check` 758 项通过、2 项固定协议跳过、包验证通过。截图证据位于 `D:/eac-market-verify/implementation-20260928/C-UI`（含 directory/rack/stream/detail 新截图）。官方 Desktop 实机验收仍属 P0 未完成项，合成检查不替代。

## 18. 2026-10-04 排版与按键错位升级（AAA 定案）

用户实机反馈"排版不合理、按键效果错位"，经 `tests/client/layout-audit.mjs` 在 8 个场景逐元素量测确认 5 类真实缺陷并全部修复，三个定案均为 A：只动台阶不动物体 / 详情单列整合 / 行布局改 flex。

- **D1 幽灵空白**：行情表行与机架行从固定 `grid-template-areas` 改为 flex 主行 + 全宽说明行（order 控制流向），清除空轨道 gap；移除遗留 `min-height:206/208px` 与 `margin-top:auto`。审计指标：行尾空白 ≤24px（实测 16–17）。
- **D2 顶栏错位**：三块同排中心差 17px → 0；频道标签高改 56px 与刊头内容区等高、底边与 2px 墨线齐平（1280 diff=0，480 通过 `.topbar--editorial .nav padding-bottom:0` 修正为 0）；章节头对齐改 center。
- **D3 详情半空列**：带头从 main 提出为 `.eac-market__detail` 直接子元素，网格改 `head / side / body` 三区域单列流（带头→来源信息条→正文）；仅 ≥1440px 分栏且右栏 sticky。浏览器检查选择器同步。
- **D4 按键错位**：hover/active 全部移除本体位移（悬停=台阶加深、按压=台阶归零+`brightness(.95)`）；频道标签、胶囊、海报控制、工具钮、机架行、行情行、设置行、系统组折叠均不再推移内容；磁吸改为 `pointerenter` 接管、`pointerleave` 清除、去掉 40px 提前感应与 −1px 基准，进入位移经120ms 过渡平滑。
- **D5/D6**：章节头 `align-items:center`（误差 12–40px→0）；审计工具补齐 `sr-only` 排除、同行基线判定、导航贴合直测、磁吸强制能力模式（stub matchMedia），并升级为**超标即 exit 1** 的回归门禁。
- 新增浏览器检查 2 项：`微交互`（按压无位移+台阶塌陷+彩纸/reduced-motion/磁吸正反向）与 `排版节奏`（行尾 ≤24、顶栏中心差 ≤4、标签贴合 ≤1）。

验证：typecheck/lint 通过；Client 248 项通过；browser-check **55 项全过**；布局审计 **0 违规（exit 0）**；兼容专项通过；全量 `pnpm check` 758 项通过、2 项固定跳过、包验证通过（调度器测试偶发超时按交接文档单跑 24 项确认为历史波动）。截图证据 `D:/eac-market-verify/implementation-20260928/C-UI`，布局审计明细 `D:/eac-market-verify/layout-audit/findings.json`。官方 Desktop 实机验收仍属未完成 P0。

## 19. 2026-10-05 Round-3 全界面精修（双评审综合）

按 impeccable critique 方法论完成两项隔离评审：Assessment A（设计总监，Nielsen 28/40，结论"母题只覆盖展示型首屏"）与 Assessment B（证据检测，55/55 通过、0 布局违规，但抓到折叠触达 21–24px、窄屏 44px 规则被覆盖）。三项定案：**安装一次最终确认 / 任务真右侧抽屉 / 浅色下墨黑刊头+首推框**。

- **P0 定案落地**：DESIGN.md 第 16 节改为唯一规则（预检→方案→一次最终确认）；确认按钮 `disabled` 补 `result.status !== 'ready'` 与 `aria-busy`；高风险弹窗点击遮罩不再关闭；弹窗入场改"遮罩淡入 + 卡片始终不透明"（`eac-card-plant`）；弹窗打开时顶栏 `inert`+`aria-hidden`（关闭恢复，计数器防叠加），背景其余部分由 `aria-modal` + 焦点陷阱覆盖。
- **任务真抽屉**：`TaskDrawer` 走 `Modal variant="drawer"` → `.eac-modal-overlay--drawer/.eac-modal--drawer`，右缘滑入 460px、内容区独立滚动；任务贴片左侧 UV 计数编号牌（CSS counter，零 DOM 改动），脚本授权按钮升 primary 并标粉红「高权限操作」；焦点/几何/480 无溢出由新检查断言。
- **墨黑刊头+首推框**：`.eac-market__topbar--editorial` 与 `.eac-market__poster-stage` 固定 `#131313` 实色板并在局部重定义文字/线色 token（浅色宿主下也保持 The Verge 身份；深色天然等价）；forced-colors 下回系统色。
- **发现页**：fallback 海报只留大名+版本/包名 meta，右栏去重复 h3（`{hasImage && <h3>}`）；章节编号改 `nextChapter()` 按实际渲染动态排布（缺内容不再跳号）；分类 Pill 前 4 直出 + "更多用途"收纳；轮播自动换页重置 6.5s 计时并更新 live 播报；高级筛选"取消"升 outline。
- **目录/详情**：分页翻页后按容器几何滚回 `.eac-market__directory-meta`（容器高度必须真实可滚，夹具需 `official-panel-fixture`）；详情侧栏压成一行事实条（验证/安装/重启 + 可展开完整详情），禁用主按钮下可见"暂不可用原因"标签+文字并 `aria-describedby`；返回钮升 outline；单张失败截图 `:has(:only-child)` 跨列。
- **操作型页面母题化**：帮助三步上虚线轨道 + `01/02/03` 编号牌、FAQ 改 hairline 台账；设置拆 `01 目录与来源 / 02 检查与运行 / 03 外观与诊断` 三章节头；作者未保存改黄色贴纸、切换弹窗 safe 升 primary/破坏降 outline+粉标签；空状态加 `EMPTY` 编号牌；皮肤中心当前外观拆"主操作/工具行"两组；检查偏好保存失败升 `role="alert"`。
- **控件与动效**：全局 `summary ≥32px`（窄屏/粗指针 44px）；`@media (max-width:719px),(pointer:coarse)` 重申按钮/pill/轮播/菜单 44px 下限（置于全层之后防覆盖）；`FileTransferField` 补 `progressbar` 语义；reduced-motion 补齐 brand-mark/ranked/grid--two/skin-entry/tag 等残留位移；警告主体永平，仅 `RESTART/BLOCK` 贴纸静态旋转 −2°；彩纸改里程碑制（`ActionFeedbackState.milestone`：任务完成、插件启停管理、皮肤切换为 true；刷新/诊断/分析/导出只盖章）。
- **门禁**：browser-check 新增 6 项（任务抽屉、遮罩不关闭、分页回顶、海报去重、轮播播报、非里程碑不撒纸），共 **60 项全过**；layout-audit 触达/summary 纳入违规，**0 违规 exit 0**；Client 单测 **249 项全过**；closeLabel 全部以"关闭"开头（可见文字包含于可访问名）。

### Round-4 实机三连修（2026-10-05 晚，来自用户预览实拍反馈）

1. **任务抽屉布局问题**：根因是弹层此前 `position: fixed` 锚定整个窗口——窄面板预览时抽屉飘到窗口右边、与面板脱节，且被预览工具条压住头部。改为 **`position: absolute` + `.eac-market { position: relative }`**，弹层始终贴合市场面板四边；新增回归断言：① 抽屉 right/top 与 `.eac-market` 差 ≤2px；② 面板内容滚动 240px 时弹层位置不动（absolute 定位上下文在滚动容器之外的经典逃逸，实测通过）；③ 无任务空态改用 `EmptyState`（EMPTY 编号牌 + 标题 + 描述 + 动作），抽屉内自动垂直居中。连带修复：合成夹具页面补 `html,body,#root{height:100%}`（否则定位后的弹层塌成 0 高、截图全白），并给 `.official-panel-fixture` 补 `min-height:0`，防止 `min-height:100%` 顶掉 `calc(100dvh-32px)` 造成宿主溢出 32px。
2. **发现页筛选太紧凑**：胶囊行 `gap:10px`、内边距 `6px 14px`（高36），与「浏览全部插件」行间距18px（实测值已进 CSS 合同断言）。
3. **图标加蓝色底片 3D 感**：`.eac-market__plugin-icon` 改为双层贴纸——薄荷方块下叠 4px 紫外蓝底片 + 1px 墨边（`rgb(82,0,255) 4px 4px` + `rgb(19,19,19) 5px 5px 0 1px`），详情页大图标 6px 版本；forced-colors 下去台阶回系统色。任务贴片、机架、行情表、详情带头全部生效。

验证：Client 251 项通过；browser-check 60 项全过（含抽屉对齐/锚定/空态三项新断言）；layout-audit 0 违规；兼容专项通过。
