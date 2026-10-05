# @dsh-eac/market-core

EAC 市场的无图形界面业务包，Node 24+。普通用户安装 `@dsh-eac/market` 桌面入口，由包管理器取得本包；本包本身没有 DSH bundle，不应填入官方「添加插件」作为独立应用。

当前源码候选为 `0.1.6`，配套桌面适配器 `0.1.0-mvp.17`，尚未正式发布。自动取得依赖已在本地测试源验证，不能据此认定公网包仓库已有本包。正式安装状态以仓库 README 和发行站为准。

## 后端协作者入口

维护 Core、Host、目录或 DSH 适配器前先读仓库 [后端协作者指南](../../docs/handoff/BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)。该指南说明当前候选状态、发现页可选投影、旧 Host 兼容、失败语义和验证命令。

## Agent Forge 展示媒体

目录API的plugin/listing可选`media`包含`icon`和有序`previews`；图片继续使用`id/alt/sourceUrl`，新增可选`theme=light|dark|system`。完整package记录是画廊权威，index至多首张预览的摘要不能当完整历史或画廊。可执行制品的完整预览同时投影到既有`screenshots`及`presentation.media`，旧记录不补造图片。

输入校验保留原URL、alt、顺序和声明主题；字符限制按Unicode码点，不能因UTF8字节或UTF16长度丢弃合法上游文本。后端不下载、缓存、代理图片或执行皮肤代码，只返回JSON引用。媒体存在不提高许可、审核、宿主适配或安装授权；loading、失败重试、放大和展开均由Client实现。实现和实测边界见[media接线计划](../../docs/handoff/AGENT-FORGE-MEDIA-PLAN-2026-10-05.md)。

## 公开入口

| import 路径 | 用途 | 运行要求 |
| --- | --- | --- |
| `@dsh-eac/market-core` | 业务接口类型、通信类型、版本常量 | 浏览器安全；导入不创建运行时 |
| `@dsh-eac/market-core/contracts` | JSON 数据合同、通信协议版本 | 浏览器安全 |
| `@dsh-eac/market-core/compatibility` | Core API 版本和兼容判断 | 浏览器安全 |
| `@dsh-eac/market-core/semver` | 插件版本比较 | 浏览器安全 |
| `@dsh-eac/market-core/dsh` | `createDshMarketBackend`、启动参数类型、宿主范围与发行事实评估 | Node；创建后端需要官方 DSH 宿主 |

只使用 `exports` 中列出的入口。`lib/types` 的内部声明为编译器解析提供，不是允许跨包调用的内部实现 API。禁止导入源码相对路径，或把 UI/React 放回 core。

`MarketBackend` 是显式业务门面，包含目录、库存、预检、任务、管理、作者工作区和 AI 提案接口。不暴露 Cordis Context、任意文件路径操作、原始执行器或官方管理器。正式类型以 `src/api.ts` 为准。

## 宿主范围与发行事实

`/dsh` 入口提供 `evaluateHostCompatibility(hostCore, requirements)` 和 `evaluatePackageReleaseFacts(hostCore, packageName, candidates, catalog, inventory, options)` 两个只读函数；调用它们不创建后端、不联网、不安装，也不返回前端默认选择。

- Adapter 必须提供已确认 Agent 身份及版本域的宿主快照。未知版本、未指定版本规则或未知范围保持 unknown；不能以旧 hostVersion、market-core 或协议版本替代。
- Agent Forge 的 target.versionScheme 原样保留，缺省不补值；package engines.dsh 与核心 peer 使用 npm 范围规则。只评估明确的 npm/semver，其他规则保留 unknown。
- `semver@7.8.5` 是直接运行依赖，负责范围语法；原 `/semver` 精确排序工具保持不变。范围交集、OR 空洞、预发行排除和空允许集分别处理，不以字符串不同或最低版本猜结论。
- 已安装、最新有效发行、最新核心适配发行分别返回；制品和实测验证是独立维度。较新适配版缺制品不使 latestCompatible 退回旧版，相同 precedence 的多个 build 身份返回歧义。
- `ReleaseCandidate.publication` 只能来自已接受发行/生命周期事实，不能以硬不兼容或缺制品替代撤回状态，也不能接受 Client 自报发布状态。原始字节及摘要在目录校验层绑定。
- Forge dsh 已明确登记为 DSH runtime 域，由 Adapter 调用官方 getDshRuntimeVersion()。Backend.hostCore()/releaseOptions() 及 hello 增量字段已接线，checkUpdates.releaseSummary 复用同评估器；Client 默认选择和完整 releaseContext 已接线，完整官方升级/降级仍待验。这些只读能力不等于写入授权或官方 Desktop 验收。

## 管理业务回执与恢复

启停/卸载沿既有执行锁与管理记录协调。官方回执、后置核实、维护意图提交及完整业务凭证分别保存；成功或restart-required只有在维护提交和完整凭证耐久保存后才能作为完整业务结果恢复。凭证绑定原请求fingerprint、原官方结果、维护revision及业务结果，不依赖当前库存推断历史成功。

`pluginActionRecover`只读取原记录，不调用官方管理器、不补写维护状态。旧记录缺完整凭证仍返回unknown；损坏凭证拒绝。显式再次调用原管理请求可在目标仍与原回执一致时补提交维护结果，但不会重放官方动作；已完成原请求直接返回历史业务结果，不能让新库存变化改写原事实。后端不保存页面loading、超时、重试或导航中间态，也不创建第二任务系统。

## 创建与调用

DSH adapter 从当前宿主取得 Context、profile 身份、专属数据目录，读取自己随包目录的**原始字节**，再创建后端：

```ts
import { createDshMarketBackend } from '@dsh-eac/market-core/dsh'

const backend = createDshMarketBackend(ctx, identity, dataDirectory, {
  marketVersion: adapterVersion,
  embeddedCatalogBytes,
})
const inventory = await backend.inventory()
```

上述变量均由可信 Host adapter 提供；不是 Client 可以指定的参数。缺少目录字节时拒绝启动，不回读开发机路径。公开 `DshMarketBackendOptions` 强制要求字节；对象形式的 `embeddedCatalog` 只留在内部旧测试构造器，不属于公开工厂选项。

`planCreate`、`taskStart`、`aiAnalyze`、`aiConfirm` 必须传可信连接的 `callerId`。调用方不得用用户传入字段或固定 `local-operator` 代替身份。其他方法的审批和任务校验仍由既有业务链执行；工厂不是安全沙箱，不应向不可信脚本直接暴露。

一个 DSH profile 由一份 `eacMarket` 服务拥有后台。未来 TUI 应复用该服务，或在自己的明确 profile 中创建一份；不能让多个 UI 各自创建同 profile 后台。已有文件锁只协调市场任务，不代表能阻止所有外部工具写入。

## 版本与升级

- 源码包版本：`0.1.6`；Provider Core API：`1.1.0`；页面 Provider 协议：`2.1.0`。Client 最低要求仍为 Core API1.0/Remote2.0；三者用途不同，源码候选不是已发布版。
- API 小版本只增加兼容能力；删除字段、重解释结果、改变失败意义须升主版本并增加迁移测试。
- 页面通信 v2 要求每个连接先协商再写；它不替代用户确认。旧 v1 页面需要刷新/重启。存储格式此次未变。
- Adapter 固定依赖经验证的 core 版本。仅发布新 core 不会自动升级用户已安装实例。
- DSH 的加载/安装规则仍由官方决定。本包不绕过官方兼容限制，不提供任意命令安装器。

## 维护入口

- [`src/api.ts`](src/api.ts)：后端接口清单。
- [`src/dsh.ts`](src/dsh.ts)：DSH 工厂与显式接线。
- `src/core/`：计划、执行协调、版本算法。
- `src/adapters/dsh/`：官方回执、存储与安装适配。
- `src/catalog/`、`delivery/`、`persistence/`、`authoring/`：各业务模块。
- `src/host/`：应用服务组织与 AI 规则；内部实现，不供 UI 直接引用。

仓库开发、发行、迁移及分工见 [拆包维护指南](../../docs/CORE-ADAPTER-GUIDE.md)。TUI 是后续接入目标，本次不交付 TUI 产品。
