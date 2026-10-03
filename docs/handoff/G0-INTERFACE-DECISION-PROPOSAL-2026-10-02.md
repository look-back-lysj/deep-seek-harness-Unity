# G0 前后端公开接口冻结提案（待用户确认）

日期：2026-10-02。状态：**讨论稿，未冻结；不得据此修改公共 contracts / Backend / Remote。**

依据：[Core 新增能力补齐计划 v1.2](CORE-NEW-CAPABILITIES-PLAN-2026-10-01.md)、当前 `d9190bf` 工作区、Core Backend 与 MarketService Remote 源码。内部纯函数、文件存储和测试都不等于 Client 已能调用。

## 1. 自动检查状态给前端怎么读

Core 现在已在 DSH Market Runtime 的 Cordis Fiber 生命周期里运行只读检查；状态保存在 `settings/update-check-state.json`，现有 `updatePolicyGet/Save` 和手动 `checkUpdates` 已公开。但目前没有读这个调度状态的公开 Backend/Remote，因此设置页能改策略、手动检查，**不能准确显示调度器上次何时运行、下次何时运行或最近一次后台结果**。

| 方案 | 合同形态 | 好处 | 代价 |
|---|---|---|---|
| A. 扩展维护快照 | 给 `CoreMaintenanceSnapshot` 增加可选的 `updateCheckSchedule` | 不多增加 Remote 方法；一次读取可同时展示插件维护状态和检查状态 | 维护状态 DTO 混入定时任务语义；包多时整份维护快照更重 |
| **B. 独立只读状态接口（主控建议）** | `updateCheckStatus()` 返回 `UpdateCheckScheduleSnapshot`，增加 `update-check-status` capability | 职责清楚；旧 Host 可只隐藏该区块；后续调度状态独立演进 | 多一个 Remote 方法、能力名与生成描述，需做合同/包版本兼容验证 |
| C. 暂不公开状态 | 暂时只保留 `updatePolicyGet/Save` 与手动 `checkUpdates` | 不改公共合同 | UI 只能显示偏好，用户看不到真实最近/下次后台检查，未达到计划中的可观测性目标；不推荐作为最终交付 |

若选 A 或 B，建议最小字段：`status: scheduled | disabled | checking | failed | unavailable`、可选 `lastCheckedAt`、`nextCheckAt`、`lastResult: UpdateCheckResult`、安全错误码 `lastError`、`generatedAt`。不要对外暴露异常堆栈、profile 路径或原始代理/凭据。策略关闭时 `nextCheckAt` 缺省；调度器未启动/状态损坏时明确 `unavailable` / `unknown`，不猜测成功。手动结果和后台结果应能区分来源。

## 2. 离线包独立导入通道（计划要求，不复用作者传输）

建议沿用计划中的 `artifactImportBegin / artifactImportChunk / artifactImportFinish / artifactImportDispose`：

1. `Begin`：文件名、声明大小、SHA-256 与受支持用途；返回一次性 `importId`、最大块大小、有效期和可接受限制。不得接受 Client 传本机绝对路径。
2. `Chunk`：`importId + sequence + base64 data`，严格顺序、单块上限、总配额、超时与取消；每次校验拥有者。
3. `Finish`：完整长度/摘要/ZIP/manifest/schema/目标 Host/制品交叉引用全部验证后，写入受控缓存并返回只读预览句柄；无效输入不创建可执行目录项。
4. `Dispose`：可撤销未完成上传/预览句柄；按 TTL 回收临时文件。句柄绑定可信 `callerId + environmentId + importId`，不得跨用户/Profile/环境复用。
5. 用户挑选预览中的可选插件后，`planCreate` 消费短期导入句柄与选项；Core 重新校验、冻结摘要、依赖、库存 revision 与安装计划，继续复用现有 task/锁/官方 DSH 回执。

不能复用 `authorTransfer*`：它的用途、配额、目标绑定、完成处理器和权限范围针对作者媒体/作者导入，不是安装制品；复用会混淆“写作者资料”和“准备安装”的安全边界。客户端字节分块编码可借鉴，但服务端通道必须分开。

## 3. Bundle 选择与计划绑定

建议公开 `bundleSelectionPreview`，输入为目录中明确的 `bundleId + version + catalogRevision + selectedIds`；输出为现有 `BundleSelectionGraph`、结构化阻断/依赖说明、过期时间和不可伪造的短期 `selectionToken`。计划创建接受该 token；Core 在消费时重新确认来源修订、目标版本、依赖闭包与 caller/environment，并把最终选项/摘要写入冻结计划。Client 只显示节点和勾选，不复制 Core 依赖算法。

重复预览、版本变化、目录修订变化、token 过期、跨 caller 使用都必须返回 stale/blocked 等结构化结果；不能把旧预览静默套到新版本。

## 4. 取消影响预览与二次确认

保留既有 `taskCancel` 作为兼容的普通取消入口；计划要求新风险型操作增加 `taskCancelPreview` 与 `taskCancelConfirmed`：

- 预览输入绑定 `taskId + 当前 task revision/digest + 目标包或选择集`，输出会停止的未执行项、正在进行且不可保证撤销的项、依赖影响、受保护/保留项及原因、短期 challenge/impactDigest。
- 确认请求必须回传该 challenge、摘要与幂等键。Core 在最终边界重读任务/库存/依赖；变化时失效预览并要求重看。确认只取消尚未派发的操作，不宣称回滚已发生的官方写入。
- 任务或官方调用结果不明时保留 `unknown`，禁止自动重放；受保护系统项、已明确安装项、其他任务/Bundle 所需依赖不可被级联删除。

可复用现有 `cancelSelection()` 的计算逻辑与 `PreservedCancellationItem`，但纯函数输出不能当作官方任务取消回执。

## 5. 精确方法/DTO 草案（供 G0 评审，不是已冻结代码）

下面用现有 DTO/命名作为起点，字段上限、块大小、TTL、错误码应与现有 `TransferManager` / ZIP 限额和任务锁逐项核对后才冻结。所有新增读写方法都按 capability 隐藏或降级；任何安全相关写入必须从 Remote 调用上下文取得真实 callerId，不允许 Client 自报 owner。

| 组 | 建议 Backend / Remote 方法 | 输入（JSON 安全） | 成功/业务结果 | capability / 防护 |
|---|---|---|---|---|
| 自动检查状态（B） | `updateCheckStatus()` | 无 | `UpdateCheckScheduleSnapshot`：status、最近/下次时间、最近 `UpdateCheckResult`、generatedAt、安全 error code | `update-check-status`；只读，Profile 范围；不暴露本机路径/异常细节 |
| 离线上传 | `artifactImportBegin(req)` | `filename,size,sha256`（可选声明 pack 类型/目标） | `importId,maxChunkBytes,expiresAt` 与 Host 公布的限额 | `offline-artifact-import`；绑定 caller/environment；总字节和并发额度 |
| 离线上传 | `artifactImportChunk(req)` | `importId,sequence,data(base64)` | `receivedBytes,nextSequence,complete` | 同一 owner；严格序号/块大小；重复块只按幂等规则接受，不能拼错字节 |
| 离线上传 | `artifactImportFinish(req)` | `importId` | 受控 `importToken`、包摘要/身份、目标兼容性、包/制品总数和短摘要；不直接安装 | 完整长度与 SHA256、ZIP/manifest/source/index/package/artifact 全校验后才物化到摘要缓存；token 短期、单 caller |
| 离线预览读取 | `artifactImportPreviewGet(req, callerId)` | `importToken,cursor?,limit?` | 一页 package/version/digest/size/可选成员和缺失依赖摘要、nextCursor/hasMore | 建议限制每页条数；token 绑定 caller/environment/TTL；只返回已验证元数据，不返回任意文件字节 |
| 离线上传 | `artifactImportDispose(req)` | `importId` | 已释放/已过期状态 | caller 绑定；只能清理未消费临时对象，不删其他任务引用的内容寻址缓存 |
| Bundle | `bundleSelectionPreview(req)` | `sourceId,bundleId,bundleVersion,sourceRevision,selectedNodeIds` | `graph, blockers, normalizedSelectedIds, selectionToken, expiresAt` | `bundle-selection`；目录版本绑定，Core 计算依赖闭包和环；只预览，不写插件 |
| 安装计划 | 现有 `planCreate(req, callerId)` 增加可选 `offlineImportToken` / `bundleSelectionToken` | 现有字段保留；token 与普通 selections 二选一或按严格组合规则 | 现有 `PlanResult`；计划冻结 catalog/inventory revision、package/version/digest、依赖和最终 enabled intent | 复验 token caller/environment/TTL/revision、制品摘要与兼容；一次确认只消费一份冻结计划 |
| 运行任务取消影响 | `taskCancelPreview(req)` | `taskId,taskRevision,selectionTargetIds?` | 逐项可取消/进行中/结果未知/受保护依赖清单，`impactDigest,challengeId,expiresAt` | `task-cancel-preview`；只读，检查并发任务、显式安装意图、库存和 unknown |
| 运行任务取消确认 | `taskCancelConfirmed(req)` | `taskId,challengeId,impactDigest,idempotencyKey` | 既有 `TaskState` 加保留项结果（若 `TaskState` 不适合承载，则单独 `TaskCancelConfirmedResult`） | 连接握手 + caller/environment 绑定；确认时重新计算；实际官方写入的取消/回执仍走原 TaskManager，不假装回滚 |

**待定的设计岔路：**

- 离线 `Finish` 可直接回传整份预览，方法少但最大 10,000 包上限下可能产生过大的单个 Remote 响应；或返回受控句柄，再用分页 `artifactImportPreviewGet` 查看元数据。提案推荐分页句柄，限制每页条数并允许安全重取。Remote 不向 Client 提供通用 `artifactRead`；安装仅需 Core 自己消费经校验的摘要缓存。
- Bundle 选择可每次签发短期 owner-bound token，或只传 graph revision 让 `planCreate` 重算；后者方法少但容易让用户确认的选项与最终计划漂移。提案推荐短期 token + `planCreate` 二次重算。
- 现有 `TaskCancelRequest` 普通取消必须保持兼容；新增影响确认是附加风险流程。第一批只做整个任务级预览/确认；不加成员级取消，直到 TaskManager 能为成员级停止提供真实持久化边界与回执。

建议的结构化错误族（最后命名需按仓库错误约定校准）：`artifact-import/unsupported|too-large|invalid-session|owner-mismatch|sequence-conflict|digest-mismatch|invalid-pack|expired`、`bundle-selection/not-found|stale|invalid-graph|expired|owner-mismatch`、`task-cancel/not-found|stale|impact-changed|protected|expired|owner-mismatch`。跨 caller、跨 Profile、跨目录 revision、文件摘要不符均须显式拒绝；已派发但结果不明保持 `unknown`，绝不以重试按钮自动重放。

### DTO 形状样例（名称可在 G0 评审中调整）

以下只是说明最小 JSON 形状，非源代码提交：

```ts
interface UpdateCheckScheduleSnapshot {
  schemaVersion: '1'
  status: 'scheduled' | 'disabled' | 'checking' | 'failed' | 'unavailable'
  generatedAt: string
  lastCheckedAt?: string
  nextCheckAt?: string
  lastResult?: UpdateCheckResult // 后台调度结果；手动结果仍由 checkUpdates 直接返回
  lastError?: 'automatic-check-failed' | 'state-corrupt'
}

interface ArtifactImportBeginRequest {
  filename: string
  size: number            // 压缩包总字节数，Core 设硬上限
  sha256: string          // sha256:<64 lowercase hex>
}
interface ArtifactImportSession {
  importId: string        // 随机不透明句柄，不是路径
  chunkBytes: number
  expiresAt: string
}
interface ArtifactImportChunkRequest { importId: string; sequence: number; data: string }
interface ArtifactImportFinishRequest { importId: string }
interface OfflinePackImportSummary {
  importToken: string
  packId: string
  sourceRevision: string
  targetAgent: string
  packageCount: number
  artifactCount: number
  compatible: boolean | 'unknown'
  missingRequirements: readonly string[] // 有界摘要
  expiresAt: string
}
interface OfflinePackPreviewPageRequest { importToken: string; cursor?: string; limit?: number }
interface OfflinePackPreviewPage {
  items: readonly { pluginId: string; packageName: string; version: string; artifactDigest: string; size: number }[]
  nextCursor?: string
  hasMore: boolean
  totalPackages: number
}
interface BundleSelectionPreviewRequest {
  sourceId: string
  bundleId: string
  bundleVersion: string
  sourceRevision: string
  selectedNodeIds: readonly string[]
}
interface BundleSelectionPreview {
  graph: BundleSelectionGraph
  blockers: readonly string[]
  selectionToken: string
  expiresAt: string
}
interface TaskCancelPreviewRequest {
  taskId: string // 第一批只取消整个未完成任务；不伪造单成员取消
}
interface TaskCancelPreview {
  taskId: string
  taskRevision: string
  impactDigest: string
  challengeId: string
  expiresAt: string
  cancellation: CancelSelectionResult
}
interface TaskCancelConfirmedRequest {
  taskId: string
  challengeId: string
  impactDigest: string
  idempotencyKey: string
}
interface TaskCancelConfirmedResult {
  task: TaskState
  cancellation: CancelSelectionResult
}
```

G0 还要冻结 `compatible: 'unknown'` 的精确定义；不能因网络不可达就报兼容或不兼容。初期可先接整个任务取消，但完整 G5/BND 验收仍要求成员级取消、依赖保护和 Force 二次确认，不能以整个任务支持代替最终目标。任何官方写入已派发时，预览必须标“当前调用不能假定已撤销”，确认仍等待真实回执。分成员取消只有等 TaskManager 能对成员级取消提供真实持久化边界和回执后再加，不能假装 `cancelSelection()` 已经取消了官方安装。

新的 `artifactImport*`、`bundleSelectionPreview`、`taskCancelPreview`、`taskCancelConfirmed` 都会分配/消费短期有状态句柄或改变任务，因此在 `MarketService Remote` 必须走握手；适配器通过 `remoteCaller().id` 传给 Backend 的额外 `callerId` 参数（非 JSON wire 字段），Core 绑定 `environmentId`。只有确认用户和线程归属一致、幂等键已绑定同一意图后才可复用结果。新任务级 Remote 不得只在 Client 做授权校验。

### 版本与旧宿主提案

当前源码是 Core API `1.0.0`、Remote Protocol `2.0.0`，兼容函数允许同主版本、提供方 minor 大于等于 Client 要求；新增方法仍应 optional 并以 capability 检查，不能只靠 semver 推定方法存在。若确认新增公开能力，建议 Core API 到 `1.1.0`、Remote Protocol 到 `2.1.0`；主控必须按 `docs/CORE-ADAPTER-GUIDE.md`、生成器和包验证重新核对版本门槛及旧 Host 矩阵。每个阶段构建都必须由 `scripts/build.mjs` 生成 Remote 描述，不手改生成产物。

## 6. 冻结顺序与共同验证

1. 用户确认第 1 节的 A/B/C。
2. 主控按以上 v1.2 边界冻结 JSON 合同表：方法名、输入/输出、capability、错误码、TTL/大小上限、caller/environment 归属、幂等/过期/取消/重启行为、旧 Host fallback 和序列化样例。
3. 公共类型与协议生成由主控串行修改；后端协作者仅改 Core/Runtime/DSH Backend 与专属测试；Client 只改 Client 和 browser tests，避免同一合同/文件被并改。
4. 每一能力都需证明 `internal -> Backend -> DSH factory -> MarketService Remote -> generated descriptor -> Client callsite -> UI state`；旧 Client/旧 Host 保持既有功能或清楚降级。
5. 代码级 `pnpm check` 与合成浏览器通过后，仍须在隔离 profile 的官方 DeepSeek Harness Desktop `0.2.0-rc.1` 验证：手动检查和调度的实际停止/恢复、离线预检和安装、Bundle 选项冻结、取消确认与未知回执。合成测试不代替官方验收。

除自动检查已有调度器外，上述新接口均**待用户确认 G0 后才实施**；本文不代表已完成。
