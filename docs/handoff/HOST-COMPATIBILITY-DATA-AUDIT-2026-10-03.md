# 宿主兼容数据事实审计与最小迁移建议

日期：2026-10-03。性质：只读数据审计及实现输入建议，不是产品验收，也不是已实施的公共合同。

## 1. 范围、基线与结论

- 本轮唯一写入文件是本文；方案总控、`PRODUCT.md`、`START-HERE.md` 由主控维护。没有修改运行代码、公共 schema、包版本、锁文件、目录生成物或外部文件。
- 开工只读 Git 核对：分支 `refactor/market-core-adapter`；HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`；业务审查基线 `9fc09a28b961e9cc857543b134fbc3e924e31b71` 存在；开工工作区干净。下述源码行号及统计针对本轮读到的当前工作区，而非假定远端最新状态。
- 用户本轮确认的“核心”是目标 Agent 宿主核心，例如 DSH 本身，不是 `@dsh-eac/market-core`。先取得宿主核心版本并提供匹配版本列表，同时保留最新有效发行版；只有可靠、完整的范围证明当前宿主核心版本低于全部允许版本，才提示“<Agent名>核心版本过旧”。该提示不以核心是唯一阻断为前提；同时存在制品或依赖阻断时，应并列保留这些事实，不保证升级核心即可成功。这属于本轮需求，不表示已经实现。
- 用户要求分离版本范围匹配、`verification` 实测证据、制品可选性；不能由 settings/tools 等其它 peer 推断宿主核心范围。后台提供 API 与真实业务事实并继续保存写入/回执事实；前端负责交互中间态。

**当前事实摘要：**

1. 实际 Agent Forge 五类 source/index 的 `agentId` 都是字符串 `dsh`，不是目录名推断；56,197 条索引 latest 记录也都有 dsh target。但全部为 `compatibilityStatus: "unknown"`、`agentVersionRange: null`，不能直接提供已知匹配版本集合。[E11–E13；第 3.3 节]
2. 嵌入目录有 61 条 plugins、21 条研究 listings。plugins 的标准化宿主范围为 0/61；解码原字节后，18/61 含明确 `engines.dsh`，其中 14 条也有相同的 `peerDependencies["@deepseek-ai/dsh"]`。这些是声明，不是新的实测证据。[E01、E02；第 3.1 节]
3. Hello 已有 `hostVersion`；`coreVersion`/`coreApiVersion` 是市场 Core 自身信息。Hello 缺生产 AgentId 映射字段；DSH Adapter 当前也没有显式接线 `targetAgent`，不能靠显示名或路径补猜。[E03、E04、E08]
4. Agent Forge reader 保留原记录，但只读索引 path 指向的 latest；投影和最终 `CatalogSnapshot` 不保留 targets、范围、原始证据及发行身份。更新 DTO 没有匹配列表、兼容候选与最新有效发行的分栏事实。[E05–E09]
5. 当前设计缺规范化安装时 Agent 身份/核心范围决策快照；但 DSH 任务计划中的 hostFingerprint 实际含 JSON 形式的 hostVersion，可在保存了对应任务时有限恢复，不能误写为历史版本全部丢失。真实任务与回执仍需保留；本轮未读取 profile，不能证明具体已安装历史。[E15–E17；第 5 节]

## 2. 当前源码与数据证据索引

后文 `[E编号]` 指向以下当前路径、符号及起始行。统计还明确实际 JSON 字段及全量口径。base64 原字节的行号定位包装对象，统计使用解码字段，不伪造不存在的文本行号。

| 编号 | 当前路径、符号/字段与起始行 | 可证明的边界 |
| --- | --- | --- |
| E01 | `G:/Code/fork/agent-market/packages/market/data/index.json:1`（revision）；`G:/Code/fork/agent-market/packages/market/data/index.json:9`（plugins）；`G:/Code/fork/agent-market/packages/market/data/index.json:8987`（presentations）；`G:/Code/fork/agent-market/packages/market/data/index.json:9562`（releases）；`G:/Code/fork/agent-market/packages/market/data/index.json:10599`（releaseStatuses）；`G:/Code/fork/agent-market/packages/market/data/index.json:10923`（deliveries）；`G:/Code/fork/agent-market/packages/market/data/index.json:11678`（listings） | 嵌入目录快照与统计来源，不是本机库存。 |
| E02 | `G:/Code/fork/agent-market/packages/market/data/index.json:540`（ui-skin-loader）；`G:/Code/fork/agent-market/packages/market/data/index.json:1685`（@vlln/dsh-navbar）；`G:/Code/fork/agent-market/packages/market/data/index.json:8910`（dsh-undo-savepoint） | 对象内 metadata.packageJson.contentBase64 可解码出明确核心声明。 |
| E03 | `G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:27`（EnvironmentHello）；`G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:94`（CatalogPlugin）；`G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:126`（CatalogListing）；`G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:293`（UpdateCheckItem/Result）；`G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:440`（InventoryItem） | 当前 Client 合同的已有字段及缺项。 |
| E04 | `G:/Code/fork/agent-market/packages/market/src/index.ts:108`（officialHostVersion）；`G:/Code/fork/agent-market/packages/market/src/index.ts:138`（identity）；`G:/Code/fork/agent-market/packages/market/src/index.ts:154`（配置来源映射）；`G:/Code/fork/agent-market/packages/market/src/index.ts:205`（hello） | hostVersion 读取 app-boot 包版本，失败为 unknown；配置没有显式 targetAgent 接线。 |
| E05 | `G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:120`（validateSource）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:137`（validateIndex）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:157`（validatePackage）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:249`（readAgentForgeSource）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:303`（targetAgent）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:308`（entry.path 读取） | 校验身份/targets 元数据，返回原 record；不求值宿主范围，不逐个读历史版本。 |
| E06 | `G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:337`（ProjectionOptions）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:345`（projectAgentForgeCatalog）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:379`（离线插件）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:395`（listing） | 元数据默认投影为研究 listing；核对离线制品后可有安装行，verification 为 unknown，targets 不传递。 |
| E07 | `G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:141`（插件映射）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:181`（evidence）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:201`（listing）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:419`（证据匹配）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:434`（发行绑定）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:491`（projectedPlugins）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/validate.ts:494`（snapshot） | 原字节、releaseId/evidence/metadata 被剥离；保留粗状态和已绑定日期，撤回转 hard-blocked。 |
| E08 | `G:/Code/fork/agent-market/packages/market-core/src/host/market-runtime.ts:190`（host context）；`G:/Code/fork/agent-market/packages/market-core/src/host/market-runtime.ts:331`（catalogView）；`G:/Code/fork/agent-market/packages/market-core/src/host/market-runtime.ts:378`（agentForgeRefresh）；`G:/Code/fork/agent-market/packages/market-core/src/host/market-runtime.ts:656`（checkUpdates） | 证据 host.id 是 Adapter 构造身份，非 Agent Forge AgentId；刷新存投影，更新调用无宿主范围输入。 |
| E09 | `G:/Code/fork/agent-market/packages/market-core/src/core/update-check.ts:14`（latestForPackage）；`G:/Code/fork/agent-market/packages/market-core/src/core/update-check.ts:28`（compareInstalledUpdates）；`G:/Code/fork/agent-market/packages/market-core/src/core/semver.ts:7`（validVersion）；`G:/Code/fork/agent-market/packages/market-core/src/core/semver.ts:13`（compareVersions） | 当前按包名/SemVer 排序；incompatible 原因来自制品状态；semver 模块无范围匹配。 |
| E10 | `G:/Code/fork/agent-market/packages/market-core/src/catalog/public-format.ts:139`（Manifest）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/public-format.ts:207`（compat.hosts）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/public-format.ts:331`（validatePublicEvidence）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/public-format.ts:367`（elevated host）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/public-format.ts:377`（evidenceSupportsVerification）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/model.ts:25`（原记录）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/model.ts:56`（ReleaseRecord）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/model.ts:137`（HostEvidenceContext） | Manifest API/host 字符串不等于核心范围；Evidence 精确绑定制品/Manifest/宿主且判断有效期/撤销。 |
| E11 | `G:/Code/sourcerepo/agent-forge/package.schema.json:14`（version）；`G:/Code/sourcerepo/agent-forge/package.schema.json:19`（links）；`G:/Code/sourcerepo/agent-forge/package.schema.json:30`（targets）；`G:/Code/sourcerepo/agent-forge/package.schema.json:31`（distributions）；`G:/Code/sourcerepo/agent-forge/package.schema.json:42`（_meta）；`G:/Code/sourcerepo/agent-forge/package.schema.json:98`（$defs.agentTarget）；`G:/Code/sourcerepo/agent-forge/package.schema.json:130`（bundle/effectiveTarget） | 宿主范围正式字段；links/候选来源/_meta 不自动赋予实测事实。 |
| E12 | `G:/Code/sourcerepo/agent-forge/index.schema.json:14`（agentId）；`G:/Code/sourcerepo/agent-forge/index.schema.json:34`（packageEntry）；`G:/Code/sourcerepo/agent-forge/data/dsh/bundle/source.json:5` / `G:/Code/sourcerepo/agent-forge/data/dsh/bundle/index.json:6`；`G:/Code/sourcerepo/agent-forge/data/dsh/general/source.json:5` / `G:/Code/sourcerepo/agent-forge/data/dsh/general/index.json:6`；`G:/Code/sourcerepo/agent-forge/data/dsh/mcp/source.json:5` / `G:/Code/sourcerepo/agent-forge/data/dsh/mcp/index.json:6`；`G:/Code/sourcerepo/agent-forge/data/dsh/plugin/source.json:5` / `G:/Code/sourcerepo/agent-forge/data/dsh/plugin/index.json:6`；`G:/Code/sourcerepo/agent-forge/data/dsh/skill/source.json:5` / `G:/Code/sourcerepo/agent-forge/data/dsh/skill/index.json:6`（实际 agentId）；各 index 第 12 行开始 packages | 五组实际文件逐个读取，身份值均为 dsh；不是生产宿主映射规则。 |
| E13 | `G:/Code/sourcerepo/agent-forge/data/dsh/plugin/packages/00080000~2Fdsh-project-memory--d89c82531ed2/unversioned--d01383c373dd.json:6`（unversioned）；`G:/Code/sourcerepo/agent-forge/data/dsh/plugin/packages/00080000~2Fdsh-project-memory--d89c82531ed2/unversioned--d01383c373dd.json:11`（targets）；`G:/Code/sourcerepo/agent-forge/data/dsh/plugin/packages/00080000~2Fdsh-project-memory--d89c82531ed2/unversioned--d01383c373dd.json:26`（links）；`G:/Code/sourcerepo/agent-forge/data/dsh/plugin/packages/00080000~2Fdsh-project-memory--d89c82531ed2/unversioned--d01383c373dd.json:49`（_meta） | 实际 unknown/null/note 样本；全量数字来自 E12 的每个 packages[name].path，不从样本外推。 |
| E14 | `G:/Code/fork/agent-market/catalog-source/eac-inventory/CURRENT.json:2`（推荐 v3）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:5`（sources）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:26`（summary）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:54`（plugins）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:114`（lockEntry.compatibility）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:147`（official.evidence）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:171`（license.evidence）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:182`（runtimeVerification）；`G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/inventory.json:189`（buildMaterials） | 原清点资料、声明及不同用途证据；整体官方源码版本不是逐条插件范围。 |
| E15 | `G:/Code/fork/agent-market/packages/market-core/src/core/ports.ts:30`（ArtifactAcquisition）；`G:/Code/fork/agent-market/packages/market-core/src/core/ports.ts:70`（HostInstallRequest）；`G:/Code/fork/agent-market/packages/market-core/src/core/ports.ts:208`（PlanBundle）；`G:/Code/fork/agent-market/packages/market-core/src/core/ports.ts:233`（TaskAttemptRecord）；`G:/Code/fork/agent-market/packages/market-core/src/core/ports.ts:245`（TaskRecord）；`G:/Code/fork/agent-market/packages/market-core/src/contracts/types.ts:500`（InstallPlan） | 冻结制品/delivery、目录 revision、hostFingerprint、库存基线、尝试事实；缺 typed AgentId/核心范围决策字段，hostFingerprint 另见 E16。 |
| E16 | `G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:345`（OfficialReceipt）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:412`（hostFingerprint）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:438`（sourceEvidence）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:474`（install）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:482`（dispatched 写入）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/host-port.ts:493`（received/outcome 写入） | fingerprint 为含 hostVersion 的 canonicalJson；回执/引用/字节恢复来源；sessionRevision 不是宿主版本。 |
| E17 | `G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/manager.ts:36`（InventorySourceEvidence）；`G:/Code/fork/agent-market/packages/market-core/src/adapters/dsh/incompatible-evidence.ts:9`（IncompatibleBundleEvidence） | 内部回执身份/peers 不直接进入 DTO，不是完整历史或核心范围。 |
| E18 | `G:/Code/fork/agent-market/scripts/catalog/eac-inventory.py:632`（metadata/版本选择）；`G:/Code/fork/agent-market/scripts/catalog/eac-inventory.py:644`（listing）；`G:/Code/fork/agent-market/scripts/catalog/eac-inventory.py:668`（plugin 投影）；`G:/Code/fork/agent-market/scripts/catalog/eac-inventory.fragment.ts:15`（差集）；`G:/Code/fork/agent-market/scripts/catalog/eac-inventory.fragment.ts:34`（merge 规则） | 保留原 metadata，使用事实版本，不映射标准化范围；片段不是完整目录。 |
| E19 | `G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:40`（原 metadata）；`G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:46`（原 version）；`G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:47`（blockers）；`G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:61`（release）；`G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:65`（plugin）；`G:/Code/fork/agent-market/scripts/catalog/recover-published-catalog.py:79`（历史与展示替换）；`G:/Code/fork/agent-market/catalog-source/published-20260928/runtime-review.json:1`（静态阻断） | 恢复原发行、静态阻断不等于实测；展示版本可替换，历史 release 保留。 |
| E20 | `G:/Code/fork/agent-market/packages/market-core/src/catalog/releases.ts:9`（parseRelease）；`G:/Code/fork/agent-market/packages/market-core/src/catalog/releases.ts:46`（parseReleaseStatus）；`G:/Code/fork/agent-market/packages/market/src/client/model.ts:113`（checkUpdates）；`G:/Code/fork/agent-market/packages/market/src/client/model.ts:243`（动作判断） | 来源/撤回与业务可用分离；Client 当前没有范围事实输入。 |

## 3. 真实数据计数与覆盖率

### 3.1 嵌入市场目录

直接 JSON.parse `packages/market/data/index.json`，revision 为 `eac-published-20260928-6`，generatedAt 为 `2026-09-28T15:14:09.966Z`；不是执行生成器，也不意味着公网或宿主已验收。[E01]

| 统计对象/字段 | 实际数量 | 口径 |
| --- | ---: | --- |
| plugins | 61 | 61 个不同 packageName、61 个不同 id@version；每个包仅一条展示版本。 |
| listings | 21 | 研究登记；21 条都有 requestedVersion，不属于 plugins 分母。 |
| presentations / deliveries | 61 / 39 | delivery 不等于安装可用或运行通过。 |
| releases / releaseStatuses | 44 / 46 | 按 releaseId 取最大 sequence 后，39 active、5 withdrawn；状态事件数不等于发行数。 |
| packs / recommendations / collections | 0 / 0 / 0 | 空表不代表组合功能已验收。 |
| metadata.kind | official-bundle 59；dsh-std 2 | 61 份原字节 JSON 均解码成功。 |
| verification | unverified 51；hard-incompatible 10；verified 0 | 当前目录状态，不是宿主范围覆盖率。 |
| installability | bundle-installable 29；hard-blocked 22；missing-bundle 8；missing-artifact 2 | 不从这些状态推出宿主版本过旧。 |
| 标准化宿主身份/范围字段 | 0/61（0%） | plugins 顶层无 targets/compatibility/agentVersionRange/hostVersionRange；合同也无规范化宿主范围字段。 |
| 明确 engines.dsh 声明 | 18/61（29.51%） | 解码 packageJson 后非空核心版本字符串，仅声明覆盖。 |
| 明确 peerDependencies[@deepseek-ai/dsh] | 14/61（22.95%） | 全是上述 18 条的子集，不能加成 32 条。 |
| 原 Public Evidence / managementEvidence | 0/61 / 0/61 | 分别按 plugins.evidence 非空数组、managementEvidence 存在计数。 |
| sourceUrl / releaseId / 原 releasedAt | 61/61 / 39/61 / 0/61 | 来源、发行绑定不是测试；generatedAt 不得冒充作者发布时间。 |

以上是 E01 对应数组/字段的全量只读计算，没有用库存或历史 README 数字替代当前数据。18 条明确宿主声明的构成及原值如下：[E01、E02；解码 metadata.packageJson]

- 16 条 `engines.dsh = "0.1.7-rc.2"`：`@dsh-eac/desktop-pack`、`@dsh-eac/pack-installer`、`@dsh-eac/ui-skin-loader` 及 13 个 skin 包（aurora、blue-fantasy、deep-whale-day-night、dragon-heir、inkwash、maid-atelier、miku、minecraft、qq98、ths、trading、whale-song、xp）。loader + 13 skins 同时声明 `peerDependencies["@deepseek-ai/dsh"] = "0.1.7-rc.2"`；精确版本不可扩成 `>=0.1.7-rc.2`。
- `@vlln/dsh-navbar` 原 `engines.dsh` 是 `>=0.1.0-rc.5`。
- `dsh-undo-savepoint` 原 `engines.dsh` 是 `>=0.0.1-0 || >=0.1.0-rc.2 || >=0.1.1-rc.1 || >=0.1.2-alpha.2 || >=0.1.2-rc.1 || >=0.1.5-rc.1 || >=0.1.5-rc.2`；保留 OR 表达式，不简化为首次看到的最低要求。
- 另 43 条没有上述明确核心声明；两份 dsh-std Manifest 没有 compat.hosts 或结构化核心范围。React、Cordis、settings、tools、dsh-agent 等单模块 peer 和 Node engines 都不纳入这 18 条。[E01、E10]

它们能作为“原版本、原字节、原声明”的迁移输入，但本轮没有校验归档真实性、重新取得作者测试或执行范围求值；不能写成“作者已测试支持”或“全范围实际可用”。[E02、E10、E19]

### 3.2 catalog-source 原始资料与候选/片段

按 CURRENT 明确指向的 v3 统计，不重复计算根目录历史拷贝、distribution 副本、片段及候选。[E14、E18]

| 数据对象 | 实际数量/覆盖 | 口径与证据 |
| --- | --- | --- |
| inventory-v3/inventory.json.plugins | 82；不同包名 82 | 原始清点，不是当前生产 plugins；数组从 E14 第 54 行开始。 |
| source.lockEntry.compatibility | 有字段 62/82（75.61%）；非空 0/82（0%） | 62 个全为 `{}`；其余 20 个没有该 lock 字段。空对象不是兼容所有版本。 |
| buildMaterials.engines.dsh | 16/82（19.51%） | 与前节 16 条精确 `0.1.7-rc.2` 的包名对应；peer 的明确 DSH 核心键为 14/82，是子集。 |
| install.runtimeVerification | not-tested 82/82 | 不是运行测试通过，也不能用 summary.runtimeTested=false 之外的字段补造通过。 |
| 原证据字段 | official.evidence 存在 74、非 null 2；license.evidence 数组非空 20/82 | official 用于源码/同名判断；license 用于许可材料。均不计作宿主实测或范围。 |
| inventory-v3/listing-only.json.plugins | 27；27 个 lock compatibility 都为 `{}` | `G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/listing-only.json:4`；属于上述 82 的子集。 |
| inventory-v3/market-index.candidate.json | plugins 55；listings 27 | plugins 第 9 行、listings 第 3540 行；只读候选，不覆盖嵌入目录。[E18] |
| inventory-v3/catalog-fragment.json | plugins/presentations 43/43；releases/statuses 6/6；deliveries 3；listings 27 | `G:/Code/fork/agent-market/catalog-source/eac-inventory/inventory-v3/catalog-fragment.json:5`（plugins），第 2032/2233/2277/2321 行分别为其余业务数组；43 plugins 均 unverified、无顶层核心范围。差集设计见 E18。 |
| distribution/market-index.candidate.json | plugins 55；listings 27 | `G:/Code/fork/agent-market/catalog-source/distribution/market-index.candidate.json:9`（plugins），第 3540 行（listings）；不是当前 61/21 快照。 |
| published-20260928/recovered-records.json | 24 | `G:/Code/fork/agent-market/catalog-source/published-20260928/recovered-records.json:1` 的整个数组；版本恢复路径见 E19，不额外加到 61。 |

版本来源的 82 条分布：[E14，逐 plugins[].versionBasis]

- `registry-request-only` 20、`registry-lock-only` 7、`beta-pack-catalog-only` 20。
- `latest-beta-package-json` 25、`exact-aggregate-member-package-json` 5、`latest-beta-retained-archive` 3、`explicit-local-derivative-of-latest-beta-built` 2。
- 登记请求/锁/旧目录不能证明作者真实发行；团队派生不是作者发行。只按 E18 的原 metadata/version 与 E19 已保存原包恢复材料逐条绑定，不拿整个 inventory.version 统一回填作者版本。[E18、E19]

### 3.3 外部 Agent Forge 实际数据

仅只读允许的 `G:/Code/sourcerepo/agent-forge/data/dsh` 及根 schema，没有读取其 profile 或运行外部工具。统计单位为 `(来源 type, index.packages 键)`：全量读取五类 index 的每个 `entry.path` 指向 latest JSON；不是递归目录文件数，也不是跨来源去重后的项目数。[E11–E13]

| 类型 | index 条目 / 实读 latest | versions 标签总数 | 多版本 index 条目 | dsh target | known / 非空范围 | unknown + null + 非空 note |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bundle | 0 / 0 | 0 | 0 | 0 | 0 / 0 | 0 |
| general | 30 / 30 | 30 | 0 | 30 | 0 / 0 | 30 |
| mcp | 37,828 / 37,828 | 40,127 | 2,299 | 37,828 | 0 / 0 | 37,828 |
| plugin | 16,648 / 16,648 | 16,648 | 0 | 16,648 | 0 / 0 | 16,648 |
| skill | 1,691 / 1,691 | 1,700 | 9 | 1,691 | 0 / 0 | 1,691 |
| 合计 | 56,197 / 56,197 | 58,505 | 2,308 | 56,197 | 0 / 0 | 56,197 |

- latest 读取/JSON 解析失败 0；记录 name 与 index 键、record.version 与 entry.latest 不一致数为 0。这里只做计数/字段核对，未执行官方 schema validator、生产 reader 或刷新 API，不能据此宣告导入通过。
- 宿主身份覆盖 56,197/56,197（100%），已知核心范围覆盖 0/56,197（0%），unknown/null/note 覆盖 100%。空 bundle 分母为 0，覆盖率应记不适用，不写 100%。所有数字由 E12 索引和其指向记录全量计算。
- 五类 source.agentId 与 index.agentId 均为 `dsh`。bundle revision 为 `20261001T080000Z`；其余四类为 `source-names-unicode-20261002`。这是实际数据身份，不等于生产宿主到 AgentId 的映射已实现。[E12、E04]
- `versions` 合计 58,505 仅是版本标签数；本轮没有逐一定位/读取非 latest 记录，不能将差额 2,308 宣称为已核验可安装历史发行，也不能用它们推断已安装历史。
- `version = "unversioned"` 的 latest 共 18,313：general 30、plugin 16,648、skill 1,635。package.versionScheme 为 unknown 56,176、semver 16、custom 5；不得把 unversioned 改成 `0.0.0` 或凭数字外形补作者版本/排序约定。[E11、E13；同一全量扫描]
- top-level 键名包含 evidence/tested/verification 的记录为 0；_meta 第一层键名包含这些词的记录也为 0。这是明确的字段位置扫描，不宣称“任何自由文本都没有提到测试”。links 存在 53,681 条，也不计作测试证据。[E11、E13；同一全量扫描]
- 实际 index 文件大小：bundle 374 bytes、general 33,867、mcp 28,531,906、plugin 16,188,328、skill 1,726,079。mcp/plugin 超出 reader 默认 `8 * 1024 * 1024`；默认上限见 `G:/Code/fork/agent-market/packages/market-core/src/catalog/agent-forge.ts:79`、第 225/234/251 行。故本轮直接文件统计不等价于默认生产 API 可载入；分页/分片或受控读取策略由主控决定，不以无界放宽绕过安全边界。

## 4. 各数据层字段位置与 Client 保留情况

| 层 | 宿主身份/版本范围在哪里 | 证据在哪里 | 是否保留到 Client |
| --- | --- | --- | --- |
| 原清点 inventory | sources.officialVersion 是源码审查背景；source.lockEntry.compatibility 全空；buildMaterials.engines.dsh / 核心 peer 有少量明确声明 | official.evidence、license.evidence、api.method、install.runtimeVerification 各有不同用途 | 原清点不是 DTO；生成器将原包 metadata 包装进候选，不映射标准化宿主范围。[E14、E18] |
| 嵌入 MarketIndex | plugins.metadata.packageJson 内明确 engines.dsh；dsh-std 的 facets.host.apiVersion 是契约版本，不是 DSH 核心版本；原 Manifest compat.hosts 仅字符串列表 | 原 plugins.evidence、ReleaseRecord.provenance、managementEvidence 分别是测试材料、来源、管理操作审查 | metadata/evidence/releaseId 不进最终 snapshot；managementEvidence 合同可传递，但当前实际为 0。[E01、E03、E07、E10] |
| Agent Forge source/index | source.agentId 与 index.agentId 必须一致；index.packages[name].latest/versions/path 是插件版本索引，不是宿主版本 | source/index checksum 与 collection sources 是内容/来源追溯，不是实测 | reader 当前返回原 source/index；主 Remote 不把它们原样发给 Client。[E05、E08、E11、E12] |
| Agent Forge package 原记录 | targets[].agentId/agentVersionRange/versionScheme/compatibilityStatus/compatibilityNote；bundle 另有 effectiveTargets | _meta 可保留未知扩展；当前全量覆盖口径见 3.3；links/distributions 只是资料/获取候选 | validatePackage 返回原对象，因此 reader 内可保留 targets 和 _meta；不意味着 Client 可见。[E05、E11] |
| Agent Forge → MarketIndex 投影 | projectAgentForgeCatalog 不映射 targets、range、versionScheme、compatibilityNote，也不展开 versions 历史 | 有 verified offline artifact 只表示制品核对；明确设 verification=unknown | 普通条目只剩 CatalogListing 的 name/summary/reason/sourceUrl/requestedVersion；离线安装行也不传范围。[E06] |
| MarketIndex → CatalogSnapshot | parsePlugin / parseListing 白名单没有核心范围；projectedPlugins 剥离 metadata、manifest、manifestDigest、releaseId、evidence | Evidence 用来决定当前宿主 verification；原字节留 Host 的 ValidatedCatalog maps，不进 snapshot | Client 收到 verification/installability/releasedAt 等结果，无核心范围、发行身份、证据宿主/有效期明细；releasedAt 仍可能缺失。[E03、E07、E10] |
| EnvironmentHello | hostVersion 来自 app-boot/package.json；coreVersion/ApiVersion 来自市场 Core 常量；无 agentId、agentName、宿主版本约定/获取依据 | capabilities 是当前 API 能力，不能当插件测试 | hostVersion 到 Client；不是已完成生产 AgentId 映射。[E03、E04] |
| UpdateCheckResult | installedVersion/latestVersion/sourceRevision/inventoryRevision；没有 compatibleVersions、latestCompatible、latestEffectiveRelease、host 身份/范围结果 | 当前 incompatible 判断为 hard-blocked/missing-artifact/needs-repair，无范围或测试语义 | DTO 可到 Client，但不足以支撑新的版本匹配交互；不得将 reason 文案转换成“核心过旧”。[E03、E08、E09、E20] |

### 4.1 证据与兼容是否混用

- **已正确分开的一处：** Agent Forge 投影注释明确指出 target metadata 不是当前官方宿主证据，即使制品经离线核对，也设置 verification=unknown；不能为了提供匹配列表而改成 verified。[E06]
- **实测判定的当前边界：** Public Evidence subject 绑定 plugin id/version/artifactDigest 与 manifestDigest；elevated evidence 还带 hostDescriptorDigest、host.id/name/version/adapterVersion/dshVersion/runtime。supportsVerification 只接受 Tested/Observed/Attested 的有效 pass、全 checks pass、未撤销/未过期、hostId/dshVersion/runtime 精确一致；不是“一个宿主测试点可以推导整个版本区间”。official-bundle 当前不能冒用依赖 Manifest 的 Public Evidence，扩展它需另行合同设计。[E07、E10]
- **存在语义混合的一处：** 恢复脚本依据缺官方模块、缺 bundle、静态 API 阻断等 blockers 同时设 hard-incompatible 与 hard-blocked。runtime-review 的两个案例明确只是对特定原包及 `0.1.7-rc.2` 的静态检查、未运行第三方代码。因此 verification 的现有枚举并非全都来自实测，不能整体迁移成“宿主范围不匹配”。[E19]
- **另一个混合出口：** compareInstalledUpdates 的 incompatible 是制品状态判断；未检查 hostVersion、targets、verification，也没有逐范围筛选。不是宿主版本判断 API。[E09]
- **来源不产生新证据：** sourceUrl、links、仓库 commit、下载镜像回执、摘要/许可证核对各说明各自事实；导入、同步、改链接不会更新 testedAt，不改变原测试绑定的宿主、插件版本或制品。[E10、E11、E14、E19、E20]

## 5. 已安装历史信息：已有、缺项与恢复边界

这里只审计当前结构，不检查任何真实用户安装记录。[E03、E15–E17]

| 信息 | 当前已有事实载体 | 缺项/恢复限制 |
| --- | --- | --- |
| 当前已安装身份 | InventoryItem.packageName/version/artifactDigest/source/provenance/rows；unknownItems 保留不确定 | version/digest 允许缺失；当前观察不能证明安装时字段。当前 Inventory DTO 无 installedAt、sourceId、releaseId、当时 AgentId/范围决策。[E03] |
| 冻结安装计划 | InstallPlan.environmentId/catalogRevision/hostFingerprint；PlanBundle.deliveries；TaskRecord.baseline/attempts/idempotency | catalogRevision 是引用，不等于完整当时目录；没有结构化当时范围、来源字段指针、匹配理由或证据快照。[E15] |
| 历史宿主版本 | DSH OfficialHostPort.readState 的 hostFingerprint 是 canonicalJson({hostVersion, profileName, capabilities})，可进入保存的计划 | 对**已有对应任务且 fingerprint 确认来自此实现**的历史，可解析恢复当时版本字符串；unknown 仍未知。不能把其它 Adapter 的 opaque fingerprint 一律当 JSON，也不能补出 AgentId、完整范围或实测。[E15、E16] |
| 官方写入/回执 | OfficialReceipt.request/sessionRevision/at/stage/outcome；request.artifact 的 exact version/digest；dispatched 和 received 持久写入 | at 是回执/派发时间，非统一安装完成时间；sessionRevision 是进程会话；无 AgentId/核心范围决策。保存回执不等于所有运行文件已验证，更不等于业务可用。[E15、E16] |
| 源归属恢复 | sourceEvidence 核对 applied 回执、当前依赖引用、当前缓存字节，返回 InventorySourceEvidence | receiptId/cacheRef/dependencyRef 是内部证据，DTO 只呈现粗来源和摘要；缺任务/回执时不能用今日目录倒填历史。[E16、E17] |
| 管理安全/不兼容证据 | managementEvidence 可记录绑定制品的操作审查；IncompatibleBundleEvidence 是 Host-private peers/fingerprint/sharedImpact | 当前目录管理审查字段为 0；内部 peers 不是核心范围，也不授权把版本不兼容转换成业务测试失败。[E01、E03、E17] |

因此“历史信息全部没有”不成立；正确缺口是缺**标准化、可跨 Adapter 消费**的当时宿主身份/核心版本、兼容声明来源和决策、证据引用及对应发行身份。计划 fingerprint 能有限恢复已有 hostVersion，但不补造其余事实。[E15、E16]

## 6. 旧数据不可推断的内容与最小迁移建议

以下是给主控的待实现建议，不修改公共合同，也不声明已完成。

### 6.1 禁止推断

1. 不以路径 `/data/dsh/`、显示名、“官方”布尔值、Evidence.host.id 或包名猜生产 AgentId。当前数据明确使用 dsh，但映射应由 Adapter/可信宿主身份合同显式给出；Hello 缺项时返回身份未知。[E03、E04、E08、E12]
2. 不把 `{}`、null、unknown、unverified、sourceUrl 或来源同步视为全范围支持；不把单次测试点扩成 range。没有明确声明时保留未知，不编造 `*` 或最低版本。[E10–E14]
3. 不由 settings/tools 等其它 peer、Node engines、facets.host.apiVersion 或 Manifest compat.hosts 自由字符串推导核心范围；核心 engines 与明确核心包 peer 才是可审核提取候选，两者冲突也不能任选一个。[E02、E10、E14]
4. 不把登记请求、unversioned、today catalog version 当作者真实发行/已安装历史；不把最近生成时间当发布时间。当前 44 个 release 没有完整跨版本展示列表，历史 release 也不能仅凭 version 重新拼制品。[E01、E03、E11、E18、E19]
5. 不从范围不匹配直接提示“核心过旧”：精确 pin 导致过新、不同 Agent、未知版本、区间上界/排除段、范围冲突、不支持的版本约定、撤回/缺制品，都不是“只因需要更高核心”。[E02、E03、E09、E11；用户本轮确认的提示边界]

### 6.2 最小数据迁移顺序

1. **冻结来源与宿主身份。** 由主控定义生产 AgentId/名称/宿主核心版本/版本约定的显式来源；与 market-core 版本字段分开。记录 observedAt 与获取依据，unknown 不补默认 dsh。当前 DSH app-boot 版本读取与证据 host.id 都是 Adapter 行为，不冒充官方通用 Agent 身份 API。[E04、E08]
2. **增量建立“声明”记录，不改原字节。** 优先从现有 18 条 engines.dsh 及其 14 条明确核心 peer 提取：绑定 package/id、exact plugin version、制品/metadata 摘要（已有才绑定）、声明原字符串、原字段指针、来源/revision、版本约定的确定依据；缺项仍未知。raw v3 的 16 条是重叠材料，不再增加覆盖数。Agent Forge 原 targets 五个配套字段原样保留；56,197 个 unknown 不升级为 known。[E01、E02、E05、E11、E14]
3. **逐版本保留事实，再做范围求值。** 先补齐可寻址的真实发行/元数据/生命周期与历史版本读取路径，不能只用 index.versions 标签；恢复脚本的展示替换和 reader 的 latest-only 必须在实现阶段改为保留版本事实。求值服务输出 match/non-match/unknown 及依据，与 verification 和 artifact selectable 分栏；不把不支持的 scheme 静默当 SemVer。现有单版本排序器不能充当范围求值器。[E05、E09、E11、E19、E20]
4. **版本 API 同时保存两个视角。** 给主控合同提供匹配版本列表与最新有效发行事实，并分别给出制品可选性、实测证据状态；未知范围不伪装成匹配或不匹配。最新有效发行保留生命周期身份，不因当前核心不匹配而消失；matching 只是范围维度，不要求先 verified。只有可解析、无冲突、完整求值能证明最新发行仅受更高核心要求阻挡，且无独立阻断事实时，才返回 core-too-old 类业务事实；前端按明确 Agent 名呈现提示。字段命名由主控决定，本文不定义最终 DTO。[E03、E07、E09、E20；用户本轮确认]
5. **最小历史补录。** 仅在版本/digest/receipt/task 严格绑定时恢复已有确切身份；DSH 旧计划 fingerprint 解析要标注 legacy-derived 来源。新写入附加结构化当时宿主身份/核心版本、声明引用、求值结果/规则版本、release/目录 revision、证据引用；旧缺项明确 null/unknown，不用今天的状态覆盖旧结论。原写入请求、回执、幂等和业务任务事实保持原样。[E03、E15–E17]
6. **持久化边界保持清楚。** 后台持久化原始有效目录/版本/声明、生命周期、写入/回执/事实快照；前端的 fetching、loading、展开/选择、提示展示等交互中间态不成为后台权威业务记录。后台现有 queued/installing/awaiting-approval 等任务事实不能因“前端负责中间态”而删掉或仅放 Client 内存。[E08、E15、E16；用户本轮确认]

建议主控先冻结身份映射、三轴事实合同与未知策略，再分配 Core/Adapter/Client 实现。真实有效范围目前很稀疏，不能先上线“全量兼容列表”再用猜测补数据。[E01–E14]

## 7. 本轮验证、未验证项与交接

**实际执行：** 阅读指定接力/产品文件及当前源码；只读 Git 分支/HEAD/基线/状态核对；JSON 解析计数、61 份嵌入 metadata 解码、82 条 v3 清点字段统计；逐 index.path 读取 56,197 份外部 latest 记录，核对 name/latest/target/范围字段；读取 schema 定位字段；统计五类 index 文件字节数。没有执行 build/check/lint/测试、目录生成器、生产 reader、网络安装或外部发布操作。

**文档验证：** 119 个独立源码/数据路径行号引用覆盖 39 个文件，引用路径存在、行号在文件范围内且非空，错误数 0；这仅验证引用可定位，不替代业务功能或实测验收。

**未验证与不应冒充通过的项目：**

- 官方 Desktop/宿主 API、生产 AgentId 映射、实际 hostVersion 读取结果及任意真实 profile/已安装历史；仅核对当前实现，未运行宿主。
- 外部 source/index/package 官方完整 schema 校验、checksum 实际重算、生产来源刷新、超限索引读取策略；本轮成功 JSON.parse 不是 reader/validator 验收。
- 非 latest 版本文件、未被 index 引用的历史/副本/孤立记录；58,505 仅标签总数，不能作为已读取发行数。
- 18 条原核心声明的范围语法/预发行求值、冲突规则、作者当前真实发行状态；本轮没有网络获取，未重新运行制品或作者测试。
- Evidence 真正执行、有效宿主匹配验收、制品匿名可达性、安装/启用/业务可用；保留历史事实，不把 source/link 变成新测试证据。

**下一步输入：** 主控先确认生产身份映射和最终事实 API，随后按独占范围实施字段保留、逐版本索引与范围求值；18 条声明迁移候选须逐条绑定来源，剩余 unknown 保持原状。本文没有修改其它协作者的方案、PRODUCT/START-HERE 或新增运行合同。
