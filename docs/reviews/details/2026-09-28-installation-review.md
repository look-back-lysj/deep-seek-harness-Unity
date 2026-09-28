**安装链独立只读复查｜2026-09-28｜当前源码，不沿用旧 110 项测试结论**

结论：普通安装的取消、重启、恢复和确认边界仍有实证缺口；AI 正常确认链目前根本无法执行。不能仅补一行 `aiProposals.set()` 就开放 AI 写入，否则会暴露当前被这处阻断遮住的确认与执行问题。

本次只读取 `D:/eac-market` 与官方源码，写入仅发生在本次新建的 `D:/eac-market-verify/review-next/install-review`。没有构建或改写工程产物，没有修改业务、测试源码、官方源码或用户 profile；没有联网、UI 操作、真实模型请求、提交或发布。主控的 Desktop 实测不在本报告证据范围内。

收束时收到主控新证据：已通过官方插件页在 review-next 新 profile 安装并启用当前 A15 包；真实目录刷新误报已复现；首次草稿保存成功；fixture 新装仍待测。这些作为主控报告事实登记，不算本 Reviewer 亲测。没有把“未传草稿 ID”判成失败，未提出草稿保存缺陷。已只读确认首次提交为 `ea84b9f`，工作树干净；该提交由主控执行。主控告知只统一了 37 文件末尾空行，本次引用行号已重新核对。

重新执行当前范围内原有测试：12 文件、49 项通过，退出码 0，使用已安装的 Vitest 3.2.7 / Node 24.19.0，关闭测试缓存，并将输出定位到本目录。没有运行会改写工程 `lib` 的 `pnpm check`。测试明细见 [existing-tests.json](D:/eac-market-verify/review-next/install-review/existing-tests.json)，命令输出见 [existing-tests.log](D:/eac-market-verify/review-next/install-review/existing-tests.log)。47 个基线文件的前后摘要检查见 [integrity-final.json](D:/eac-market-verify/review-next/install-review/integrity-final.json)；摘要即文件内容的数字指纹。

证据分层：S＝当前源码可直接确认；P＝当前生产类配合合成服务的行为实证；F＝在本次独立目录使用真实文件锁或持久层；D＝真实官方 Desktop。以下没有 D 层结论。Host 指市场后台，库存指官方返回的已装包及运行成员清单。

**1. P1｜AI 提案从未登记，诊断输入也为空（S＋P，P01）**

位置：[market-runtime.ts:106](../../../packages/market/src/host/market-runtime.ts#L106)、[分析与确认入口:374](../../../packages/market/src/host/market-runtime.ts#L374)、[诊断导出:401](../../../packages/market/src/host/market-runtime.ts#L401)、[ai-assist.ts:50](../../../packages/market/src/host/ai-assist.ts#L50)。全局检索 `aiProposals` 只有初始化和读取，没有任何 `set`。

触发：用户对失败任务请求 AI 分析；假模型正常返回合法建议及正常结束事件，再把原样返回的提案 ID、影响摘要交给确认入口。

实证：分析返回 `ready`；模型收到 `diagnostics: []`；Host 内提案数为 0；确认返回 `blocked / 提案不存在或已过期`。因此旧报告“提案只在内存、重启才丢”的描述不准确，首次确认前就没有登记。空诊断还意味着模型没有任务错误、包版本、官方失败阶段或日志依据；不能称为基于证据排错。

影响：AI 主流程不可用，即使界面能显示建议也无法完成已选的确认后执行。空的诊断列表与提案未登记必须分别修复。

最小修复：按所选任务收集有界、脱敏、有证据编号的事实；Host 校验建议后保存提案，绑定环境、任务、确切对象、期限及执行记录。**须与问题 2 一起交付**，不能先单独打通保存。

验收：已知失败任务→假模型输入含对应错误及证据编号→合法建议可登记；拒绝、过期、跨环境均零写入；重启后可准确区分待确认、已执行与失效。验证脱敏与限长，而非只检查 `redacted: true`。

**2. P1｜普通管理绕过执行协调；AI 二次确认和重复执行保护不足（S＋P；AI 部分为受控注入后的潜在路径，P02/P11）**

位置：[普通启停与卸载:298](../../../packages/market/src/host/market-runtime.ts#L298)、[AI 只取首动作并直调管理:382](../../../packages/market/src/host/market-runtime.ts#L382)、[UI 自动 riskConfirmed:309](../../../packages/market/src/client/components.tsx#L309)、[宽松提案解析:14](../../../packages/market/src/host/ai-assist.ts#L14)、[错误映射:83](../../../packages/market/src/host/market-runtime.ts#L83)。公开入口仅转发这些方法：[index.ts:151](../../../packages/market/src/index.ts#L151)。

触发与实证：

- 普通管理传入旧 `expectedVersion`、相同 `idempotencyKey`，仍直接调用 Host；同一卸载请求调用两次，合成 Host 收到两次。没有进入安装任务执行器，失败结果中的 `errorCode/diagnostic` 也被丢弃。这个问题今天就能到达，不依赖 AI。
- UI 在第一次“执行”操作中，自动把卸载／降级的 `riskConfirmed` 设为 true，没有独立第二次影响确认。
- **仅在探针手工登记提案后**，两个动作的提案只执行首项；同一确认提交两次，首项被执行两次。模型建议包含未知字段 `confirmed/command` 仍被接受并丢掉字段；目标写成市场自身包名也未被市场层拦截。没有执行命令，`command` 只是被拒绝规则应捕获的测试数据。
- 安装类 AI 分支又重新从当前目录构造计划，固定 `enabledIntent: true`，不消费 `sourceId`，也没有先展示这份完整安装计划：[market-runtime.ts:393](../../../packages/market/src/host/market-runtime.ts#L393)。这些为源码确认的潜在执行问题。

影响：用户第一次同意可能被当成危险操作再次同意；已看见的多动作清单与实际执行不一致；重复确认可重复发出管理写入；旧版本条件、启停选择和可读错误不能可靠保留。

边界：当前正常 AI 路径先被问题 1 阻断，不能据此声称已发生真实危险卸载；未验证 Remote 调用身份能否伪造。官方安装器另有自己的文件锁和保护检查：[官方 index.ts:772](D:/deepseek-harness-source/deepseek-harness-master/packages/boot/plugin-manager/src/index.ts:772)。本发现不等于官方文件锁失效，也不等于已绕过官方核心服务保护。

最小修复：启停、卸载与安装共用市场执行协调和持久执行记录；执行前核对版本、目标归属、受保护组件和影响证据；提案使用严格字段及对象校验；重复确认返回原结果。卸载／降级必须有 Host 保存且绑定影响摘要的第二次确认，第一次确认不能发出写入。暂按单动作提案收口时，应明确拒绝多动作，不能静默截断；保留用户已选择的全部动作种类。

验收：普通安装、启停、卸载同时请求仍按同一规则协调；同键重放只有一次写调用；目标版本变化零写入；第一次风险确认零写入；拒绝第二次确认零写入；缺依赖／数据兼容证据不可执行；禁用状态更新后不被悄悄启用；结构化错误原样保留给诊断收集器。

**3. P1｜两类来源／验证证据只在库层存在，Host 没有接入（S＋P，P03/P13）**

位置：[OfficialHostPort 构造适配器:142](../../../packages/market/src/adapters/dsh/host-port.ts#L142)、[证据默认空数组:98](../../../packages/market/src/adapters/dsh/manager.ts#L98)、[无证据归类 unknown:84](../../../packages/market/src/adapters/dsh/manager.ts#L84)、[Host 组装计划身份:213](../../../packages/market/src/host/market-runtime.ts#L213)、[规划保护:253](../../../packages/market/src/core/planner.ts#L253)。

触发：官方返回一个已安装包，用户再次安装同版本、手动更新／降级，或为部分成功套餐生成新计划。实际适配器没有任何来源证据提供者，所有 `installed: true` 的包都会进入来源未知路径；没有从成功任务或真实依赖引用恢复市场归属。

实证：用当前 `OfficialHostPort` 和 `MarketRuntime.planCreate`，官方库存中的 1.0.0 请求更新至 2.0.0，得到 `source: unknown`、`action: blocked`、`local-identity:protected`。原测试的正例显式注入 `proven: true`：[inventory-diagnostic.test.ts:95](../../../tests/adapter/inventory-diagnostic.test.ts#L95)，不能证明真实 Host 的更新可用。

相关接线遗漏：Host 创建 `CatalogRepository` 也未提供第三个宿主证据参数：[market-runtime.ts:115](../../../packages/market/src/host/market-runtime.ts#L115)。仓库沿用空参数验证：[store.ts:112](../../../packages/market/src/catalog/store.ts#L112)、[store.ts:163](../../../packages/market/src/catalog/store.ts#L163)；验证器明确要求当前宿主信息：[validate.ts:358](../../../packages/market/src/catalog/validate.ts#L358)。P13 中同一份有效 Evidence 显式传宿主可通过，按真实 Host 构造方式刷新则失败：“标记 verified 但没有当前宿主证据上下文”。这会拒绝整份新目录并回退旧目录，**没有证明它会误放行伪证据**。

最小修复：把安装成功回执、确切包版本／摘要与实际依赖引用核对后，形成可恢复的来源证据；不能仅凭包名或内存 `proven` 标志放行。目录验证传真实宿主身份／版本／运行环境，正确处理不适用于本机的验证记录。

验收：市场安装→重启→同版保留／更新均可正确规划；本地 file/link/fork 仍受保护；证据与当前字节不一致时拒绝覆盖；同一合法目录在匹配环境与不匹配环境下产生可解释结果，不伪造“本机已验证”。

**4. P1｜确认的来源和安装前状态没有在真正写入点锁定（S＋P/F，P04/P10/P14）**

位置：[确认计划生成:303](../../../packages/market/src/core/planner.ts#L303)、[下载前复查:562](../../../packages/market/src/core/task-manager.ts#L562)、[实际安装调用:625](../../../packages/market/src/core/task-manager.ts#L625)、[状态比较:843](../../../packages/market/src/core/task-manager.ts#L843)、[制品适配器实时查目录:18](../../../packages/market/src/adapters/dsh/artifact-adapter.ts#L18)、[Host 原始 URL 刷新:183](../../../packages/market/src/host/market-runtime.ts#L183)。

触发与实证：

- 用户确认旧目录后，目录的同包、同版本、同摘要条目换了来源。请求仍带旧 `sourceRef`，但适配器完全不读取它，而调用当前 `deliveries()`。P04 用符合契约的 `https-artifact` 来源证明传给下载层的是新增、未确认 URL。没有联网，缓存层使用合成服务；**不表示摘要校验被绕过**。
- 状态复查发生在下载前，下载后直接安装。P10 在等待制品时把库存从 1.0.0 停用改为 9.0.0 启用且来源为本地 fork，随后仍调用安装，变成 2.0.0 停用并报告完成。`findDrift` 也只比较存在与版本，未比较启停、来源、运行宿主、来源集合等已确认条件。
- 库存读取失败只记入 `unknownItems`：[manager.ts:126](../../../packages/market/src/adapters/dsh/manager.ts#L126)；`OfficialHostPort.readState` 的 stable 判断只基于包管理进程记录：[host-port.ts:154](../../../packages/market/src/adapters/dsh/host-port.ts#L154)。P14 在 `listBundles` 失败时仍观察到安装写入口调用。该补充探针使用真实 JSON 持久层和事件日志，复查连续三次均得到同一结果。
- Host 的目录刷新直接使用请求 URL，没有调用已实现的登记来源表／`refreshWithSource`；这是静态接线证据，未进行真实请求。

影响：用户确认之后新增的地址、外部版本或启停选择可以影响实际执行；库存读取错误还会被误当作“没有安装”，使写入在不完整事实下开始。只证明摘要相同不等于来源清单也已获得确认。

最小修复：计划冻结来源描述及其内容摘要；下载完成、脚本批准返回、恢复执行之后，在每次官方写调用前重新核对完整前提；来源与启停变化必须使旧计划失效，库存关键事实未知时停止对应操作。目录刷新接入登记来源。

验收：确认后变更来源、宿主、版本、启停或本地包身份，均暂停并展示新差异；允许清单内同摘要备用源可以继续；目录文字更新不应无故影响执行；库存失败不得发出安装调用；确认过的摘要不能用新文件摘要自我替换。

**5. P1｜把“文件已更新、旧实例还活着”当成目标版本已运行（S＋P，P05）**

位置：[从 unknown 行推断重启:183](../../../packages/market/src/adapters/dsh/manager.ts#L183)、[restartRequired:201](../../../packages/market/src/adapters/dsh/manager.ts#L201)、[安装结果更新事实:696](../../../packages/market/src/core/task-manager.ts#L696)、[active 推断:806](../../../packages/market/src/core/task-manager.ts#L806)、[消费者放行条件:833](../../../packages/market/src/core/task-manager.ts#L833)、[伪会话修订:178](../../../packages/market/src/adapters/dsh/host-port.ts#L178)。

触发：已安装前置包更新，官方返回 `restart-required`；磁盘包版本变为 2.0.0，但同一进程仍有旧插件成员处于 active。适配器见成员不 unknown，给 `restartRequired: false`；核心据“已安装＋配置启用＋不需重启”推断 active，既未核对目标运行版本，也未要求所有成员正常。

实证：P05 原始回执要求重启，前置项仍显示 `restart-required`，但消费者已经收到安装调用并显示 `enabled`。从始至终使用同一个旧运行成员 ID，没有模拟重启。为单独验证此缺陷，探针给规划器提供了已证明的市场归属；真实更新入口另受问题 3 阻断。

官方依据：[官方 index.ts:305](D:/deepseek-harness-source/deepseek-harness-master/packages/boot/plugin-manager/src/index.ts:305) 的版本来自磁盘 manifest；[官方 index.ts:560](D:/deepseek-harness-source/deepseek-harness-master/packages/boot/plugin-manager/src/index.ts:560) 对既有依赖更新直接返回 `restart-required`。磁盘版本和运行实例不能互作证据。

最小修复：保留官方重启屏障，直到真实宿主启动身份及所需运行成员状态证明目标版本生效；active 不能从配置布尔值推出。不能用包数量／包版本串代替进程启动身份，也不能把市场服务重新创建误认为宿主重启。

验收：旧实例仍 active、成员 load-error、成员缺失均不得放行依赖目标 active 的消费者；真实重启且核实目标成员后，经用户确认才继续；不重复安装已经成功的前置项；全部完成后取消重启等待。

**6. P1｜取消在生产锁下不能及时阻止后续写入（S＋P＋F，P06/P07）**

位置：[整段任务持有锁:515](../../../packages/market/src/core/task-manager.ts#L515)、[取消等锁后才记意图:365](../../../packages/market/src/core/task-manager.ts#L365)、[检查取消的位置:558](../../../packages/market/src/core/task-manager.ts#L558)、[下载未传取消信号:584](../../../packages/market/src/core/task-manager.ts#L584)、[真实文件锁:87](../../../packages/market/src/adapters/dsh/persistence-adapter.ts#L87)。

触发与实证：两组件任务，用生产 `AtomicProfileLocks`，安装和下载使用合成服务。

- P06 下载第一个组件时取消：此时尚无官方 requestId，取消请求等待整段任务释放锁；取消标记仍为 false。放开下载后 a、b 均进入安装，取消请求最终返回 `completed`，官方取消调用为 0。
- P07 第一个组件安装中取消：取消信号到达 Host，第一个组件返回 cancelled；但市场取消标记仍等着锁，第二个组件继续安装，最终 `partial`，两个结果是 `[cancelled, enabled]`。

影响：即使用户在尚未开始写入或尚有剩余组件时取消，后续安装仍可能发生；不能把当前代码评为完整取消竞态修复。

测试缺口：常用 [helpers.ts:70](../../../tests/core/helpers.ts#L70) 允许同 owner 重入；[install-state.test.ts:73](../../../tests/core/install-state.test.ts#L73) 的非重入正例只验证信号送达，没有验证剩余组件零写入。官方取消保证的是它持有的单次安装停止及文件恢复：[官方 index.ts:579](D:/deepseek-harness-source/deepseek-harness-master/packages/boot/plugin-manager/src/index.ts:579)，不能代替市场停止后续组件。

最小修复：将整次执行占用与短时状态记录锁分开；取消立即记录并使下载可中止；每次写入前重读取消状态。正在执行的官方写入必须等真实回执，不能为提高取消速度提前放走下一个写入者。

验收：生产锁＋真实持久层覆盖下载中、等待脚本批准、第一组件安装中、最后回执到达四个时机；取消后未开始的组件零写入；过晚取消显示完成；结果不明保持待核对；不得提前释放环境写占用。

**7. P1｜中断恢复会重放未知旧安装；持久索引也存在断点缺口（S＋P/F，P08/P12）**

位置：[恢复入口:208](../../../packages/market/src/core/task-manager.ts#L208)、[生成剩余挑战:444](../../../packages/market/src/core/task-manager.ts#L444)、[复用未完成 attempt:577](../../../packages/market/src/core/task-manager.ts#L577)、[再次 install:625](../../../packages/market/src/core/task-manager.ts#L625)、[先摘要后索引:100](../../../packages/market/src/persistence/task-store.ts#L100)、[只从索引列任务:113](../../../packages/market/src/persistence/task-store.ts#L113)。

触发：进程在已发出安装、未持久保存回执时中断；新进程发现包已是目标版本。恢复逻辑刷新了 installed 事实，却仍把原 installing 项放进“剩余清单”；没有从官方旧请求状态与磁盘证据判断这一次写入是否已完成。

实证 P08：恢复前磁盘库存已为 2.0.0；仍生成剩余 `p0`；确认恢复后重新调用 requestId 为 `old-request-with-missing-receipt` 的安装，并报告 completed。这是旧调用的重放，而非证明此前调用未发生。

官方 `waitForInstall` 只保留活动请求，返回 null 不能证明成功或取消：[官方 index.ts:569](D:/deepseek-harness-source/deepseek-harness-master/packages/boot/plugin-manager/src/index.ts:569)。当前 HostPort 虽声明该官方方法，恢复没有消费它，更没有完成核对后再决定是否新建重试。

实证 P12：实际 `JsonTaskStore` 写完 summary 后，在写索引处注入失败，重建 store 后按 ID 可以读摘要，但 `list()` 返回 0。该子项证明历史／恢复可见性缺口；不能据此额外断言已发生重复真实安装。原持久测试主要验证第一步原子写失败：[task-store.test.ts:41](../../../tests/persistence/task-store.test.ts#L41)。

最小修复：未知旧尝试先核对；能证明目标已生效则结算，不能证明则停在待核对，不能复用旧请求重装。确需重试须由用户明确发起新计划／新尝试，保留旧关联。为摘要、索引和事件顺序建立可恢复提交协议，并能发现未入索引摘要。

验收：分别在官方调用前、调用后、回执前后、摘要和索引之间中断；恢复后旧未知调用的重复次数必须为 0；成功项保留；损坏／孤立记录可见且不静默当空；每个未确定状态给出下一步核对入口。

**8. P1｜防重只认 planId，等价活动意图会再执行，重试关联未保存（S＋P＋F，P09）**

位置：[计划每次生成新 ID:308](../../../packages/market/src/core/planner.ts#L308)、[只按计划查旧任务:304](../../../packages/market/src/core/task-manager.ts#L304)、[任务构造未保存 retryOfTaskId:317](../../../packages/market/src/core/task-manager.ts#L317)、[关联字段契约:348](../../../packages/market/src/contracts/types.ts#L348)、[AI 把提案 ID 当任务 ID:397](../../../packages/market/src/host/market-runtime.ts#L397)。

触发：第一个任务尚在等待脚本批准，另一个标签或另一轮预检为同包／版本／摘要／启停意图创建新计划；使用相同幂等键提交也不能关联到前一个任务。幂等指同一次操作重复提交只执行一次，不等于仅在单个 planId 内查重。

实证：同一个 planId 再提交确实复用原任务；等价新 planId 则新建第二任务，安装调用从 1 次变成 2 次，第一任务仍 awaiting-approval，第二任务 completed。传入真实旧任务 ID 的 `retryOfTaskId`，持久记录中仍为 null。旧报告称任务管理器“读取并保存该字段”不成立，当前实现根本未读该字段。

影响：新计划身份解决了旧摘要冲突，但没有同时实现运行中意图防重；审批状态可出现相互冲突的任务，重试历史也无法追溯。生产文件锁仅串行化写入，不能消除重复意图。

最小修复：分别保存“安装意图”“不可变计划实例”“执行尝试”的身份；对仍活动的等价意图原子复用或明确阻止冲突；失败已核定后才允许明确新重试。持久保存真实旧任务关联，AI 提案关联另设字段。

验收：双标签各自创建等价计划，在下载、安装和等待批准时均只对应一次有效执行；同计划重复确认始终返回原任务；正常失败后的新重试可执行且旧现场不变；未知任务先核对；提案、计划、任务能分别追溯。

**下一阶段候选路线：本次仅建议，不实施，不替用户决定新产品范围。**

优先顺序建议：先修 3/4/5/6/7/8 的普通安装基础与问题 2 的统一管理入口；再把 1/2 的 AI 登记、诊断、确认一起接通；最后由主控在最终包上走真实官方 Desktop 场景。AI 诊断收集和严格解析可以先做独立工作，但不能以补 set 提前开放写入。

| 取舍 | A：建议的最小修复 | B：备选及代价 |
| --- | --- | --- |
| AI 动作清单 | 每个提案严格一项动作；各允许动作种类均保留；易验证、不会静默漏动作 | 完整多动作方案与全部必要确认；用户少点几次，但需要依赖顺序、部分失败和取消设计 |
| 写入协调／取消 | 保留现有执行器，分离执行占用和短时记录锁，所有管理入口接入；改动集中 | 引入持久命令队列；恢复与并发更统一，但重构和迁移范围更大 |
| 状态持久化 | 保留 JSON，加提交记录、索引重建和故障恢复；依赖少 | 事务型存储统一任务／确认／索引；一致性边界清楚，但增加依赖、迁移和部署验证 |
| 来源绑定 | 计划保存完整来源描述及摘要，安装只消费已确认描述；允许清单内换源 | 任何来源修订变化都重新确认；实现简单，但无关目录变动可能增加用户操作 |
| 库存来源证明 | 安装回执与当前官方依赖引用、字节摘要匹配；满足市场自身更新 | 再支持外部注册表包的来源认领；覆盖更广，但需要额外身份规则和样例 |
| 重启后继续 | 保存官方重启要求，核实真实宿主启动与目标成员后续跑；可完成既定流程 | 对无法核实的目标提供人工核对与重新规划；实现较小，但只能作为受限回退，不能宣称完整自动恢复 |
| 中断旧尝试 | 核对原结果和磁盘，无法确定时保留待核对；防止重放 | 用户明确新建重试并展示不确定性；恢复更灵活，但前置未知影响仍不能靠免责文字放行 |
| 等价意图防重 | 活动意图索引复用同一个任务；符合已定重复点击体验 | 按受影响包拒绝冲突任务；实现较小，但需要额外返回“查看已有任务”的流程 |

验收职责：安装负责人承担 3/4/5/6/7/8 与生产锁／持久层组合测试；主控冻结新增契约并接齐 Host；AI 与 UI 负责人共同承担 1/2 的诊断输入、真实第二次确认和准确动作清单。真实 Desktop 必须使用当批最终包，逐项记录操作前库存、官方回执、操作后库存、重启前后状态和实际写调用次数；不能用单元测试代替这些记录。

**复现材料与未证实范围**

- 主探针源码：[probes.ts](D:/eac-market-verify/review-next/install-review/probes.ts)；构建脚本：[build-probes.mjs](D:/eac-market-verify/review-next/install-review/build-probes.mjs)。运行仅使用现有本地 esbuild，不下载依赖。`node build-probes.mjs` 后 `node probes.bundle.mjs`；追加 `P06` 等参数可只跑指定探针。每次生成独立 `probe-run-*`。
- 首批 P01–P12 输出：[observations.json](D:/eac-market-verify/review-next/install-review/probe-run-2026-09-28T04-56-44-951Z-13264/observations.json)。P04 初稿曾使用非契约的来源 kind；已修正探针数据为 `https-artifact`，本报告使用修正后的独立复现：[P04](D:/eac-market-verify/review-next/install-review/probe-run-2026-09-28T05-03-03-807Z-4992/observations.json)。旧现场完整保留。
- 补充源码：[boundary-probes.ts](D:/eac-market-verify/review-next/install-review/boundary-probes.ts)，用 `build-boundary-probes.mjs` 构建后运行 `boundary-probes.bundle.mjs P13` 或 `P14`。[P13 原始证据](D:/eac-market-verify/review-next/install-review/boundary-run-2026-09-28T05-00-12-291Z-30660/observations.json)、[P14 复查证据](D:/eac-market-verify/review-next/install-review/boundary-run-2026-09-28T05-01-47-459Z-10804/observations.json)。
- P14 首轮曾未进入安装而停在 queued，事件日志已出现下一条事件。增加只记录并重抛错误的观测后成功复现目标问题，随后三次新目录复查均一致。**首轮停滞原因未证实，未单独列为产品缺陷**，失败现场和日志均保留。没有把失败试验删掉或计为通过。
- 提案注入只用于揭示被 P01 遮住的后续代码，未修改工程，未调用真实官方写入。缓存探针只观察传给下载层的来源；未下载恶意制品，未证明摘要绕过。中断探针是合成旧记录，未声称本次真实杀进程恢复。
- 未实测：真实 Desktop 的全部写入、真实模型生成及供应商取消行为、真实目录网络／镜像回退、Remote 客户端身份可信边界、真实宿主重启与业务可用性。本次没有 UI 或模型证据，不能关闭对应验收项。
- 主控新增的官方插件页安装／启用证据，补上了旧报告中该路径未验的事实缺口；不再把它列为本轮问题。上述八项仍针对当前安装状态机与 AI 接线，不能由市场包自身加载成功推定通过。按用户最新要求到此收束，不扩大审计。
