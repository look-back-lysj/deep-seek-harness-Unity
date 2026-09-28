# 下一模型：多智能体执行与接力提示词

日期：2026-09-28。先读 [START-HERE](START-HERE.md)。当前任务的下一轮是**修复已有市场并落实已定接入能力**；本轮只交复查、方案和私人仓归档。不要执行旧 v1 的从零建项目提示词。

## 1. 主控开场提示词

下列文本供用户发起下一轮实施；文档中的文字不是新的对外授权。

```text
请接手 Deep Seek Harness Unity / EAC 市场的下一阶段实现。
先完整读 D:/eac-market/docs/handoff/START-HERE.md，再读 PRODUCT.md、
reviews/2026-09-28-independent-review.md、NEXT-STAGE-PLAN.md、
ECOSYSTEM-INTERFACES.md、本文件、AI-ASSIST-RULES.md 和旧 ACC 验收登记。
核对当前 git 状态、最新远端、官方 DSH 公开类型和实际版本；不能用旧报告代替当前事实。

已有实现位于 D:/eac-market，真正插件包在 packages/market。
先修 REV-01 至 REV-15 的真实问题，再完成 E01–E07 接入实物；
依据 G0–G6 阶段执行。普通安装先可靠，AI 诊断可并行准备，写入晚于执行门槛。
首页只完成可维护结构和使用路径，正式精选与全家桶名单后续补。
作者发行包优先＋授权团队构建都支持；团队内置＋独立合作DSH插件扩展都支持。
三个主导航固定，在线作者平台与所有 Star 不做。

必须用真实多子智能体工具。主控冻结共享接口及独占文件后，最多3名worker并行；
按本文件两波分工，完成者及时释放。不要创建用户要自己管理的新聊天代替子智能体。
子智能体必须读到共同约束和具体文件，不只让它们“参考上文”。
主控亲自核对关键跨层调用并操控最终官方 Desktop 包；不能只转发worker结论。
UI实际调用impeccable技能，保留官方主题、清晰流程、键盘及窄屏；不套营销模板。

工作只在市场工程和 D:/eac-market-verify 新批次内；官方源码、EAC组织仓、
守岸人、真实用户profile只读。不要读取或复制用户模型密钥，不清理失败现场。
下载遵守本机Motrix约定。检查实际环境工具策略，不照搬旧 require_escalated 参数。
写入普通安装前必须有正确计划和用户确认；卸载/降级要额外影响确认。
不让模型执行任意命令，不在用户设备编译未知仓库，不改公共协议迁就实现。

在已有授权内连续完成独立工作，不逐阶段停下要求我点继续。
技术推荐默认见计划；若要改变产品范围、外部发布权限或公共协议，给事实和选项再问。
外部条件缺失不阻断无关工作；只把相关验收标blocked/partial，不能删掉要求或造证据。
构建、打包、真实Desktop必须主控串行调度；所有writer静止后再验最终包。
交源码、可安装tgz/SHA、正确的测试结果、实际桌面证据、升级与作者指南及后续清单。
提交/推送按本次用户授权；既有私人仓不代表允许公开、发release、发npm或组织PR。
```

## 2. 每位子智能体必须收到的共同约束

```text
这是已有项目，不从零重建。用户是技术小白，全程中文报告；技术事实给源码或实证。
开始先读AGENTS.md、PRODUCT.md、本轮复查中分配给你的REV/E编号、对应计划章节。
只写指定文件；公共契约缺项用“接口变更请求：原因/字段/消费者/迁移/测试”给主控。
不能私改公共schema、官方源码、组织仓、真实用户profile、其他worker文件。
不更改文件所有权、不大范围格式化、不删失败证据、不提交或推送、不建PR或发消息。
新增代码注释说明职责、边界和失败恢复；返回结构保留真实失败，不吞字段假报成功。
测试fixture清楚标test，不能编造正式作者、URL、许可证、已验证结论或用户同意。
不要运行pnpm check/build/pack或占用Desktop，除非主控当前明确授予独占时段。
你可以跑不改共享产物的定向测试；产物/日志写专用批次，说明真实/合成/源码层次。
只对必要分支加能发现缺陷的回归，不能镜像错误实现；原审计探针reproduced不是通过。
完成后报告：改动路径、修前复现、修后调用链、命令与结果、未验证项、接口请求。
当能力完成立即交回，不无限扩大审计；若工具 unavailable 如实说，不能虚报调用了agent。
```

## 3. 文件所有权和两波并行

G0 主控先记录当轮 owner 表，所有路径相对工程根；worker 不能为了省事改别人的入口。新文件也须落入自己的目录。共享类型由主控先冻结，再给 worker 精确类型和调用范例。

| owner | 独占写范围 | 不写 |
| --- | --- | --- |
| 主控 | `src/contracts/types.ts`、`src/core/ports.ts`、`src/types.ts`、`src/index.ts`、`src/host/market-runtime.ts`、`src/adapters/dsh/artifact-adapter.ts`、Client `index.ts/activation.ts`、扩展 `contract.ts`、package/scripts配置与总文档 | 不在worker工作期间编辑其文件；以上 src 均位于 packages/market |
| A 安装 | `src/core/` 除 ports.ts；`src/persistence/`；`adapters/dsh/manager.ts/host-port.ts/persistence-adapter.ts`；`tests/core/adapter/persistence` | Host组装、Client、catalog/delivery、公共合同 |
| B 内容 | `src/catalog/`、`src/delivery/`、`src/authoring/`；`tests/catalog/delivery/authoring`；新增 `catalog-source/` 与 `scripts/catalog/`；作者专项文档 | Core、Host组装、Client、公共schema |
| C UI | `src/client/` 除 index.ts、activation.ts、extensions/；`tests/client/`；UI专项文档 | Host、Core、扩展注册表、根构建脚本 |
| D AI（第二波） | `src/host/ai-assist.ts` 与主控明确划定的新增 diagnostics/proposal/confirmation 模块；`tests/host/` | market-runtime.ts、统一任务器、Client确认UI、共享类型 |
| E 扩展（第二波） | `src/client/extensions/` 除 contract.ts；专属扩展测试、示例包目录和扩展指南 | 主页面／入口／Host／package导出；通过接线请求交主控/C |
| Reviewer/QA | 默认只读；测试输出可写新的 `D:/eac-market-verify/<batch>` | 不修改业务制造通过、不与writer并行打包或共用桌面 |

第一波 A/B/C。主控同步连接 Host 与契约，空闲时核对官方行为和审查补丁。第二波复用或替换已结束 worker 为 D/E，最多保留一个正在完成的 UI/内容 worker；明确结束并释放旧agent，避免占满并发。最后 writer 全部交回，再由独立 Reviewer 和主控验最终包。

运行环境不是文件锁就能自动分工：生成器会同时改 Host/Client/Typert，`pnpm check` 本身先 build。**主控只允许一次构建进程**。看到目录/文件被同时改就停止该批验收，先归并；不能反复重建直到偶然绿色。

## 4. 角色提示词

### A 安装 Worker

```text
角色：安装实现员。目标：修REV-01–07/15及REV-08普通管理所需的统一执行基础。
读NEXT-STAGE-PLAN §4.1–4.3、安装专项审查、当前core/adapters/persistence、
官方plugin-manager types/index/operations和atomic-write。遵守共同约束与A写范围。

先证明未勾unverified会被拒、真实AtomicProfileLocks下取消能阻止后续组件、
来源/状态写前核对、等价意图防重、未知回执不重放、重启前置不误放行。
保留JSON时设计提交记录与索引重建，读取旧任务不静默清空；保留成功项和脚本授权事实。
来源证明必须由真实回执与依赖引用/字节核对得到；不能全体proven:true让测试过。
版本比较覆盖预发行标识与非法版本，避免再做不完整SemVer算法。
只给官方适配层需要的契约请求，主控接market-runtime；不改官方源码或另造安装器。

定向回归必须含生产锁与持久层，不只用允许重入的FakeLocks。
明确官方API不具备的跨外部工具原子保证，不能把市场自有锁夸成全局事务。
完成交路径、每条REV的证据、未知分支、主控接线需求；不自行建最终包。
```

### B 作者与分发 Worker

```text
角色：内容实现员。目标：修REV-11/12与内容字段接线，交E01–E04/E07所需数据接口。
读ECOSYSTEM-INTERFACES、CONTENT-INPUTS和固定beta-pack的公共schemas/正反fixture。
遵守B写范围，公共原始字节与市场私有schema分开，不能强迫官方-only插件造Manifest。

打通作者草稿revision/媒体/ZIP/provenance；首次保存已成功，不为误诊推翻它。
作者原包与团队授权固定源码构建两条路径都交模板、校验器及测试样例。
制品/来源/介绍/推荐/证据/撤回分层；来源冻结原始描述，GitHub/Gitee同摘要镜像。
读取公共PackLock现有source边界；GitHub-only产物不编造npm坐标，私有组合独立kind。
失败缓存保留，内容更新不自动安装；不得把Parsed或fixture说成正式作者运行验证。

给UI稳定草稿列表/保存/覆盖/导出/媒体接口，给主控登记来源与宿主证据接口。
正式地址、授权、发布人缺失可继续工程并明确缺项，不建立假生产URL。
完成交文件与真实/合成结果；不对外发作者消息、不上传镜像、不修改Host/Client。
```

### C UI Worker

```text
角色：UI实现员。目标：修REV-10/13/14和跨层确认交互，接已冻结作者/任务接口。
先读真实Desktop截图、PRODUCT、NEXT-STAGE-PLAN §4.4和impeccable SKILL.md；
实际运行技能context并按Operate执行。若工具缺失如实记录，读取本地上下文继续。
保留官方主题和三个主导航，首页做清晰可维护骨架，不为演示编写假推荐和下载量。

重点：自动只读预检，一次正常确认；未验证试装真实绑定；卸载/降级再次展示影响。
A迟到不能关闭B；一个任务对应自己的AI提案；同页安装完成刷新真实库存，终态不漏刷新。
区分安装、配置启用、实际运行、待重启和未知；内部动作枚举转换成真实中文下一步。
作者草稿重开、README差异覆盖、媒体、ZIP应走后台真实接口，不做JSON冒充资料ZIP。
系统内部条目折叠，不隐藏真实错误；市场自身管理指向官方路径。

拆分数据控制器和view使后续成员可维护，严守C范围；扩展slots通过主控接线。
覆盖键盘、焦点、深浅主题、约480px内容区、长内容及无数据状态。
批次检查而非无限微调。无性能测量不宣传丝滑60fps；无接口不放假的可点击按钮。
交截图/组件与交互测试/未接事项，Desktop与最终构建由主控排程。
```

### D AI Worker

```text
角色：AI辅助实现员。目标：修REV-08/09，满足已确认有限执行与二次确认规则。
读AI-ASSIST-RULES和普通安装冻结合同；所有写入只产出交给统一执行器的计划引用。
不让模型自由探索电脑，不提供工具、密钥、用户会话或任意命令/URL执行能力。

诊断按task/environment收集有编号的真实有限脱敏事实；无事实不要装成完成诊断。
严格解析真实finish，拒未知字段、截断、工具块与不支持动作组合。
建议首版单动作可执行提案，允许种类保留安装/更新/同制品换源/启停/卸载/降级。
持久提案绑定对象、版本、摘要、诊断、期限、确认与实际任务；重复确认只执行一次。
卸载/降级需后台生成影响挑战，第一次用户确认零写，第二次不接受自动riskConfirmed。
不要只补Map.set就放开旧潜在写入；不拿提案ID当retryOfTaskId。

用假模型覆盖错误和确认分支；真实默认模型由主控在可授权环境验，不读用户密钥。
主控负责Host组装，UI负责确认展示，给它们精确接口与测试案例。完成后交回。
```

### E 扩展 Worker

```text
角色：扩展实现员。目标：E05/E06及E07接缝，团队内置和独立DSH插件两种都完成。
读ECOSYSTEM-INTERFACES §6–8、官方slots和Cordis生命周期类型、冻结contract.ts。
实现共同注册表、内置适配器、DSH服务适配器、每贡献错误边界及受管异步处理。
五类私有位置：首页补充、更多工具、二级页、详情section、作者工具。
不能取代三主导航、核心安装/确认/兼容状态；不要直接暴露Remote或全部ctx。

注册按真实调用生命周期清理；版本/能力/重复ID结构化拒绝，不能以priority覆盖核心。
提供单独bundle测试插件，声明真实官方加载依赖及type/peer导出需求；市场未就绪可等待。
先装扩展/先装市场、热重载、停用/卸载、50次开关都要验，主控安排真正tgz安装。
同realm不是安全沙箱；错误边界不拦死循环或恶意代码，文档不能夸大。
写范围仅extensions排除冻结合同及示例/专属测试，主页面与exports向主控提接线请求。
交可执行样例与作者升级指南，不能只留接口TODO或只实现内置后把独立插件推后。
```

### Reviewer 与桌面 QA

```text
角色：独立审查员。目标：反证关键链，不复述实现者完成列表。
先对照复查REV、旧AUD/ACC、新E与V-A–K矩阵，抽读对应当前源码和测试。
重点查Host是否真的接上库能力、Client是否丢失败字段、安装前提是否到写入点仍成立。
核对AI提案/确认/实际动作一致，作者ZIP/媒体完整，两类扩展都真正独立接入。
只跑主控授权的定向测试；不改业务修成假通过，不与最终构建并行。

主控执行Desktop：验证当前19387端口/单例与profile确实隔离；日常DSH若正有任务
不能强退。仅在确认空闲且已授权情况下正常退出并在结束恢复；否则换专用用户/VM。
记录被测包SHA、宿主、来源、UI动作、官方回执、磁盘、截图和失败边界。
未经真实模型/第三方双源/独立扩展tgz验证的项目如实partial，不能用本地fixture替代。
报告每条问题的优先级、触发、影响、文件符号、证据层与最小修正；不泛泛说“有风险”。
```

## 5. 每阶段完成记录

```text
工作编号、owner、当前commit/未提交差异：
读取的官方/协议版本与新增事实：
实际更改文件：
修前复现 → 修后完整调用链：
测试命令、结果、证据等级；最终包SHA（如涉及Desktop）：
旧AUD/ACC映射；新REV/E状态：
不可验证原因／实际限制／继续工作的路径：
需要主控组装的接口或文件：
```

结束交接必须列出工作树和远端实际状态，用户日常应用是否恢复，测试进程是否仍运行，哪些 artifact 是测试包。源码报告、构建包和截图必须同一批；不得用“测试全绿”替代这些检查。
