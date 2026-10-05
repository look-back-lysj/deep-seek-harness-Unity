# 开发者交接：Core、Desktop Adapter、恢复闭环与后续验收

交接日期：2026-10-05，Asia/Shanghai。交接对象：接手维护本市场的下一位开发者，而非插件投稿者或普通安装用户。

本文提供接手顺序、代码入口、运行方法、状态语义和验收门禁；具体逐模块修改见[详细修改记录](MODIFICATION-RECORD-2026-10-05.md)，此前管理批次见[管理业务实录](MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md)。不要仅凭文档中的计划或历史数字认定当前检出通过。

## 1. 十分钟内先确定这些事实

1. 读本文件、`START-HERE.md`、`NEXT-AGENT-PLAYBOOK.md`、`../PRODUCT.md`和`../CORE-ADAPTER-GUIDE.md`；投稿作者则走投稿流程，不接管市场代码。
2. 当前协作分支是`refactor/market-core-adapter`，不是`main`或`dev`。先核对实际HEAD、工作区、远端和未提交内容，不重置、不删未知文件。
3. `9fc09a2`是本轮之前的代码基线，`9c6a1d2`只是接力文档提交。不能把9c6a1d2误当作本轮实现。
4. 本地功能提交`3fa1fc6`、旧批次文档提交`9709c75`；第一次正常合并GitHub三提交至`b8a977b`，结果为`e880a88`。随后`84a516b`交付隔离工具，`5df36be`交付两份详细文档。推送前重试fetch又取得五提交至`4f9a627`，第二次正常合并已整合并重新验证；两次取舍逐文件记录在修改记录第13节，不用ours/theirs整片覆盖。
5. 第二次合并后的源码候选为Adapter `0.1.0-mvp.19` / Core `0.1.6`。它包含更多Core/Client修复，**不等于**`releases/0.1.0-mvp.18-dual/`里先前制作的发行字节；这批Git提交不授权覆盖公开同版本制品或npm发布。第二次merge的实际SHA由`git log --merges --oneline`取得，不在产生它的提交内自引用。
6. 修复已覆盖核心版本事实、可选版本API、预检上下文、只读原操作恢复、媒体传递、作者工具与管理闭环。真实媒体目录体积、上游版本/制品映射及完整产品矩阵仍有阻断。
7. 官方实际载体是Desktop `0.2.0-rc.2`，不是原指定rc.1。合成Edge、rc.2、局部管理验收均不能冒充原载体全功能通过。
8. 数据目录、旧回执与未知结果不能为了让页面解锁而清空。not-found不证明未执行，库存当前状态不证明原请求成功。

```powershell
git status --short --branch
git log -8 --oneline --decorate
git remote -v
git fetch --all --prune
git log --left-right --oneline HEAD...origin/refactor/market-core-adapter
```

GitHub偶发连接reset已实际出现；单次`git -c http.version=HTTP/1.1 fetch --all --prune`重试成功。不要因此禁用TLS、修改VPN/DNS或认定远端没有新增提交。Git提交/推送、包发布、官方环境安装是三个不同动作，分别授权和验收。

## 2. 架构与所有权

| 层 | 主要入口 | 负责什么 | 不该做什么 |
| --- | --- | --- | --- |
| Core公共合同 | `packages/market-core/src/contracts/types.ts`、`compatibility.ts`、`src/api.ts` | DTO、能力、事实、业务结果和协议 | React、DOM、默认选项、loading或弹窗阶段 |
| Core业务 | `src/core/` | 预检、任务/管理执行、持久去重、维护意图、兼容性与更新事实 | 直接重建一个UI任务系统，拿Desktop版本冒充dsh核心 |
| Core运行协调 | `src/host/market-runtime.ts`及release/operation辅助模块 | 数据汇集、可信身份、计划冻结、API业务协调 | 在只读查询中执行写入或修复旧维护记录 |
| 官方DSH端口 | `src/adapters/dsh/host-port.ts`、`manager.ts`、`persistence-adapter.ts` | 唯一官方pluginManager入口、原子文件与锁 | 绕过官方供应链、权限、审批或卸载所有权 |
| Desktop Adapter | `packages/market/src/index.ts`、`host-core.ts`、`catalog-options.ts`、`version.ts` | Cordis/Typert注册、调用者/环境、官方核心读取、来源配置 | 重新计算Core业务或绕过公共API改Profile |
| Client | `packages/market/src/client/` | 默认版本选择、手选/确认、超时、重试、查询、展示与页面恢复 | 执行安装器、猜去重key、用缓存结果替代后端事实 |
| 验收工具 | `tools/desktop-acceptance/` | 隔离载体、候选Registry、合法fixture及只读审计 | 发布包、改官方asar、改日常环境或自动重放未知动作 |

并行开发需要真正的子智能体和互不重叠的文件owner；公共合同、锁文件、文档、构建、打包、同一官方Profile由主控串行处理。发现跨owner问题先交接，不直接抢写。必须保留`packages/market/src/protocol-ambient.d.ts`。

## 3. 环境与干净检出

- 项目要求Node >=24，`package.json`声明pnpm `11.7.0`。交接机实际Node `v25.9.0`、pnpm `11.19.0`；运行前记录实际版本，不用这一行替代自己机器核查。
- 不提交`node_modules/`、`.pnpm-store/`、`.verify/`、`lib/`构建输出、日志、Profile、token或本机新tgz。`.pnpm-store/`本批补入忽略规则，原缓存文件保留。
- 干净检出没有Core/Adapter的`lib/`和生成的Typert产物。先按锁安装依赖，再串行build，不能直接运行依赖生成文件的浏览器测试或打包。
- 完整Client浏览器测试依赖已有Windows Edge。默认路径`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`；部分夹具可用`EAC_TEST_EDGE`指定。不是跨平台无条件通过的测试。
- 额外扩展套件有独立配置并要求`DSH_SOURCE_DIR`指向官方源码；未具备环境就标待验，不拿默认全量结果声称该额外套件通过。
- 需要新增工具、依赖、下载官方载体或模型费用时先获主人批准；不擅自安装软件来让测试变绿。

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
node scripts/build.mjs
node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --noEmit --pretty false
node scripts/lint.mjs
node node_modules/vitest/vitest.mjs run --no-file-parallelism
node scripts/verify-package.mjs
$env:EAC_BROWSER_CHECK_OUT='D:/eac-market-verify/browser-handoff-new-batch'
node tests/client/browser-check.mjs
Remove-Item Env:EAC_BROWSER_CHECK_OUT
git diff --check
```

依赖安装命令是交接步骤，本次不是重新安装依赖的证据。build只删除并重建本仓两包`lib`；执行前核实解析的绝对路径仍在workspace。不要并发build、打包或让多个进程写同一证据目录。browser-check默认使用独立时间戳目录；显式输出也应为新目录，避免覆盖历史证据。

## 4. 协议和能力：接线时先看这里

| 项目 | 当前值/规则 |
| --- | --- |
| Core包版本 | `0.1.6` |
| Core API provider | `1.1.0` |
| Adapter Remote provider | `2.1.0` |
| Client最低Core API / Remote | `1.0.0` / `2.0.0`，不因可选功能全部提高 |
| Adapter Host所需Core API | `1.1.0`，编译调用新方法需要此能力，不能与Client最低版本混淆 |
| 可选能力 | `host-release-context`、`operation-recovery`等，以hello实际capabilities为准 |
| 方法探测 | capability和optional方法都检查；只有方法存在不能推断协议获准 |

关键公开API：`hostCore`、`releaseOptions`、计划创建/任务开始、`taskStartRecover`、`pluginActionRecover`、`pluginSetEnabled`、`pluginRemove`、`maintenanceStatus`、`checkUpdates`、`installLogRead`。实际Remote名称以`packages/market/src/index.ts`及生成描述符为准；Client facade的`setPluginEnabled/removePlugin`别名不一定是官方命名空间原名。Core业务方法41个，生成Remote descriptor42个，两者不是相同计数。

新Remote后必须运行官方生成器/build和包检查；不能手写第二套临时RPC协议。字段及方法兼容不等于业务结果没有变化：第二次合并带入上游已决定的宽松安装语义，详见7.1节；不要把同一个协议minor当作装后核对行为未变的证据。当前描述符计数只是接线检查，不是相同数量的官方功能通过。

## 5. dsh核心兼容与默认版本

### 5.1 数据入口

- `packages/market/src/host-core.ts`读取官方`getDshRuntimeVersion()`并形成可信HostCoreSnapshot；不读Desktop发行号作为兼容版本，不凭目录声明猜当前核心。
- `catalog/host-requirements.ts`规范化明确的目标Agent范围、版本scheme、来源与历史覆盖；Agent Forge的范围文本保留原语义。
- `core/host-compatibility.ts`使用既有`semver`求值，处理范围交集、prerelease、无解冲突、方案未知与预算边界。`semver`已成为Core明确运行依赖，类型是dev依赖；不是另造范围语言。
- 未声明范围、未知scheme、冲突、错误range或证据不足保留unknown/conflict。不能把“不是明确incompatible”标成compatible。

### 5.2 列表、来源与选择

- `catalog/merge.ts`合并已接受目录，保留不同版本；冲突、撤回、历史覆盖及来源revision进入事实，不只保留latest然后伪造全历史。
- `core/release-facts.ts`计算已安装关系、兼容、制品、publication和最新已取得记录；`host/release-options.ts`提供排序分页、cursor绑定、来源身份和上下文。
- `client/release-selection.ts`与InstallPlanDialog负责默认最高可选的适配升级。已安装同版/降级不自动选；有效手选保留；降级需要明确二次确认；分页有边界，不无限轮询。
- 最新包明确需要更高核心时提示`<agent名>核心版本过旧`并显示当前核心、最新包和要求范围。仅历史不完整、scheme未知、制品缺失或冲突时不能伪装成“核心过旧”。
- 旧Host缺新增能力走既有预检fallback；hello连接失败不能当作旧Host成功降级。

优先测试：`tests/core/host-compatibility.test.ts`、`tests/core/release-facts.test.ts`、`tests/host/release-options.test.ts`、`tests/client/release-selection.test.ts`、`release-selection-browser.test.tsx`、`install-version-selection.test.tsx`。

## 6. releaseContext与写前复验

### 6.1 绑定哪些事实

单次版本选择绑定environment、hostRevision、catalogRevision、inventoryRevision、plugin/package/version、metadata/artifact digest、releaseId及来源revision。后端重新计算并验证Client给的上下文，不能信任客户端自报。

`host/release-context.ts`、`host/market-runtime.ts`、`core/planner.ts`与`core/task-manager.ts`共同把身份纳入预检/计划摘要及执行复验。

### 6.2 失效门禁

1. 列表→预检期间核心/目录/来源/库存变化：返回stale或明确冲突，旧计划不可直接确认。
2. 下载前发生变动：零不应发生的下载、零官方写。
3. 下载后首次dispatch之前变动：零官方写，不把已下载当作获准安装。
4. 旧调用者创建的新计划也冻结后端取得的事实；旧耐久计划缺证据不补造相同binding。
5. catalogStale、撤回、来源冲突、摘要变化、活动写和未知官方状态不能被“确认安装”绕过。

重点测试：`tests/core/start-release-validation.test.ts`、`tests/host/release-context.test.ts`、`tests/core-api/release-options-runtime.test.ts`、`release-options-wire.test.ts`。

## 7. 原任务恢复：不另建任务系统

安装开始的原意图包含planId、planDigest和idempotencyKey；恢复还验证可信caller归属与environment。`taskStartRecover`只读原计划和任务记录，不调用start、不下载、不写官方插件。

InstallPlanDialog提交超时保留原意图；TaskDrawer使用TaskRequestGuard，展示超时或updatedAt更新不释放原Promise锁；迟到回包不能污染另一个任务、环境或新挂载。没有原plan/key不能由TaskCard猜恢复身份。

`not-found`、缺记录、权限/归属冲突都不是安全重发证明。取消不代表回滚已经发生的写入，partial/unknown/restart-required必须继续显示真实业务语义。

重点测试：`tests/host/operation-recovery.test.ts`、`tests/core-api/operation-recovery-wire.test.ts`、`tests/client/task-inflight.test.tsx`、`task-recheck.test.tsx`。

### 7.1 第二次合并带入的宽松安装、日志与恢复边界

上游`f6aef9f`及`MOJOBOX-COOPERATION-SUMMARY-2026-10-05.md`、`NIGHT-PLAN-2026-10-05.md`记录了方案1决定：官方明确`applied`时，装后库存/版本/缓存来源/启用核对的疑点写日志，不再仅因疑点改写为unknown；普通官方异常仍保留unknown及“已提交，结果未核实”文案，但不暂停后续独立安装。`failed`、审批、撤回、下载指纹及官方供应链门禁没有因此变成成功。

本次整合仍保留本地精准发行身份、来源撤回、可信dsh范围和`releaseContext`写前复验。普通`verification:hard-incompatible`标签按上游变成计划warnings，不再由统一复验函数额外硬拒绝；**可信dsh范围incompatible/conflict依然阻断**。宽松不意味着可以替换用户选定版本、使用错误摘要、接受撤回发行或自动重放原unknown。计划中的blocked/keep项目不因重复的全项早期校验破坏部分执行；实际写步骤在既有锁内统一复验。

官方`restartRequired`在`postcheck/logged`分支仍必须形成item `restart-required`和task `awaiting-resume`，本次已补回归测试，不能只在installOutcome字段保留重启字样却把task结成completed。

独立日志实现为`host/install-log.ts`，API `installLogRead({limit})`只读、最多500条、字段去敏，Client设置页负责导出中间态。日志不是原管理completion、供应链证明或完整任务账本，写日志失败不授权重放。OfficialHostPort constructor保留第4参核心revision getter，第5参日志sink，迁移调用时不要把对象当getter调用。

**静态确认的待验/待改边界：**普通unknown在宽松分支被标记为execution `verified`，attempt `finished`；启动恢复跳过该阶段，`taskStartRecover`只返回既有原任务快照，因此不能宣称它会追账之后才出现的可靠回执。后续应设计“非阻塞但仍可只读核对原request”的状态，测试迟到回执/冷启动/零重放/不重新全局阻塞；本轮未为此新增第二套恢复状态机，管理completion恢复也不替代该安装场景。

### 7.2 供货草稿与previewPacks的职责边界

新增`supply-draft-read.ts`、`supply-draft-validate.ts`、`supply-draft-classify.ts`以及`scripts/supply-draft-import.mjs`，负责读取、校验、四档分类与导入报告。未取得可信的真实供货时不造兼容范围、组件绑定或制品SHA。`PreviewPack`和`CatalogSnapshot.previewPacks`只展示未解析组件、原来源和薄包，不接plan/task/install；Client“上游整合包”区没有一键安装，`tests/supply/preview-pack-gate.test.ts`验证这条边界。

## 8. 管理业务记录与恢复：最重要的不变式

### 8.1 文件与完整凭证

管理记录路径为数据目录下`state/management/<SHA256(environmentId + ':' + idempotencyKey)>.json`。schemaVersion仍为1，扩展可选completion，不另建后台任务或恢复表。

completion含完整PluginActionResult、维护事实`{status:'saved',revision}`或`{status:'not-required'}`，以及绑定原fingerprint/outcome/receipt/result/maintenance的SHA-256摘要。摘要是记录完整性校验，不是第三方签名或跨系统原子事务。

执行顺序：原请求dispatch事实→原官方回执→后置状态核实→维护意图提交→完整业务凭证耐久保存。卸载preflight、维护与最终凭证保存均在既有execution锁内。

### 8.2 stage、receipt、result要分开

| 返回/记录 | 含义 | Client可否解除原未知保护 |
| --- | --- | --- |
| not-found | 未找到原记录，不能证明没写入 | 否 |
| dispatched/unknown | 官方调用中或后置状态未能证明 | 否 |
| settled但无completion | 官方阶段可能完成，旧记录缺业务完成证据 | 否，业务result仍unknown |
| 官方receipt applied | 仅官方动作回执 | 否，不能推定维护保存成功 |
| 完整result applied/restart-required/可信failed | 后端保存的原完整业务结果 | 原指针安全清除且原Promise已结束后才允许新管理写 |
| 存储clear失败/损坏 | Client不能安全解除原身份 | 否，不删除记录假装修好 |

`management/maintenance-save-failed`和`management/business-result-save-failed`必须是unknown，并保留真实changed和permissionChanges。失败但changed=true不等于无写入；unknownSharedImpact不能形成可信completion。

同key同完整请求已有completion：直接返回历史结果，不重新读当前库存猜结果，不再维护提交或官方写。同key异内容：拒绝。查询API严格只读；旧记录补业务只有原调用方明确重入原管理写API且当前原目标状态仍可证明时才可能进行，不能藏进“核对原操作”。

### 8.3 Client最小指针

`management-pointer.ts`按environment保存`packageName/expectedVersion/action/idempotencyKey`，不存凭据、库存或结果。`management-request.ts`负责发出前失败/可能已提交区分、20秒展示超时、只读recheck、换环境/迟到回包保护。

导航、重挂、重连及重开只读恢复；unknown/旧缺证据/无能力/存储不可用均保留保护。重查找到了完整结果但原Promise还pending时，指针可以安全清除，写锁仍须等原Promise结束。这一分支已专门覆盖。

重点测试：`tests/host/management-business.test.ts`、`management-outcome.test.ts`、`tests/client/management-request.test.ts`、`management-recovery.test.tsx`；开发时先跑这些，再跑全量。

## 9. Agent Forge media与作者工具

- `catalog/agent-forge-media.ts`以完整package为权威读取icon/previews/alt/theme。index预览不能覆盖完整记录。媒体去重、顺序、边界、非法地址与去敏通过规范化/DTO保留到前端。
- media是可选字段，缺失时保留原文字fallback；不为了视觉测试生成假的上游图标或兼容证明。
- Client的`media.tsx`与`mediaStyles.ts`负责load/error、显式重试、新URL/旧事件隔离、预览展开与放大；后端不维护图片加载中间态。
- 作者模块errors/drafts/readme/media/package修复错误去敏、有效页面刷新、dirty正文与revision保护、独立ZIP、本地读取/网络README门禁及正文字节限制。
- AuthorWorkspace可见性与remote代次控制必须保留：导航返回刷新列表不覆盖未保存编辑，旧请求不能写新环境状态。
- mvp.18合并冲突已保持新的全宽详情带头和CatalogMediaIcon，MarketFrame保留documentHidden类及MEDIA_CSS；不要再次拿一边覆盖另一边。

重点测试：catalog/core-api/client各media用例、`tests/client/author-refresh.test.tsx`、`tests/authoring/error-redaction.test.ts`、`readme-transport.test.ts`。

## 10. 验证记录、可信程度与当前交付门禁

### 10.1 合并前管理候选——历史通过，不是新字节证明

Core0.1.6 / Adapter mvp.17：完整1866 passed / 0 failed / 2既有skipped；browser49/49；后端focused92/0，管理Client39/0，build/测试tsc/lint/包边界通过。

官方rc.2隔离Profile：`D:/eac-market-verify/desktop-management-business-20261005-b3`。Core95/95、Adapter96/96安装字节与当时tgz及lib一致。API管理4组、冷启动只读3组、实际UI管理3组最终核实通过；实际卸载超过展示超时后保留原key，经手动只读核对恢复，无写入重放。

14:12北京时间Browser.close后code0退出/精确userdata进程清零，再冷启动通过。跨重开Client指针由脚本种入并明确faultInjectedPointer，不能当自然断线cold-start通过；后一次退出发起者未知和截图未生成也已保留。

### 10.2 合并后mvp.18交付复验

2026-10-05合并`e880a88`后，主控串行执行并核对了以下结果。本机证据在`.verify/github-delivery-20261005/`，不随Git提交：

| 验证项 | 实际命令与结果 |
| --- | --- |
| 构建 | `node scripts/build.mjs`通过，生成分离Core、Adapter Host/Client及Typert产物；`build.log`保存输出 |
| 新验收工具离线测试 | `node node_modules/vitest/vitest.mjs run tests/adapter/desktop-acceptance-tools.test.ts --no-file-parallelism`，9/9通过；`tools-focused.log` |
| 额外Client类型检查 | `node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --noEmit --pretty false`，exit 0；不把没有诊断输出当作未执行 |
| lint和包边界 | `node scripts/lint.mjs`、`node scripts/verify-package.mjs`通过；包检查96文件、41个Remote descriptor，两个包及浏览器安全边界通过；`lint.log`、`package.log` |
| 全量 | `node node_modules/vitest/vitest.mjs run --no-file-parallelism --reporter=json --outputFile=.verify/github-delivery-20261005/full.json`；`success=true`，1877 passed / 0 failed / 2既有pending，failed suites=0，总计1879；`full.json`、`full.log` |
| 合成浏览器 | 设置`EAC_BROWSER_CHECK_OUT`到本批独立`browser`目录后运行`node tests/client/browser-check.mjs`，55/55通过；`browser/browser-results.json`明确标记synthetic，不是官方Desktop |
| 独立布局审计 | 支持`EAC_LAYOUT_AUDIT_OUT`，默认时间戳目录，测试会话精确阻断已定位注入脚本；本次执行被主人中断，**没有完整findings.json，不签通过**。之后检查未发现该审计的遗留node/Edge进程 |
| 合并后官方候选 | **尚未重新打包安装验收mvp.18新字节**；没有新SHA、安装字节、实机业务或正常退出结果。此前mvp.17的191文件、4/3/3分组绝不移用于mvp.18 |

主人随后将当前收尾限定为提交与推送。下一位开发者先保留上述验收边界，再按第11节新隔离批次复验，不应为补文档重跑旧写探针。全量输出中的既有CJS `import.meta`警告保留，未降低断言或跳过失败。

### 10.3 已处理的测试环境问题

并发全量曾出现计时/子进程/浏览器启动失败，串行也有beforeAll失败。不要只看0断言失败而忽略suite失败和几十项pending。

实际DOM/Network诊断确认隔离Edge被注入`http://me.kis.v2.scr.kaspersky-labs.com/*`脚本阻塞，ready=loading、body为空、fixture未定义。只在测试CDP会话阻断该精确URL，未改产品SSRF、媒体地址、安全软件或系统网络；未增加sleep、跳过测试或降低阈值。

update-check-scheduler已有计时波动；历史宽回归2项失败与隔离24/0都保留，最终整体需success=true。既有CJS import.meta警告不能用作降低验证标准的理由。

### 10.4 什么不会随Git交付

`.verify/management-business-20261005/`、`.verify/github-delivery-20261005/`、本机D盘Profile/Registry/日志/截图等是本机证据，不在Git。拿到仓库的新开发者只能取得已提交实录和脚本，不能假设这些目录存在。

需要复查原始证据时向原执行者申请**脱敏导出**；不要要求上传全Profile或原始官方日志。当前实录引用文件名只是本机定位，不是公开下载地址。没有原始材料时应重新跑安全的离线/只读测试；不能盲目重跑带写入的官方探针。

### 10.5 第二次合并mvp.19：本次交付的最新门禁

远端五提交为`f6aef9f`、`ad53f2e`、`e011b8b`、`2fc644c`、`4f9a627`；增加日志/宽松策略、供货/previewPacks、后续全表面UI和panel锚定。主控与独占Client子智能体整合，另一个只读子智能体复查业务语义，不并行构建或官方操作。本机输出为`.verify/github-delivery-20261005/upstream-mvp19/`，不覆盖10.2的mvp.18证据。

build、额外Client tsc、lint、包边界通过；包检查96文件、42 descriptor。合并focused81/81通过；首轮全量1905 passed / 1 failed / 2pending、success=false，失败为装后重复目标用例仍期待旧unknown语义。按已决定的宽松策略改为核实官方applied、日志明确目标未知、零纠正写及同request零重放，未删测试、未改写前阻断；修正focused35/35通过。最终串行全量`full-corrected.json`：success=true、1906 passed / 0 failed / 2既有pending、failed suites=0，总计1908；合成browser60/60，结果在`browser/browser-results.json`。首轮失败保留，不用上游自述或10.2数字代替。

本次实际命令仍为第10.2节的build、tsc、lint、verify-package与串行Vitest；Vitest的outputFile改为`.verify/github-delivery-20261005/upstream-mvp19/full-corrected.json`，browser的`EAC_BROWSER_CHECK_OUT`改为本批`upstream-mvp19/browser`。只有代码/测试合并后的这些输出属于最新检出，不包括独立layout-audit或官方载体。

新mvp.19官方制品、实际安装字节、独立layout-audit、晚到安装回执追账、其余真实功能矩阵仍待验；没有公开发布或日常Profile动作。推送成功应由提交后的`ls-remote`与本地HEAD相等证明，本文不是远端ref证明。

## 11. 官方Desktop新批次的操作规程

先读`tools/desktop-acceptance/README.md`。以下都是已获准隔离实验的模板，不能用于日常Profile，也不能执行同一写探针第二次。

1. 冻结产品源码，串行build/测试/包边界通过；选择全新的仓库外Registry输出目录和Desktop批次名。
2. `registry.mjs`准备不可变Core/Adapter、Zod/SemVer及本工程noop的普通文件tgz，loopback端口实际随机。不要覆盖已做过验收的包目录；重开用`--serve-existing`且核对摘要。
3. `session.mjs`启动官方exe，DSH_HOME/userdata/store全部在新批次，webserver只绑定loopback；保存session.json实际官方version/build/pid/port。
4. 仅在该隔离Profile按实际Registry端口准备`@dsh-eac:registry=...`，通过官方Plugins/Add plugin/Custom Registry安装，最后Enable now。不能直接写插件文件、改asar或关闭blockExoticSubdeps。
5. 设置`window.__marketAcceptanceRegistry`为实际loopbackURL，并从registry.json取当前精确版本设置`window.__marketAcceptanceAdapterVersion`。installer默认仍是历史mvp.17，忘记设置会请求错误版本；noop另用`__marketAcceptanceNoopInstall=true`。
6. CDP可能有welcome和app两个target；操作`dsh-app://app/`主页面，不随意关闭welcome导致目标丢失，不进行模型登录或发送消息。
7. 本工程noop是唯一默认获准管理写样本。先核实版本、installed、enabled和原key not-found，再每动作独立key；任何unknown/非终态停止后续新动作，只读查原身份。探针原请求必须保存，即使工具自身超时。
8. 新管理业务探针只针对新记录；旧`management-recovery-checks-20261005.js`期待旧业务unknown，是历史证据工具，不用于验证新completion通过。
9. Runtime.evaluate返回对象的status/summary也要检查，工具exit0不等于业务通过。快照generatedAt是每次生成时间，比较业务事实不能把它当耐久revision变化；也不能泛化为忽略其它字段。
10. 安装后比对tgz、当前lib与实际Profile里的全部包文件，保存SHA、版本和主进程身份。一个页面显示版本号不能证明实际装了新字节。
11. 正常退出请求、CDP断连、窗口隐藏与真实进程清零分别记录。原实例未清零不得resume；受控终止只能结束实验，不能签正常退出通过。
12. 清理只操作已核实归属该批次的PID/userdata/Registry；保留制品、Profile、草稿和失败。仅凭eac名称前缀或旧PID不足以判断当前进程owner。

```powershell
node tools/desktop-acceptance/registry.mjs D:/eac-market-verify/packages-handoff-new-batch
node tools/desktop-acceptance/session.mjs D:/eac-market-verify/desktop-handoff-new-batch --loopback
node tools/desktop-acceptance/cdp.mjs D:/eac-market-verify/desktop-handoff-new-batch list
# 使用实际app target、实际Registry端口与当前精确Adapter版本；不要复制旧tgz URL。
node tools/desktop-acceptance/cdp.mjs D:/eac-market-verify/desktop-handoff-new-batch eval '@tools/desktop-acceptance/install-registry.js' ACTUAL_APP_TARGET
```

Windows路径限制是这些验收脚本的已知前置，不代表产品目录必须是D盘；官方exe默认`G:/Deepseek Harness Desktop/DeepSeek Harness.exe`，使用前先核实真实安装，不下载来历未知载体。

## 12. 已定位阻断及接下来的具体工作

### 12.1 第一优先：真实目录体积与可安装身份（RW-11/14/15）

最后已有只读审计时间为2026-10-05 13:41～13:42北京时间；八次小文档请求HTTP200，普通HTTPS与原Core safeFetch摘要一致。公开revision=`20261004T180213Z`，main=`ef33ea9e2baa240f72bb8c5d12471919edc59696`，packages=`3022bd1b898093d8aa90f76ebe0989b517195aa2`。这是历史观测，新执行前须复核。

- 六份公开完整记录声明26张preview，四个图片URL实际读取成功；没有官方媒体UI正向验收。
- dsh/plugin index实际18,375,959字节，原产品reader上限8,388,608，实际delivery/too-large。小manifest/source可访问不代表全源刷新通过；也不能再说“公网全部blocked”。
- 样本无明确icon/theme、可信dsh范围、版本/历史映射与可核验制品身份。目录unversioned不能从作者仓tag擅自变成可安装package版本；两份ZIP未取得实际摘要，不试装未知文件。
- 来源建议enabled=false，未应用Profile。辅助审计脚本有自己的诊断预算，不是授权提高产品读取门禁。

实施步骤：

1. 使用有界只读探针复核当前manifest/source/index门禁，保存时间、revision、声明大小与真实拒绝码；不反复全量超限下载。
2. 把体积与缺字段证据交给上游source owner，取得真实发布、固定revision、符合门禁的源/分片和完整package；本仓不改外部仓，也不自造本地子集冒充发布源。
3. 若要改变产品预算，另开有明确内存/超时/总量/校验/回退评审的任务，先获批准；不能仅把maxBytes改大来清除blocked。
4. 复验source/index/package SHA及来源身份，保留历史覆盖/撤回/冲突。合法可安装artifact取得真实字节、摘要、包name/version/许可后才进入官方实验。
5. 新隔离Profile跑真实media传递与HTTPS load/error/retry/放大/theme；没有icon声明不造图标。有preview不等于完整媒体矩阵通过。
6. 同批用明确DSH semver范围和可核验制品跑版本列表→默认适配→手选/降级确认→预检绑定→下载摘要→官方安装→原task只读恢复。

验收：可信数据、Core门禁、实际写入与可恢复原结果一致；HTTP200、源码ZIP或单次安装成功均不能替代完整链路。

### 12.2 第二优先：退出归因与原载体（RW-08）

历史媒体批次正常退出超时/四进程残留仍未定位；管理批次一次正常退出通过不构成修复证明。

建立独立对照组：官方纯基线、市场启用空闲、仅refresh、作者/media、管理/task。分别记录请求、断连、窗口、主/子PID清零时间及允许导出的日志。若市场挂资源/Promise，在本工程修复；若官方policy/backend/platformView退出等待，写宿主owner交接，不改官方源码。

可信rc.1载体仍待取得/确认；实际rc.2可独立报结果，不能写成rc.1已验。禁止任意sleep、全进程名称kill或强制终止冒充正常退出。

### 12.3 第三优先：完整功能矩阵（RW-09/10）

按当前Remote和产品矩阵逐行更新，不照抄旧39/41计数当覆盖率。补真实升级/降级、多依赖/套餐、脚本审批、partial/取消、重启/任务恢复、维护/更新、皮肤loader和切换、作者ZIP/README/media。

真实键盘焦点、读屏、forced-colors、明暗、120%/150%/175%/200%缩放/DPI和图片布局分别验。浏览器模拟不代替官方实际UI；AI正向需模型/费用许可，未授权拒绝只是负向，不是正向完成。

### 12.4 最后：正式发行（RW-07/12）

主人本次授权有效源码、handoff和修改记录提交并推送GitHub当前分支；没有授权npm发布、新tag/Release、修改组织仓或日常Profile。

获准发行后：决定新版本号与Core/Adapter范围→独立冻结新字节与SHA→核实公开Core实际可取及Adapter正确依赖→官方全新安装与mvp.9升级/失败回退→验证远端ref/制品→更新唯一普通用户安装入口。不要覆盖已有mvp.18/Core0.1.6公开包来偷换修复版本。

## 13. 回退、未知结果与禁止操作

- Git代码回退不等于Profile数据回退。任务摘要schema3可读旧schema1/2；旧程序不理解schema3，不能直接降回旧代码继续写。先停止执行器、备份，再按获准步骤验证。
- 新management completion为可选字段，不批量迁移旧记录；旧unknown保留，不补成功、不删屏障。核心范围历史缺失不能自动补兼容。
- 不清空catalog接受历史或来源撤回事实来接受旧目录；不把artifactDigest变化当作同一制品。
- 不修改官方源码/asar、用户配置、用户文件、外部仓、VPN/DNS/hosts，不削弱SSRF/摘要/幂等/权限/供应链限制。
- `tools/review-probes`只用于错误复现，reproduced不是产品通过，不加入正常CI期待错误行为。
- 不git reset/clean/stash未知内容，不force push覆盖他人。发现远端前进时复核并正常合并/验证。

## 14. 推荐下一位开发者第一轮交付

1. 完成第1/3节环境与Git核对，用新证据目录重跑相关focused和全量，记录真正的success及suite/pending；不要先启动重复写探针。
2. 先执行12.1的有界来源审计，确定阻断属于上游数据、门禁预算还是网络，不盲目安装或扩大范围。
3. 将可独立开展的退出对照与剩余功能矩阵分给互不重叠owner，公共协议与官方Profile始终由主控串行控制。
4. 每个改动包含根因、最小修复、focused→广回归→真实UI/宿主证据；外部blocked注明owner/需要的输入，不能混成“实现失败”或“全通过”。
5. 更新START-HERE、当前账本、升级指南及本轮实录；提交逻辑分开，排除缓存/日志/Profile/制品；推送后实际查询GitHub分支SHA，不凭瞬时命令输出签交付。

下一轮默认不是发布，不是修官方源码，不是重新从v1规划建市场。先把可信数据与实际长链路打通，保留已验证的原意图恢复和Core/Client边界。
