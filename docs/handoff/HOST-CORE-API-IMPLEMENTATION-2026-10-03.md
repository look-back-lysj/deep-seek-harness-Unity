# DSH 运行时绑定与只读版本 API：第三批实现

日期：2026-10-03。分支：`refactor/market-core-adapter`；HEAD 仍为 `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。工作区包含此前各批未提交修改，未覆盖未知文件、提交、推送或发布。

状态：**产品版本域已明确，官方 getter 接线、只读列表/更新摘要与部分计划安全复验已实现；前端新选择流程、releaseContext 与公开原操作恢复查询尚未完成。** 真实宿主仍未验收，不能把本批写成整个方案完成。

## 最新产品决定与身份

主人确认：Forge `agentId=dsh` 的核心范围对应 **DSH 运行时版本**，不使用 Desktop 发行号。官方实际加载的 `@deepseek-ai/dsh-app-boot.getDshRuntimeVersion()` 是当前读取入口；这项明确登记替代第二批仍待确认的版本域决策。

- Adapter 每次读取 getter，不冻结构造时值；缺 getter、读取失败或非法版本返回 unknown/null，绝不回退 Desktop、market-core 或协议版本。
- 保留旧 hostVersion 的原义和兼容读取路径。新 hostCore 独立含 agentId=dsh、agentName=DSH、版本/规则、读取来源和稳定 revision；同值不因读取时间变化而换 revision。
- 错误不包含官方异常、Profile 路径、凭据或 stack。可信 Core 调用者没有 readHostCore 时绑定仍未知，不能由 Client 自报版本。
- Node helper 从 Client 编译图排除；根合同继续浏览器安全。

## 本批实现

### 只读 API

- `hello.hostCore` 可选增量字段；`hostCore()` 单独只读方法；capability `host-release-options`。
- `releaseOptions({ packageName, includePrerelease?, cursor?, limit? })`：仅接受已收录包名、通道和分页，不接受 URL、路径、Client 宿主版本或临时来源；默认 limit20、最大100。
- 返回同次评估上下文、真实 installed、latestPublished、latestCompatible、独立兼容/制品/verification、完整身份/可信出处、历史覆盖、合并问题及分页。
- latest 对完整接受集合求值，不以当前页猜最新。cursor 绑定环境、宿主、目录投影、库存、通道和实际发行事实；来源/撤回/stale 内容变化即使 revision 未变，也不可拼旧页。
- 研究 listing 不制造可安装发行或 releaseId；缺历史/未知总数返回 null，不从 versions 标签补造旧版。
- `checkUpdates.releaseSummary` 复用同评估器。旧平面字段及粗 status 保留供旧 Client；新调用者应读摘要，不用旧 incompatible 推断核心过旧。
- 不返回 defaultReleaseId、loading、modalStep、按钮状态、轮询策略或前端文案。后端只读方法不刷新、下载或安装。

### 来源与生命周期

- publication 是校验后 v2 正式 release/status 的事实；旧 v1 无正式状态返回 unknown，raw 自报字段忽略；硬不兼容/缺制品不等于撤回。
- 已知撤回优先于旧镜像。接受历史损坏时不能仍宣称 active；未知生命周期保守阻断但不补造撤回。
- `CatalogRepository.sourceSnapshot()` 同步返回单次投影和已接受的 publication provenance；Runtime 从同批来源快照合并，库存 await 后复核完整稳定摘要，结果不再重读来源拼接。
- `ReleaseOption.sources` 仅用可信 publication 身份或原始 Agent Forge 声明的上游 sourceId/sourceRevision。内部配置槽位/本地投影 revision 与上游出处分开，无证明保留 sources[] 和 release-source-unknown。

### 计划保护与兼容

- 旧预检入口不能绕过已知范围不适配；unknown 缺数据沿用既有安装路径，不增加试装勾选。keep 零写入项不施加新下载/范围门槛。
- 动态 hostCore revision 增量进入 HostFingerprint。真正新任务在幂等既有任务返回之后复验核心/能力；每次实际写前继续核对发行与核心适配，不静默换版本。
- 这还不是完整 releaseContext：所选来源/metadata/context 明确冻结、分页选择到计划的合同映射及原操作恢复查询仍需后续串行设计。
- Provider Core API **1.1.0**、Remote **2.1.0**；Host 要求 Core1.1。Client 最低要求仍 Core1.0/Remote2.0，新接口为 optional，旧 Host 不会因最低握手被新 Client 拒绝。
- 源码包仍 Core0.1.6/Adapter0.1.0-mvp.17，本轮未发布；不能覆盖同版正式制品。生成 Typert 通过构建产生，不手改产物。

## 并行协作与复核

三个真实 subagent 独占宿主 helper、update-check、publication 投影；主控处理公共合同/协议、列表采样与分页、Runtime/Remote/Client 声明、store 降级、计划保护和串行验证。

独立复核复现了同 revision 撤回混读和本地来源槽位冒充上游出处。修复后 6 个只读 probe 确認拒绝同 revision 的撤回/stale/metadata 变化，并核对真实出处/无证明缺项；复核关闭，全部 agent 已关闭。

## 最终验证

- 最终串行构建与聚合 typecheck 通过；生成新的 Host/Client/Remote、两个独立包入口。
- 全量 `vitest run --maxWorkers=3`：91 文件中 89 passed / 1 failed / 1 skipped；**1242 passed / 1 failed / 2 skipped**。唯一失败仍为基线 `tests/client/dialogs.test.tsx:94` 的旧 `<details><summary>` 选择器；TaskDrawer 原有 class/ARIA 与该测试本批未改，不降低标准或宣称全绿。
- 新宿主 helper57、publication31、列表builder35、Runtime7、真实生成codec4测试通过；update-check48、Client Remote40与旧协议94等回归通过。
- 首次小批并发回归有一次既有 AI wiring 用例超过5秒，未修改 timeout；原配置专属复跑与最终全量均通过，保留为环境时延观察，不写成产品缺陷已修。
- 真实生成 codec 接受新数据合同；官方 object codec 对额外字段采用剥离而非拒绝。输入 API 本身独立严格拒绝不支持的字段，不能把 codec 的 mode strict 误称每个额外字段都会报错。
- verify-package：**84 包文件、39 Remote descriptors**、独立 Core 外部依赖及浏览器边界通过；lint / git diff --check 通过，仅 dry-run，不发布。
- 隔离无头 Edge `browser-check` **49/49通过**，证据 `.verify/host-release-api-browser-20261003/browser-results.json`。这是既有页面/旧 Host fallback 回归，不是新版本选择流程或官方 Desktop 实机验收。
- 通过公共 Backend 合成完整调用链验证：核心1.0.0时最新2.0.0提示 core-too-old，适配最高1.5.0保留；getter改2.0.0立即更新并拒绝旧cursor；预检/旧计划不适配拒绝时零下载、零官方写。合成版本不是正式插件要求。
- 未读取真实用户 Profile、启动官方 Desktop、联网刷新真实目录、安装第三方插件、发布或推送。此前 `.pnpm-store/` 本地缓存副产物仍保留，不可提交。

## 下一步

1. HC-3 余项：冻结 releaseContext/可信来源/metadata 摘要到计划并在写前复验；补既有 management/task 幂等意图只读恢复查询，不建立第二任务系统。
2. HC-4：前端消费新能力默认选最高可选适配升级，保留有效手选；说明核心过旧/未知/冲突，缺适配历史不声称全无；加载/确认/等待/超时/轮询保持前端状态。
3. 修复 TaskCard 在 updatedAt 变化时误释放在途锁、重新核对不应再刷新和丢sourceId等已审查交互，并由 Client owner 收口旧任务记录测试。
4. HC-5：串行最终回归、隔离发行、真实官方 Desktop0.2.0-rc.1 Windows验收；该发行号只指定验收载体，不参与核心兼容比较。历史版本采集与8MiB超限来源缺口仍按审计处理。
