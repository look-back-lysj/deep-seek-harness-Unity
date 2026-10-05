# 宿主核心版本、包版本列表与前后端职责：实施方案

日期：2026-10-03。状态：**安全修复、范围评估、DSH运行时域绑定、只读版本 API/更新摘要及部分计划保护已实施；releaseContext、恢复查询及前端选择仍待完成，尚未产品验收。** 当前证据见[第三批API实现](HOST-CORE-API-IMPLEMENTATION-2026-10-03.md)，前两批为历史记录。下文保留原方案设计，不把计划当成已实现。

2026-10-04 后续状态：releaseContext、原操作只读查询 API、Client 版本选择和 TaskCard 代次已实现；最新源码与隔离浏览器结果以 [执行账本](REMAINING-WORK-2026-10-04.md) 为准。管理完整业务恢复及本批新制品官方验收仍待完成，本文原阶段状态/数字保留作历史设计证据。

业务审查基线：`9fc09a28b961e9cc857543b134fbc3e924e31b71`。本轮起点：`refactor/market-core-adapter` / `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。后者另有文档、任务记录 class/ARIA 和测试选择器调整，不把交接总结当验收证据。本轮工作区 `G:/Code/fork/agent-market` 不是运行时默认目录。

配套：[数据现状审计](HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md)、[合成验收数据](fixtures/host-core-compatibility-cases.v1.json)、[产品要求](../PRODUCT.md)、[协作规则](NEXT-AGENT-PLAYBOOK.md)、[接手入口](START-HERE.md)。

## 1. 本轮确定的决定

1. “核心”指目标 Agent 的宿主核心，例如 DSH 本身；market-core 包、Core API 和 Remote 协议版本均不是这个版本。
2. Adapter 提供可信 Agent 身份和核心版本，Core 按完整版本范围提供适配列表。
3. 分别保留已安装版本、当前目录中最新有效发行版、适配当前核心的最新版本。更高发行不适配，不阻止使用较旧适配版。
4. Client 在后端允许选择的列表中默认选中、保留用户选择和确认。后端不返回 defaultReleaseId，不决定弹窗阶段、按钮状态或轮询节奏。
5. 最新发行的完整范围明确证明核心过低时，Client 提示“〈Agent 名〉核心版本过旧”，附当前版本、要求范围及对应发行。过高、范围空洞、未知和冲突分别解释。
6. 后端只通过 API 提供业务能力与事实；实际写入、回执、部分成功、授权/重启要求、未知结果必须耐久保存。加载、提交等待、超时提示、轮询、展开和确认步骤属于前端。
7. 不增加静默安装，不重做双包，不新增常驻服务，不修改官方源码、真实 Profile、外部 Agent Forge schema 或组织仓。

“最新”只指已接受目录、当前 Agent 和所选通道中的最新有效发行；缓存要标时效，不能宣称公网全局最新。全部合成版本只是测试设计，不是正式插件要求。

## 2. 当前源码事实及前置修复

| 当前事实 | 位置 | 实施影响 |
| --- | --- | --- |
| hostVersion 与 coreVersion/coreApiVersion 已分开，尚无显式 Agent 核心快照 | `packages/market-core/src/contracts/types.ts:27`、`packages/market/src/index.ts:108` | 保留旧字段，新增字段明确命名；读取失败未知 |
| Agent Forge 接收 targets[].agentVersionRange，只校验字符串 | `packages/market-core/src/catalog/agent-forge.ts:157` | 补完整范围评估和语义绑定 |
| Agent Forge 投影不保留 targets 到 Plugin/Listing | `packages/market-core/src/catalog/agent-forge.ts:345` | 补私有投影，不改上游原字节/schema |
| CatalogPlugin 无宿主范围，UpdateCheckItem 只有一个 latestVersion | `packages/market-core/src/contracts/types.ts:94`、`packages/market-core/src/contracts/types.ts:293` | 列表与更新摘要增量扩展 |
| Client 以 verified、制品和来源选择所谓 latestCompatible | `packages/market/src/client/model.ts:337` | 不再以实测证据推断范围匹配 |
| 更新检查只看最高目录版，缺制品也归为 incompatible | `packages/market-core/src/core/update-check.ts:13` | 核心适配、制品、验证三个维度独立 |
| 精确 SemVer 工具没有 range 匹配 | `packages/market-core/src/core/semver.ts:5` | 不能拿排序/API 协商代替完整范围匹配 |

还须先修上一轮问题：官方成功后维护保存失败误报零变更；管理回执无法公开恢复查询；目标异常分类漏项；默认来源被空数组遮蔽；多源覆盖和合并 revision 截断。新列表不能掩盖这些问题。

### 2.1 本轮实际数据结论

- 嵌入目录有 61 条 plugins 和 21 条 listings；标准化核心范围覆盖 0/61。解码元数据有 18/61 条 engines.dsh 声明（29.51%），其中 14 条同时有相同的明确核心 peer；是可审核的范围来源，不是新增实测通过。
- 原始清点 82 条，62 个 lockEntry.compatibility 全为空对象；空对象不能解释成所有核心版本都支持。
- 外部 Agent Forge 五类 source/index 的 agentId 明确为 dsh；全量读取的 56,197 条索引 latest 记录都有 dsh target，但范围全为 unknown/null。58,505 个版本标签不是已经核验的历史发行。
- 当前 reader 只读 index.path 的 latest，不自动读取其它历史版本。要给出较旧适配版本，必须取得并校验该确切版本的元数据及制品绑定；不能从版本标签补造范围。
- 实际 mcp/plugin 索引超过 reader 默认 8 MiB 限制，本轮 JSON 计数不等于生产导入成功。超限来源另列采集缺口；不能简单放开全部大小上限，或用小 fixture 假称全来源支持。

因此先保留原始数据、提取可绑定声明并报告数据覆盖，再实现范围计算。范围未知仍未知；不能先推出一个把所有包都叫不适配的版本选择器。统计口径、读取位置和未验项以配套数据审计为准。

## 3. 数据整理规则

### 3.1 可信宿主快照

采用浏览器安全的 HostCoreSnapshot：

| 字段 | 定义 |
| --- | --- |
| agentId / agentName | Adapter 登记的稳定身份和展示名；生产映射核对数据审计，不能由路径/包名猜 |
| version: string 或 null | 宿主核心精确版本；未知不以 0.0.0 或 market-core 代替 |
| status: known / unknown | 取得情况；未知附安全 reason |
| hostRevision | 身份、核心版本及相关能力的稳定摘要；读取时间变化不产生新 revision |
| source | 可信读取机制标识，不泄漏 Profile 路径、凭据或原始对象 |

主人已确认 Forge agentId=dsh 对应 DSH runtime 域；新宿主快照从实际加载的官方 getDshRuntimeVersion() 读取。旧 hostVersion 保留原义，Desktop 发行号不参与范围计算；缺 getter/读取失败/非法版本仍 unknown，不依据 target 字符串或目录路径补造版本。

### 3.2 发行身份与范围来源

评估绑定 sourceId + sourceRevision + packageName + version + metadataDigest；有制品再绑定 artifactDigest，有正式 releaseId 则保留。Listing 不制造可执行 releaseId 或摘要。

范围只采用与该发行绑定的声明：

- 已登记 Agent 语义的 targets[].agentVersionRange，保留 target 及来源 revision。
- Adapter 白名单对应宿主核心的原包 Metadata 字段，保留原字节和摘要；具体字段按实际记录核实，不能把任意 dependency/peer 视为核心要求。
- 缺声明、身份未绑定、非法范围、同发行声明冲突返回未知/冲突，不补造范围。

不能从 dsh-settings、dsh-tools 等其他组件版本推导 DSH 核心范围。其他依赖继续由预检和官方安装器核实。Evidence 的测试宿主版本是实测事实，不是支持范围；验证成功不能推导为通配范围。

下载 tgz 的真实身份或元数据与预检声明不符时停止对应写入、重新预检；不静默换来源、范围、版本或制品。

### 3.3 三个正交维度

| 维度 | 含义 | 边界 |
| --- | --- | --- |
| compatibility | 核心是否满足声明范围 | 不保证插件运行，不等于 Evidence verified |
| artifact / installability | 对应版本/摘要/格式/来源的制品是否可用 | 缺制品不等于核心不兼容 |
| verification | 实测/审核证据状态 | 未验证不等于范围不适配，不自动升级 verified |

selectable 是后端综合真实阻断事实，不是用户同意。当前 InstallPlanDialog 的 consentRequired=false：不因 unverified/unknown 再增加试装勾选，沿用普通安装确认和明确风险提示；降级、卸载、官方脚本许可等按各自既有确认流程。范围不匹配不进入默认适配集合，其他版本的展示/显式选择不绕过官方拒绝，也不自动授予兼容豁免。

### 3.4 旧数据与多源

- 原始 Metadata/Evidence/Manifest/Lock 字节与摘要原样保留，再生成私有兼容投影；不重序列化原文计算新摘要。
- 缺范围返回 core-range-unknown，保留浏览及原有授权路径；不伪造核心过旧，不全局封锁。
- 同包同版不同摘要/冲突范围不能 Map 最后写入赢；暂停对应候选并说明冲突。
- 合并 revision 用来源 revision 向量的规范摘要，不截断拼接；旧镜像不能恢复已知撤回。
- build metadata 不同但 precedence 相同的发行不是同一制品；不得任意选择其中一个为自动默认，须显式选择/说明歧义。
- 保存 historyCoverage（complete/partial/latest-only/unknown）和安全缺项原因；版本标签不当作已读发行。latestCompatible=null 仅表示当前已知集合无匹配，历史不完整时不能宣称全历史没有适配版本。

## 4. 范围评估与版本列表算法

1. 取得可信宿主快照、已接受目录、真实库存。库存读失败时 installed 为 unknown，不从目录补填。
2. 按登记来源及 Agent 归属收集发行，核对版本、身份、生命周期、摘要和声明冲突。Listing 单独展示，不充当最新发行。
3. 默认稳定发行；用户开启预发行才纳入相应发行。包通道与宿主范围的预发行规则分开。
4. 同一有效集合计算 latestPublished；撤回、非法或身份冲突不能成为唯一权威 latest。
5. 使用完整 SemVer range。缺失不等于通配，非法不等于普通不适配；解析能力不足保留 unknown。
6. 匹配失败后，完整允许集合证明低于全部允许版本才标 core-too-old；高于全部才标 core-too-new；OR 空洞、预发行排除等标 core-range-mismatch。不能只比较 minVersion。
7. 匹配集合计算 latestCompatible，不因缺制品/实测证据变成旧版。每项独立附 selectable、阻断和确认要求。
8. Client 默认选最高的、可选择且构成升级的适配版；保留有效的用户选择，没有更高候选不自动降级。已装版可比目录新或不在目录。
9. latestPublished 的范围明确为 core-too-old 时显示提示，同时保留较旧可用版。有缺制品等问题也需说明，不承诺升级核心即可保证安装成功。

采用成熟 SemVer 范围实现，不手写简化解析。规划轮的间接依赖不构成运行合同；主人后续批准后，已显式声明 semver@7.8.5 运行依赖与 @types/semver@7.7.1 开发依赖并完成安装/锁更新。保留现有精确排序边界，未知规则/无法解析/求值限额分别安全未知，不改坏历史工具。Agent Forge target.versionScheme 原样保留，缺省不猜；其他版本方案不强套 SemVer。

## 5. 最小 API 方案

以下确定实施方向，不代表方法已写入代码或通过 Typert 生成。

### 5.1 hello 增量字段

增加可选 hostCore，保留 hostVersion/coreVersion/coreApiVersion 原义。读取不联网、不扫描 Profile、不启动安装。列表响应再次带本次评估的 hostCore，避免把两次读取拼成不一致快照。

### 5.2 新只读 releaseOptions(request)

输入：已收录 packageName、includePrerelease（默认 false）、cursor/limit（默认 20、最大 100）。分页上下文绑定宿主/目录/通道，变化后重新读首屏，不能拼接不同快照。拒绝 Client 自报宿主版本、任意 URL 和绝对路径。新增 capability：host-release-options。

| 响应块 | 内容 |
| --- | --- |
| context | environmentId、hostRevision、catalogRevision、inventoryRevision、checkedAt、catalogStale |
| coverage | historyCoverage、已取得/已评估记录计数、缺项原因；未知总数返回 null，不拿标签数冒充已校验版本数 |
| hostCore | 可信宿主身份和核心版本 |
| installed | known/unknown/absent、真实版本和可用身份 |
| latestPublished | 当前通道/目录最新有效发行摘要，或 null/缺项原因 |
| latestCompatible | 同一集合的范围匹配最高发行摘要，或 null |
| releases | 完整身份、范围和来源、compatibility、artifact、verification、selectable、阻断/确认要求、与已装版的 upgrade/same/downgrade/unknown 关系 |
| pagination | cursor、hasMore；latest 对完整集合计算，不以当前页猜最新 |

按版本事实排序；Client 可只看适配或查看全部/未知，并默认选择允许集合。响应没有 loading、modalStep、polling、buttonDisabled、defaultReleaseId 或前端文案。

原因码：core-too-old、core-too-new、core-range-mismatch、core-version-unknown、core-version-invalid、core-range-unknown、core-range-invalid、target-agent-mismatch、metadata-conflict。通道、制品缺失、验证未知不冒充核心不适配。

### 5.3 既有更新、计划与操作

- checkUpdates 与 releaseOptions 复用同一评估器，旧字段兼容保留，增量提供相同发行摘要；新 Client 不从旧 flat status 猜核心过旧。
- 管理卡/设置读批量摘要；打开更新/详情再读列表，避免每轮每卡一个 Remote。
- PlanSelection 增可选 releaseContext：宿主/目录 revision 和选中来源身份；保留原 packageName/version/digest。context 不是授权或安全 token。
- planCreate 复验并冻结真实约束；taskStart/写前再次核对核心和目标。变化返回 stale/blocked，不替换选择；无关库存变化不恢复全局 unknown 阻断。
- 保留 taskStart/Get/List/Events。管理动作复用 management 存储补只读查询；安装提交未取得 taskId 时按原幂等意图恢复查询，不另建任务系统。

## 6. 前后端职责与本地交互

| 场景 | 后端事实 | Client 交互 |
| --- | --- | --- |
| 读取/预检 | 有界 API、评估上下文、真实失败 | loading、空态、重读、代次隔离 |
| 默认版本 | 排序后的允许集合 | 保留选择或选首个适配升级，不自动提交 |
| 确认 | 验 confirmed/digest/归属并冻结计划 | 清单、风险说明、降级/卸载二次确认 |
| 提交等待超时 | 保存已接受意图、操作 ID、写入/回执 | 提示等待超时、查原操作，不生成新写入 |
| 关闭/重开 | 同 Profile 操作可恢复 | 释放订阅/计时器，重开只读恢复，不自动取消 |
| 进度刷新 | 实际阶段/已变更项 | 更新展示，不解除未结算请求锁 |
| 官方成功、维护保存失败 | 保留成功及待修复维护事实 | 分层提示，核对不重复官方操作 |
| 核心/目标变化 | 旧计划失效，历史操作事实保留 | 失效旧选择/计划，重新读取确认 |

请求代次绑定环境、hostRevision、目录、包、通道和选择。A 的迟到回执可入 A 的记录，不能覆盖 B 或关闭 B 弹窗。“核对”只读，不再刷新/重装。

## 7. 协议与迁移

- 增量合同，不改官方 schema，不手改 Typert 产物；optional 方法同时检查 capability 和真实存在。
- Provider 已接 Core API 1.1.0 / Remote 2.1.0。兼容 Client 仍以最低 2.0.0 完成既有握手，新能力另探测；不能把 Client 要求直接升到 2.1.0 后声称仍支持旧 Host。
- 旧 Host 缺能力仍可浏览/走既有安装路径，明确适配未知；Client 不恢复 range 算法。协议本身不兼容仍拒绝写入。
- 旧目录未知范围仍未知；不批量改实测状态、不清接受历史。包版本待实施后串行定，不覆盖同版 tgz。
- 本方案不自动冻结/授权旧 G0 的离线、Bundle、成员取消或自动安装接口。

## 8. 施工顺序与所有权

| 阶段 | 工作 | owner / 文件 | 放行门槛 |
| --- | --- | --- | --- |
| HC-0 | 源码/数据/AgentId 绑定、批准范围依赖、冻结 JSON/迁移 | 主控；api/contracts、package/lock 实施时串行 | 来源明确，旧 Host 矩阵确定 |
| HC-1 | 原流程写后结果、回执恢复、目标异常、来源/多源 | Core/Host；Runtime、TaskManager、manager、catalog/store | 不误报零变更、不重复写、不阻断无关旧异常 |
| HC-2 | 私有范围投影、宿主快照、纯评估器 | Core；catalog/metadata/agent-forge、core 评估模块/测试 | 三维独立，范围/预发行/未知/冲突回归 |
| HC-3 | 列表/批量摘要、计划 context、Remote/能力 | 主控串行；api/types/dsh、MarketService、version、包边界 | 全调用链，旧 DTO/Client/Host 兼容或清楚降级 |
| HC-4 | 统一消费、默认选择、锁/代次 | Client；model、MarketPage、SettingsRemotePanel、InstallPlanDialog、TaskDrawer、tests/client | 不重算 range，保持选择，慢操作/重开不重放 |
| HC-5 | 全回归、单构建/包、隔离官方 Desktop | 主控 + 独立 QA | 同包摘要下分层证据，未验 partial |

HC-1 是安全前置，不能用 UI 成功绕过。HC-2 Core 评估与 Client 夹具可在接口冻结后独占并行；公共/Host 主控集成。所有 writer 交回再串行构建/包，最多三 worker。规划不授权真实 Profile 覆盖、第三方安装、推送或发布。

第一实施批次限 HC-0/HC-1 及 HC-2 的数据/纯评估；公开接线按门槛推进。自动安装、离线 UI、Force 成员取消、跨平台不混入。

## 9. 验收与本轮边界

配套 JSON 待转为实际测试，不代表已执行。覆盖：三种版本不同；已装高于目录不降级；范围交集/OR/caret/tilde/hyphen/通配/预发行；过旧/过新/未知；缺制品、未实测、撤回、多摘要、build metadata；缓存、旧 Host；计划核心/目标变化；无关异常；代次倒序、用户选择保持、超时恢复、进度锁及维护保存失败。

验证顺序：Core 定向 → Backend/Remote/Client 合同 → typecheck/lint → 全测试、串行 build/test:pack → 合成 browser-check → 最终包官方 Desktop。pnpm check 自含 build，不另并行构建。

官方验收记录包 SHA256、宿主版本/来源、平台、隔离环境、动作、回执、目标磁盘事实、截图和未验项。只读检查不升级宿主/插件；真实 Profile 写入、依赖安装、发行按当前会话授权。

原规划轮只整理源码/数据/规划文档；主人批准后已开始首批实现，证据见首批实现与验证。文档/JSON 校验不等于产品测试，合成检查不等于官方 Desktop 通过。
