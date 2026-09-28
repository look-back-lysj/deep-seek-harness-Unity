# 角色 C：可靠交互与作者 UI 交接

日期：2026-09-28。工程 `D:/eac-market`，分支 `codex/market-reliability`，起点 `01b7e31dddb5715e79d155a4afbaa5472aba2013`。本报告只声明客户端实现和下述定向证据；没有运行官方 Desktop、全局构建或最终打包。

## 已完成的调用链

| 要求 | 修前复现 | 当前行为／回归 |
| --- | --- | --- |
| REV-10：同页库存 | `startTask` 直接返回完成时不刷新；轮询 effect 在 React 更新时销毁未完成的库存读取 | `MarketDataController.acceptTask` 对终态和实际变更标记库存待刷新；控制器生命周期独立于 render；新终态到来会使正在读取的旧库存失效 |
| REV-10：跨标签和迟到响应 | 只读本页已知活跃任务；A 的迟到结果关闭 B | 定时 `listTasks` 补偿其他标签；环境与任务时间／事件序号核对；安装目标各自挂载独立 session，A 只归并 A 的任务，不关闭 B |
| REV-10／AI | 每张卡展示同一个 AI 状态 | 提案状态属于 task/environment；过期、跨任务提案拒绝；`queued` 按 taskId 读取并归并，不假报 applied |
| 确认门禁 | 用户另点生成计划，试装勾选不约束按钮 | 打开即只读预检；勾选变化重新预检并立即废弃旧结果；未勾不能提交；硬性不兼容和 blockers 始终拒绝 |
| 影响确认 | AI 自动发送 `riskConfirmed:true` | AI 首次确认没有风险字段；仅在收到后台 challenge、显示影响并再次点击时提交 challengeId/challengeDigest/riskConfirmed。普通卸载及计划中的降级也有独立第二步，第一次零写 |
| REV-13 | distribution=recommended 当精选，compatibility 排序乘零 | 人工推荐只读 CatalogSnapshot.recommendations 的真实理由；规则排序使用兼容、用途、releasedAt，再以名称／ID稳定排序；分发类别不提升精选排名 |
| REV-13：空首页 | 大块教学和多个无数据区域 | 紧凑介绍、直接浏览入口、单条无目录说明、真实设置入口；没有推荐则不渲染精选分区；补充内容位于核心内容之后 |
| REV-14 | 正常停用且无 rows 显示未知；内部下一步枚举曝光 | 安装／配置启用／运行中／停用／待重启／运行未知分开；下一步为中文，原始枚举只在诊断详情；市场自身启停卸载按钮禁用并指向官方管理路径 |
| 目录失败 | facade 剥掉 status，旧缓存被写成刷新成功 | MarketRemote 消费完整 CatalogRefreshView；保留 current，failed 展示 reason；activation 回归验证失败结果不丢失 |
| 作者 | 无重开，JSON 冒充资料包，覆盖缺 revision | 草稿列表和 getDraft；新建不伪造 ID；覆盖带 expectedRevision；脏稿切换确认；图片绑定 draft/revision、base64+SHA256校验并生成 Blob；后台 ZIP 分块读取，验证身份／顺序／大小后下载 |

配置启用只能证明保存了启用意图。`rows[].fiberPhase === active` 才在 UI 表示运行中；重启要求只消费后台事实。未知结果不承诺取消、回滚或运行成功。

## 文件所有权与结构

角色 C 的实现文件：

- `packages/market/src/client/MarketPage.tsx`：主页面组装、普通管理、首页、五位置接缝。
- `packages/market/src/client/data-controller.ts`：有界读请求、串行任务同步、环境隔离、库存刷新与旧回包拒绝。
- `packages/market/src/client/InstallPlanDialog.tsx`：自动预检、试装绑定、会话隔离和降级影响确认。
- `packages/market/src/client/TaskDrawer.tsx`：每任务 AI 状态、挑战确认、任务恢复入口和中文下一步。
- `packages/market/src/client/AuthorWorkspace.tsx`：草稿编辑、预览覆盖、媒体及 ZIP；切换市场内主页面保留未保存编辑。
- `packages/market/src/client/model.ts`：Client facade 类型、状态投影、推荐排序；版本比较复用 A 新增的纯函数 `core/semver.ts`。
- `packages/market/src/client/components.tsx`、`ui.tsx`、`marketStyles.ts`、`transfer.ts`：可访问控件、状态卡、官方主题适配、受控媒体和分块校验。
- `tests/client/activation.test.ts`、`model.test.ts`、`states.test.tsx`、`transfer.test.ts`、`ui-audit.test.tsx`：修正原有期待。
- `tests/client/data-controller.test.ts`、`author-roundtrip.test.ts`、`browser-fixture.tsx`、`browser-check.mjs`：定向回归和隔离浏览器检查。

未编辑主控的 activation/index、contracts、Host、core、authoring、扩展目录或构建配置。工作树内其他 owner 修改仍在；不能把整份 `git diff` 都归于 C。未 commit/push，没有下载依赖。

## 主控接线状态

### README 的两条 Remote 方法

B 的真实 `ReadmeImporter.previewReadme/applyReadmePreview` 已由集成测试验证。主控已接入两个 Host endpoints 和 activation aliases；C 随后移除本地重复类型，直接使用共享 `ReadmePreviewView` 和 `ReadmeApplyPreviewRequest`。旧宿主缺任一方法时仍禁用 README 在线预览并说明本地 Markdown 替代；不绕回先覆盖再预览。

```ts
previewReadme(request: ReadmeImportRequest): Promise<ReadmePreviewView>
applyReadmePreview(request: ReadmeApplyPreviewRequest): Promise<ReadmeImportResult>
```

实际映射为 `previewReadme → authorReadmePreview`、`applyReadmePreview → authorReadmeApplyPreview`。确认消耗同一份候选内容，不重新抓浮动分支；后台保存同时保留 provenance。新增 facade 回归验证预览不调用应用、完整传递候选与 revision、确认结果解包和冲突失败保留。正式 GitHub 网络导入尚未验证，仍为 partial。

### 官方导航

`MarketPageProps.onOpenOfficialPlugins?: () => void` 由主控从已核实的官方 Client 导航注入。库存卡、详情和任务卡都已消费；没有回调只给“DSH 侧栏 → 插件”文字指引。浏览器测试只证明回调被调用，不能证明官方目标页实际打开。市场自身管理始终从这个路径进行。

### 第二波 E 的五个位置

`MarketPageProps` 接受 `extensions?: MarketExtensionHost` 和：

```ts
renderExtensionSurface?: (props: {
  host: MarketExtensionHost
  slot: ExtensionSlot
  context: Readonly<ExtensionContext>
  pageId?: string
}) => React.ReactNode
```

E 的 `ExtensionSurface` 可用 `props => <ExtensionSurface {...props} />` 接入。home 在核心发现内容之后；more 在次级菜单；page 有返回发现；detail 在固定信息之后；author 在核心编辑器之后。扩展未接时不显示虚构工具。

context 的 plugin/draft 是最小字段副本；安装请求必须匹配目录的 ID、version、digest 后进入核心预检；草稿建议只生成差异候选，保存仍需确认并使用 revision。没有 raw Remote、ctx、setter 或确认凭证。E 负责权限过滤、命名空间、注册清理、错误边界以及异步请求生命周期；这里不是扩展沙箱。`homeSupplemental/authorSupplemental/detailSupplemental` 也是纯渲染接缝。

## 定向验证及证据等级

产物目录固定 `D:/eac-market-verify/implementation-20260928/C-UI/`。既有审计现场没有删除。

| 命令 | 已观察结果 | 证据边界 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --pretty false` | 通过，noEmit；`types-final.log` | Client 类型检查，不是全局 build |
| `node node_modules/vitest/vitest.mjs run tests/client --reporter=verbose` | 7 文件40项通过；`unit-final.log` | 包含生产作者库和合成 Remote，不是 Desktop |
| `node node_modules/vitest/vitest.mjs run tests/client/transfer.test.ts tests/client/author-roundtrip.test.ts --reporter=verbose` | 上传完成清理传输槽的最后修改后，2文件8项通过；`transfer-final.log` | 新增1项测试，总测试定义41项；未把最后一次定向跑说成41项整组重跑 |
| `node node_modules/vitest/vitest.mjs run tests/client/activation.test.ts --reporter=verbose` | 共享 README 类型接入后，1文件7项通过；`readme-alias-regression.log` | 新增2项映射回归；未重跑整组，不代表正式网络导入通过 |
| `node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --pretty false` | 共享类型替换后通过；`types-readme-shared.log` | 无新增视觉改动，无需再次生成截图 |
| `node tests/client/browser-check.mjs` | 17组通过；`browser-final.log`、`browser-results.json` | 隔离 headless Edge、真实 React 组件、合成 Remote；没有官方 Desktop |
| `impeccable.cmd context --target packages/market/src/client/MarketPage.tsx` | 实际执行成功 | 根 PRODUCT 未被技能自动找到；已按任务先读 docs/PRODUCT.md，不复制或重建产品事实 |
| `impeccable.cmd detect --json <七个改动UI文件>` | 单次结果 `[]`；`impeccable-detect.json` | 检测器通过不是全部视觉验收 |

浏览器实测覆盖：未勾试装零提交、自动重预检、A 迟到/B 保留、降级两次确认、AI任务隔离和challenge、queued任务归并、作者重开和README冲突、图片revision绑定/预览/正文插入、普通卸载两次确认、刷新失败、Modal Tab/Escape焦点恢复、更多菜单方向键、1280与480px、深浅主题、长内容及空态。两轮成组视觉检查后停止微调。

真实作者库测试在新的两个目录之间完成图片上传、实际 ZIP 导出/再导入，确认正文、媒体摘要和来源署名保留；`author-roundtrip-*/actual-presentation.zip` 是测试资料。首次用例的字节比较曾因 Node Buffer 与 Uint8Array 的容器类型不同失败，改为比较同类型字节后通过，原失败日志保留，未改业务来迁就测试。

截图：`home-1280-light.png`、`home-480-dark.png`、`long-480-light.png`、`empty-480-light.png`、`author-480-dark.png`、`ai-480-dark.png`。图片中的目录和推荐均为明确测试夹具。

## 实际限制与后续验收

- 未验官方 Desktop 最终包、宿主实际主题值、读屏和缩放、真实默认模型、第三方正式发行及独立扩展 tgz；由主控最终组装后验收。
- REV-10/13 的 Client 修复有定向证据；REV-14 的实际导航等待主控注入。后台确认、取消、恢复、来源及启停事实由其他 owner 验证，C 不替其关闭编号。
- 普通卸载 UI 显示已知成员及未知数据影响；完整反向依赖/数据行为须由主控协调层判断。UI 的第二次确认不是跨进程鉴权保证。
- 单次读超时12秒后停止等待并暂停自动同步；最多160次轮询，连续3次读取失败暂停。重新读取或重新聚焦可恢复；超时不声称底层请求已取消。
- 图片只加载通过受控 readMedia 和摘要校验的 Blob；Markdown 里的外部图片默认不请求。原始 HTML 不执行。
- 下载 ZIP 只表示浏览器接收下载请求；未声称用户已在某路径保存文件、已上架或已发布。
- 最后检查未发现本轮 C 测试 profile 对应的 Edge 残留进程；官方 Desktop 没有被启动、关闭或修改。

## 最后限定增量：精选版本与私有组合

按主控新增的共享合同完成，仅修改 C 所有权文件：`model.ts`、`MarketPage.tsx`、`InstallPlanDialog.tsx`、新增 `plan-review.ts`，以及对应 Client 测试。没有改共享 wire、核心执行器、Host、activation 或 E 的扩展文件。

- 精选展示和用户选择的精选排序统一调用 `recommendationMatches`：ID 必须匹配；推荐记录带 version 时必须精确匹配该版本。旧版理由不能推荐新版；未带 version 的既有记录按原语义兼容。
- 首页增加「市场组合」卡片，消费 `CatalogSnapshot.collections`。`PlanTarget.collection` 和自动预检使用 `collectionId/collectionVersion`，不发送 packId/packVersion；公共套餐保留原独立身份。只有目录里的 ID、version、artifactDigest 均匹配才生成选择项，缺项明确展示并由 Host 核对必选关系；不拿新版替代组合的固定版本。
- 新装采用 collection.components.enabled；已装条目继续保留当前启停选择。确认会话包含 collectionDigest；后台 ready 计划的 collectionId/version/digest 任何一项不匹配即拒绝确认。
- 组合预检明确列出可执行、跳过和依赖暂停数量与每项结果。Host 明确 `action=blocked` 的项目不会被 UI 重新放行；存在独立安全项时允许确认整份已封存计划，核心负责跳过和依赖处理。全部 blocked 或只有被暂停的依赖时，确认仍禁用。
- 未勾试装而 Host 仍把未验证项列为可执行，或硬不兼容仍列为可执行时，拒绝整份确认；不能仅在 UI 文案声称会跳过。单插件门禁保留。成功项会保留，但不称整套成功。

修前复现：混合套餐中一项 blocked 即导致确认按钮整体禁用；目录没有私有组合入口；精选只按 pluginId 匹配。修后通过以下本轮定向验证：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `vitest run tests/client/plan-review.test.ts tests/client/ui-audit.test.tsx tests/client/model.test.ts --reporter=verbose` | 3 文件24项通过 | `collections-unit.log` |
| `node tests/client/browser-check.mjs --collections-only` | 5组通过：私有身份／部分确认、试装变化、公共Pack独立身份、全blocked／不安全计划拒绝、摘要漂移拒绝 | `collections-browser-final.log`、`collections/browser-results.json` |
| `tsc -p tests/client/tsconfig.json --pretty false` | 最终通过 | `types-collections-final.log` |
| 1280px 首页、480px 组合确认 | 合成浏览器截图，无横向溢出 | `collections/collection-home-1280.png`、`collections/collection-plan-480.png` |

类型检查过程遇到 E 与主控正在编辑的文件暂时不通过，原日志保留；主控修复 activation 后，最后只剩本轮测试夹具可选摘要的类型，C 已修正并通过完整 Client noEmit。未修改其他 owner 文件来制造通过。

以上仍不是官方 Desktop 或正式私有组合制品安装验收；真实执行结果、最终包和完整构建由主控继续验证。C 完成本节后停止写入，释放自己的 UI 文件供整合。
