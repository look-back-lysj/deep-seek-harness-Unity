# EAC 市场当前接手入口

更新时间：2026-10-05（Asia/Shanghai）。**所有新协作者先读本文，再开始改代码。** 本文是当前接手入口；归档中的旧阶段报告和旧计划只能追溯。

**当前开发交接与修改记录：**[详细开发者交接](DEVELOPER-HANDOFF-2026-10-05.md)、[逐模块修改记录](MODIFICATION-RECORD-2026-10-05.md)。已正常合并GitHub上游mvp.18，保留两边功能；合并后build、额外Client tsc、lint、包边界及全量1877 passed / 0 failed / 2既有pending、合成browser55/55通过。独立布局审计被中断，合并后新官方制品尚未打包安装验收，不能引用下面mvp.17批次证明mvp.18字节通过。本次提交/推送只交付当前分支源码、工具和文档，不是npm、tag/Release或日常Profile安装。

**下一阶段详细实现计划：**[问题分类、实现步骤与验收门禁](NEXT-IMPLEMENTATION-PLAN-2026-10-05.md)。RW-13的Core/Client实现及本批rc.2管理范围已经执行，后续优先处理真实媒体源体积、版本/制品映射与安装长链路；退出问题单独归因，正式发布需授权。各阶段状态与历史计划分开记录。

**最新管理闭环批次：**[后端修复、并行Client与官方验收实录](MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md)。既有管理记录保存完整业务结果与维护凭证，维护和凭证提交纳入execution锁；恢复只读，新记录返回原完整结果，旧缺证据仍unknown。Client保存原environment/目标/版本/action/key，超时不重写；后端不提供UI中间态。最终完整1866 passed / 0 failed / 2既有skipped、通用browser49/49，build/测试tsc/lint/包边界通过。新官方rc.2隔离候选Core95/95、Adapter96/96字节一致；API管理4组、冷启动只读3组及实际Client管理3组最终核实通过，真实卸载展示超时后手动只读核对恢复且零重放。本批一次正常退出code0/精确进程清零通过，不抹去上批退出失败。跨重开Client指针使用明确标记的fault injection，不当作自然断线cold-start验收。真实来源6记录/26预览已核实，但18,375,959字节索引超8MiB，版本/核心范围/制品映射仍缺；未激活来源、未发布。

**当前执行清单：**[剩余任务与执行账本](REMAINING-WORK-2026-10-04.md)。RW-01～RW-06 第一批补齐版本选择上下文、写前复验、原操作只读恢复、Client默认适配选择和TaskCard在途锁；该批完整1598/0/2 skipped及[版本上下文实机报告](OFFICIAL-DESKTOP-RELEASE-CONTEXT-2026-10-04.md)作为历史证据保留。RW-13最新范围见管理实录；默认适配升级、真实任务恢复、正式渠道、原指定载体、媒体正向和其余矩阵仍待验，不自动发布。

**最新媒体批次与网络结论：**[media实施实录](AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md)。Core/API已经提供图标、完整预览、alt和theme；Client负责加载、失败、重试、放大和展开。完整1796 passed / 0 failed / 2 skipped，media专项198/0，通用浏览器49/49；新隔离官方rc.2的Core94/94、Adapter92/92安装字节一致。目录刷新与README读取初装/重开各一次真实通过，不能继续把公网全部写成blocked；raw GitHub DNS仍不稳定。正常退出首次超时，仅本轮精确进程终止后重开成功，不冒充正常退出验收；重开UI8/0/1 blocked、两阶段API各11/0/9 unknown。默认61插件/21listing无media，官方公网媒体正向仍待验；发布、原指定rc.1、升级/降级和完整管理恢复未通过。此前181文件/正常退出/原回执证据只归上一批[版本上下文实机报告](OFFICIAL-DESKTOP-RELEASE-CONTEXT-2026-10-04.md)，不移用于本媒体批次。

**最新已确认需求：**dsh 核心范围对照官方 getDshRuntimeVersion() 返回的运行时版本，不用 Desktop 发行号；前端负责默认选择和交互中间态，后端保存真实写入/回执事实。[实施方案](HOST-CORE-COMPATIBILITY-PLAN-2026-10-03.md)、[数据审计](HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md)和[第三批 API 实现](HOST-CORE-API-IMPLEMENTATION-2026-10-03.md)为设计与此前实施证据，旧测试数字不再作最新结论。releaseContext、原操作查询 API、版本选择本批已接线；管理完整业务恢复及新版官方验收依当前账本继续。未提交或发布。

## 当前事实

- 本轮工作区：`G:/Code/fork/agent-market`；协作者使用自己的检出路径，历史 `D:/eac-market` 不是运行时默认目录。
- 当前协作分支：`refactor/market-core-adapter`
- 桌面适配器源码候选：`@dsh-eac/market@0.1.0-mvp.18`；上游`releases/0.1.0-mvp.18-dual/`是合并前预备制品，不能覆盖，也不能当成本轮修复的安装字节。
- Core 源码候选：`@dsh-eac/market-core@0.1.6`；Provider Core API `1.1.0`、Remote `2.1.0`；Client 最低要求仍为 Core API `1.0.0` / Remote `2.0.0`，新增能力单独探测。
- 当前正式可安装版：`0.1.0-mvp.9` 单包
- 当前 Client 已完成：发现页、全部插件目录、详情、导航返回快照、筛选、任务/皮肤/作者工具交互收口和兼容 fallback。
- 当前真实宿主仍待验：公网 Core 来源、官方 Desktop 全新安装/升级、读屏、forced-colors、120%–200% 缩放、真实网络图片和官方插件管理器长链路。
- 原指定验收载体为官方DeepSeek Harness Desktop `0.2.0-rc.1` Windows x64，仍待可信载体；已有实机批次实际为官方`0.2.0-rc.2`，仅按该版本及当批字节记录。AIO/Lite/合成浏览器不算官方通过。

源码候选不等于正式发行版。不要把协作分支、workspace 包名或本地 `.tgz` 写成用户下载地址。

## 必读顺序

1. [近期改动与协作总结](COLLABORATION-SUMMARY-2026-10-03.md)：2026-09-28 至 2026-10-03 的改动、问题根因、发行状态和交接优先级。
2. [最新版升级指南](../UPGRADE-GUIDE.md)：当前版本、构建、发布、回退和证据规则。
3. [Core / Desktop Adapter 底座指南](../CORE-ADAPTER-GUIDE.md)：两包职责、公开 API、协议和所有权边界。
4. [后端协作者指南](BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)：Core、Host、目录、适配器的可执行接入规则。
5. [Client 维护边界](../../packages/market/src/client/README.md)：前端只能消费现有 Remote，不重复实现业务规则。
6. [当前交互审查](INTERACTION-AUDIT-2026-09-30.md)：已完成的交互收口、统一动作状态和未验宿主边界。
7. [UI 重构合同](UI-REBUILD-CONTRACT-2026-09-30.md)：发现页、全部插件、动效、兼容性和不变边界。
8. [协作约定](NEXT-AGENT-PLAYBOOK.md)：文件 owner、合同先行、验证串行和交接格式。

## 安装策略（2026-10-02 本轮调整）

用户已明确要求安装宽松程度对齐 DeepSeek Harness 原生插件管理器：无关旧插件异常不能频繁阻断新手安装，插件安装后能否正常运行由上游插件负责；市场仍必须保证目标包安装正确、来源/摘要/版本可核实，不能伪造成功。

本轮代码边界：

- 无关 `inventory.unknownItems` 只作为库存提示，不再让 `MarketRuntime.planCreate` 全局返回 `inventory:unverified-state`。
- 真正的写入屏障仍然保留：活动安装请求、官方 package run 记录、目标包自身身份/版本未知、目标包来源或摘要变化仍会阻止对应安装。
- `InstallTaskManager` 只对本次目标做安装前/后核对；与目标无关的旧皮肤状态不会把任务标成失败或未知。目标自身核对失败仍按 `unknown/needs-attention` 处理，不自动重放。
- 启用、停用、卸载同样核对目标与真实写入，不要求无关插件全部健康。目标异常分类、写后结果与回执恢复仍有待修复项，见最新实施方案；不能把策略调整当完整实机验收。
- 安装后只验证目标包是否安装到确认版本；插件启动失败或功能不可用属于上游运行问题，不伪装成市场安装成功/失败。
- 市场不再为 `unverified`、`unknown` 或 `hard-incompatible` 增加额外的“试装勾选”门槛；这些状态只提示，兼容性由官方安装器和上游插件负责。
- 官方 pluginManager 仍是唯一写入者；不删除旧插件、不授予兼容性批准、不关闭官方保护。

当前验证：`pnpm check` 已通过（75 个测试文件、749 项通过、2 项跳过），新增无关库存不确定性和目标自身未知状态的安装回归均通过；真实官方 Desktop 的“旧皮肤异常存在时安装无关插件”仍待重新实机验收。

## 当前工作边界

G0 尚未冻结的公开接口取舍与安全边界见 [接口冻结提案（待用户确认）](G0-INTERFACE-DECISION-PROPOSAL-2026-10-02.md)。它是讨论稿，不是已实施合同。

2026-10-01 已确定后端接口方案 A、轻量传输组合一；以 [Core 新增能力补齐计划 v1.2](CORE-NEW-CAPABILITIES-PLAN-2026-10-01.md) 为后端边界。2026-10-02 用户要求主控与后端协作者并行推进，主控负责 Client，后端协作者负责 Core/DSH 生命周期；不能因此绕过 G0 冻结新增公共合同。

### 2026-10-02 当前对接进度（进行中，不是最终验收）

- 工作区：`D:/eac-market`；分支 `refactor/market-core-adapter`；基线 HEAD `d9190bf8d7c09dce4c026a2d47f508ef8c9fc3ff`。本轮修改尚未提交/推送。10 月 2 日本轮已重新执行 `git ls-remote`：GitHub/Gitee 的此分支仍在该 HEAD，GitHub `dev` 仍在 `f50fb5a`；未覆盖当前 Client 或合并旧分支。
- 现有 Client 接口：新增穷举回归对照 37 个 `MarketRemote` 方法与实际 `@Remote` 的别名、参数类型/可选性和返回类型。`deleteDraft → authorDraftDelete` 已补映射；只读 `checkUpdates` 不走写握手，先刷新来源时仍受握手保护。此为静态/单元证据，不代表每个方法已在真实 Desktop 上调用验收。
- 设置页面：已消费来源、按已登记 sourceId 刷新、维护快照、手动版本比较及 expectedRevision 策略保存。能用但尚未检查的接口不再误标为“不支持”；旧策略如果自动下载/安装为开启，UI 如实显示，用户保存才将其关闭，不会在读取时静默修改。未开放查询调度状态，UI 不据此推定后台检查已执行。
- 任务历史分页：后端已修复“nextSequence 指向全历史末端”缺陷。真实事件日志 205 条跨三页与 TaskManager 的 205 条日志+5 条摘要合并测试无重复无缺项；前端首次 `afterSequence=-1`，后续跟已返回页末边界，兼容旧 Host 的全历史末端游标。旧 Host 缺方法、截断、读取失败均明确降级，实时摘要仍可见。之前合成夹具中同序列消息不一致的问题已单独修复，未当作真实后端失败证据。
- 自动检查调度：已在 Market Runtime 所属 Cordis Fiber 生命周期接线；只读检查，不创建安装计划/下载/安装。新增 24 项调度测试覆盖 stop/refresh 等待中的竞态、退出零残留 timer、失败按周期退避、损坏记录保留不覆盖、磁盘写失败与重启恢复。最近/下次时间仍未公开给前端。
- 当前集成检查：`pnpm check` 通过，72 个测试文件通过、1 个固定协议文件跳过；675 项通过、2 项跳过；生成 Remote 描述 37 项。完整合成 browser-check 42 项通过，证据 `D:/eac-market-verify/market-client-20261002/integration-cursor-and-scheduler-20261002-1536/browser-results.json`；不得把合成 Edge 说成官方 Desktop。
- 官方基础验证：官方 `0.2.0-rc.1` 的 peer 准入函数通过；已用官方 CLI、本地测试源、独立 DSH_HOME、空缓存安装当前双包，Core 和 zod 从本地测试源取得，结果在 `D:/eac-market-verify/market-client-20261002/official-empty-store-20261002-1536/result.json`。CLI/本地源 PASS 不等于公网发行链、官方 Desktop UI 加载或新功能实机验收；记录的 peer 警告和测试源缺 time 字段警告保留，不隐藏。
- 剩余完整目标：后台检查状态公开查询、离线独立上传/预检/计划消费、Bundle 选择凭证/冻结计划、成员/依赖取消保护与影响预览/再次确认仍需新增合同和实现。G0 提案尚未被用户选择/冻结，不据默认推荐替用户确认；官方 Desktop 0.2.0-rc.1、真实模型/网络/代理、读屏/缩放/forced-colors/真实安装长链路仍待逐项验收。
- 下一步：先取得用户对 G0 取舍的确认，再主控串行冻结完整 DTO/能力/错误/身份/过期/重启合同，后端 owner 实现 Core/Adapter，主控补 Client。整合后跑新的完整验证批次；不把初期整任务取消当作最终成员级取消已完成，也不擅自发行或上传。

### 2026-10-02 用户授权官方 Desktop 本机试用安装

- 用户明确要求安装到自己已安装的官方版并在最终安装前再次回复“确认”；此次授权仅用于市场试用安装，不等于后续 G0 公共合同、发布或全量验收确认。
- 官方程序为 `DeepSeek Harness 0.2.0-rc.1`。通过 Electron 官方插件管理器的“添加插件”安装 `@dsh-eac/market@0.1.0-mvp.10`（原为 mvp.8），Core `0.1.0` 随依赖安装。遵循官方 desktop Profile 由 Electron 管理的限制，未绕过 CLI guard 或改官方源码。
- 本机包放 `D:/eac-market-user-trial/20261002-161111/packages/`；只在独立 staging 把 adapter 的 Core 依赖固定到此目录的本地 tgz，原仓库包配置未改。本机试用包不可当作公网发行包，试用期间保留 packages 目录。
- 安装器回执“已安装”；立即启用后热更界面一度显示协议不兼容。通过官方“应用→退出”正常关闭并重新打开后，EAC 新版首页正常显示“发现适合你的插件”、皮肤中心和规则发现。此是安装+首页读取/加载冒烟通过，不是设置写入、全部 37 方法或第三方安装链完整验收。
- 安装后的市场和 Core 版本已核对；其他六个插件的安装引用、插件启用选择均未变，`cordis.yml`、`cordis.patch.yml`、`pnpm-workspace.yaml` 与备份 SHA256 一致。未读取/改动模型凭据或会话内容。旧皮肤相关异常安装前已存在，此次未处理。
- 回退备份 `D:/eac-market-user-trial/20261002-161111/backup/`；安装记录 `D:/eac-market-user-trial/20261002-161111/installation-status.json`。用户正在试用，停止自动点击；原开发目标的 G0 取舍依旧未确认。

### 2026-10-02 官方 Desktop 试用反馈（旧版已复现；源码修复通过，新包实机待验）

- 用户反馈首页推荐/大海报缺失，插件预检统一显示“暂不能安装”且风险提示密集；不能继续把“首页可加载”解释为市场可完整使用。
- 在同一官方 Desktop 0.2.0-rc.1 实机复现：首页只有皮肤中心入口和规则发现，没有团队精选海报；功能目录显示 47 条，皮肤入口显示 13 款。Client 读取目录不裁掉 discovery 字段，但 featured 为空时直接隐藏首推区。
- 对 `dsh-better-sidebar` 只打开安装预检（未勾未验证授权、未点击确认安装），Host 实际返回 `blocked`，原因“当前库存或安装活动无法完整核实，请稍后重新预检”，详情 `inventory:unverified-state`。这是库存/安装活动完整性阻断，不能误写为仅因插件未验证而不能安装，也不能建议勾选风险绕过。
- 目录中的黄色“未验证”标签与预检里的试装授权是另一类状态；真实缺包、已阻止和未验证必须分别解释，禁止批量改为 verified 或清空保护来制造可安装。
- 已装随包目录和三份缓存目录均无推荐记录、推荐海报或插件截图；已装 Core 投影的 featured/recommendedSkins 均为空。原始随包目录 61 条：29 条标记可安装、22 条硬阻断、8 条缺 bundle、2 条缺制品；这不是实机安装通过数。47 条功能与 13 条皮肤之外的 1 条为皮肤管理器，Client 明确从普通功能目录排除并交皮肤中心处理。
- 已查到具体可触发全局库存阻断的代码链：官方 pluginManager 对不兼容 bundle 的错误返回不含 version；市场 adapter 将已安装但缺 version 的记录加入 unknownItems，Host 因而阻断全局预检。本机四个旧皮肤/loader 包要求 DSH 0.1.7-rc.2，而宿主为 0.2.0-rc.1；这些异常早于本次安装。未取得当次 Remote 的具体 unknownItems/活动原因，不能断言这四包是唯一触发项，不能直接删包或批准旧版本兼容。
- 已关闭诊断预检并返回发现页；本轮未修改用户 Profile、插件安装、启用选择或安全授权。随后用户已选择本次方案 A，源码修复结果见下节；原 G0 接口方案仍未确认。

### 2026-10-02 用户选择 A：修复候选已重装（首页通过，实机预检仍阻断）

- 范围：Client 首页大海报/提示整理 + 市场对官方库存的最小适配，不改官方源码、用户插件和兼容批准；这次 A 不等于 G0 接口冻结方案授权。
- 源码候选递增为 market 0.1.0-mvp.11 / Core 0.1.1，避免重装同版本缓存；Core API 1.0.0 与 Remote 2.0.0 不变。已安装用户试用版仍为 mvp.10/Core 0.1.0，尚未覆盖。
- Client 实现了明确标记的目录探索海报、无图/破图降级、轮播暂停修复、中性未验证标签、真实安装环境阻断解释和安全库存原因投影；不编造团队推荐、评分或已验状态，不去除试装及最终确认。
- 适配器只恢复官方 0.2.0-rc.1 已知拒绝形状且被可信 Host 本地身份/版本/peer/依赖引用与运行模块证据重复核实的版本。旧包仍 source/localIdentity=unknown、不可移除、只读；证据读取仍用于保存真实库存事实，但无关库存不确定性和未知共享影响不再自动形成全局安装屏障；与目标相关的身份、来源、版本、活动写入或官方拒绝仍继续阻止。未清空 unknownItems。
- 主控串行 pnpm check 通过：74 个文件通过、1 个固定协议文件跳过；736 项通过、2 项跳过；包/浏览器安全边界和 37 个 Remote 描述通过。pnpm typecheck 通过。新增 Client 9 项回归，Client 全量 244 项通过；Adapter 定向 68 项通过，含真实隔离 Host + MarketRuntime.planCreate 的正反例。
- 全量合成 browser-check 48 项通过，证据 D:/eac-market-verify/market-client-20261002/trial-fix-full-20261002-1740/；亮/暗、480px/1280px 海报与环境提示已经批量截图检查，Impeccable detect 返回 []。这是合成结果，不是新包官方 Desktop 验收。
- 整合日志 D:/eac-market-verify/market-client-20261002/trial-fix-integration-20261002-1752/。首次整合发现 dsh-plugin.json 旧版号，已同步；另一个原有取消测试在高并行下遇到 2s 等待超时，未改生产代码或放宽断言，单独 33 项与随后完整检查均通过，首次失败现场保留在同日 1750 批次。CJS 合成 Host bundler 对 helper 的 import.meta 发出非致命 warning；真实声明的 ESM 构建/包检查通过，不据此宣称 CJS 身份恢复路径已验。
- 已准备新本机试用包 D:/eac-market-user-trial/20261002-175408-fixA/packages/：market 0.1.0-mvp.11 + Core 0.1.1；本机 adapter 仅将 Core 引用绑定至该目录，其他归档负载与正规 prepared 包逐字节一致。installation-status.json 状态 prepared-not-installed；未发布/推送、未覆盖真实 Profile，试用期间必须保留 packages 目录。
- 随后已按用户确认安装并实际测试，详见下节：覆盖/首页成功，但真实预检仍阻断；旧空缓存 CLI、合成浏览器或隔离 Host 正例不能代替这一实机结果。


### 2026-10-02 18:28 后用户确认覆盖：实际结果，不是全修复验收

- 用户在安装/正常重启确认问题后明确回复“好，帮我覆盖”。按此具体授权通过官方 Desktop 的插件页添加本机 mvp.11 tgz，官方回执“已安装”；未按“立即启用”做热替换，关闭回执后用“应用→退出”正常结束，确认窗口/进程退出再启动同一 com.deepseek.dsh。
- 已安装 market 0.1.0-mvp.11 / Core 0.1.1，Host/Client/Core 的四个主要已装 lib 与本轮构建字节一致；其他六个插件依赖引用、package 非 dependencies 内容、cordis.yml、cordis.patch.yml、pnpm-workspace.yaml 均保持安装前值。未读取/改动模型凭据、会话或兼容批准。
- 官方新版首页真实显示“插件探索”文字大海报（6 项轮播）、皮肤入口和中性未验证标签；无协议/加载错误。这证明覆盖、冷启动和首页读取成功，不证明真实精选/图片数据已补齐。
- **实机安装问题尚未解决**：同一 dsh-better-sidebar 只打开预检（不勾试装、不提交任务），仍返回 inventory:unverified-state，界面列出 @dsh-eac/skin-whale-song、@dsh-eac/ui-skin-loader、@dsh-eac/skin-deep-whale-day-night、@dsh-eac/skin-trading 已装版本待核实。适配器隔离测试通过不能替代此真实失败；禁止继续宣称全局阻断已解除。
- 尚未获得真实 Host 的具体 evidence-reader 异常原因；下一步先对照官方 0.2.0-rc.1 的真实拒绝字段、profile/installation 锚点、Loader 模块解析与证据读取失败分支，不直接清空 unknownItems、强设 stable、删除旧包或授予兼容批准。后续新包覆盖仍需安装时确认。
- 预检已关闭并返回发现页，停止自动点击，未执行任何第三方插件安装。备份 D:/eac-market-user-trial/20261002-175408-fixA/backup-before-overwrite/（92 文件，约 22.7MB）；本机包/状态/回退说明同批次目录。installation-status.json 为 installed-official-home-verified-preflight-still-blocked。原 G0 取舍和其余新增能力仍未完成。

### Client 协作者可以改

- `packages/market/src/client/**`
- 对应的 `tests/client/**`
- `DESIGN.md`、当前交互记录和交接说明

### 未经主控批准不得改

- `packages/market-core`
- Core contracts、安装计划和任务协议
- Host / DSH 适配器、官方 pluginManager 接线
- `package.json`、锁文件、正式发行入口
- 官方 DSH 源码、真实用户 profile、凭据和外部仓库资料

如果需求需要改公共合同，先在交接记录写清消费者、兼容策略、迁移和测试，再由主控串行处理。

## Client 当前状态合同

前端消费现有 `MarketRemote` 和 Core 返回值，不伪造后台状态：

| 后台事实 | Client 展示 |
| --- | --- |
| 目录刷新成功 | 已完成，并说明目录不会自动安装或更新 |
| 插件动作失败 | 失败原因 + 可执行重试 |
| 插件动作 `unknown` | 结果未知 + 先重新读取，不自动重放 |
| 插件动作 `restart-required` | 需要重新核对 + 重启 DSH 后再读 |
| 任务 `partial` | 部分完成 + 成功项保留 + 失败项下一步 |
| 任务 `awaiting-approval` / `awaiting-resume` | 显示授权或重启动作 |
| 皮肤切换结果未确认 | 重新读取状态，禁止重复切换 |
| 作者草稿版本冲突 | 保留本地编辑，不伪造已保存 |

动作生命周期实现位于 `packages/market/src/client/action-state.ts` 和 `action-feedback.tsx`，它们不改变 Remote 合同。

## 接手后的最小步骤

```powershell
git fetch --all --prune
git status --short --branch
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test -- tests/client
```

改动 Client 后至少运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test -- tests/client
node tests/client/browser-check.mjs
```

必要时再运行完整 `pnpm check`。合成 browser-check 不能替代真实官方 Desktop 验收；未做真实验收就必须标记 partial。

## 文档规则

- 版本、下载地址、当前分支和未验范围以本文与 [最新版升级指南](../UPGRADE-GUIDE.md) 为准。
- `docs/handoff/archive/2026-09-legacy/` 中的文件只保留历史证据，不是任务清单或操作入口。
- 不要复制旧报告里的旧版本号、旧 commit、旧路径或“已完成”结论到新文档。
- 新交接文档必须写：日期、分支、范围、不变边界、已验证证据、未验证项目和下一步。

当前 GitHub 和 Gitee 都有协作分支；同步前先 fetch，禁止强推覆盖他人提交。
