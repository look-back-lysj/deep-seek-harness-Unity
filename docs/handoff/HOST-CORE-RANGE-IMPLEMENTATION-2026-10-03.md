# 宿主范围评估与版本事实：第二批实现

日期：2026-10-03。分支：`refactor/market-core-adapter`，HEAD 仍为 `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`；工作区包含未提交的第一批及规划修改，未覆盖、提交、推送或发布。

状态：**HC-2 的规则投影、纯范围评估、发行事实汇总已实现；HC-0 的生产版本域绑定尚未闭合，HC-3/HC-4 未接线。** 本文替代第一批文档中“范围依赖尚未批准”的当前状态，第一批验证数字仍保留历史意义。

后续更新：主人已确认 dsh=DSH运行时域，第三批已接 getter 和只读 API；当前状态见[第三批实现](HOST-CORE-API-IMPLEMENTATION-2026-10-03.md)。本文以下未闭合结论保留当时的证据边界，不作为最新阻塞。

## 授权、协作与依赖

主人在了解“格式数据不等于范围求值器”后批准继续。Core 显式声明 `semver@7.8.5` 运行依赖、`@types/semver@7.7.1` 开发依赖；安装关闭脚本，沿用原 `G:/.pnpm-store`，锁文件只新增相应 Core importer 和类型包记录，不借用传递依赖。原精确排序模块和浏览器安全 `/semver` 入口不变。

三个真正 subagent 分别独占规则数据投影、纯范围评估、只读宿主身份审计；主控串行处理合同/锁、发行事实、包入口、独立复核修复、构建与最终验证。规则 worker 交回后负责只读复核，两个确定问题修正后再次复核关闭。全部 worker 已关闭。

首次 sandbox 内安装未取得匹配 store 参数，pnpm 在重建依赖前因无 TTY 安全中止；没有批准删除/重置 node_modules。后续带既有 store 参数的已批准安装成功。首次工具留下工作区 `.pnpm-store/` 的本地缓存索引与空分桶，不是源码或发布材料；本轮未擅自删除，后续交付不可提交它。

## 已实现内容

### 1. 版本规则投影

- `CatalogCoreRangeDeclaration.versionScheme` 可选。Agent Forge target 级七种规则原样保留，缺省不补 semver；package 级 scheme 不能冒充 target 规则。
- package engines.dsh 和核心 peer 明确标记为 npm。非法 scheme 类型/枚举拒绝，原始字节、摘要、target/name/version 绑定和 latest-only 事实不变。
- 旧数据缺省仍可读，但不产生已知范围适配结论。不修改上游 schema 或批量填补未知。

### 2. 完整范围纯评估

`evaluateHostCompatibility(hostCore, requirements)` 只接受可信调用者提供的身份、版本与规则；Core 不读 Profile、不从旧 hostVersion/协议版本推断核心。

- 成熟 semver 处理 caret、tilde、hyphen、OR、通配、严格精确版本与预发行范围语法。
- 多声明按实际允许集求交；等价字符串、部分重合不冲突，不相交或合法空允许集返回 conflict/metadata-conflict。
- 不满足时证明整个允许集合的上下关系；OR 空洞、被排除的宿主预发行返回 core-range-mismatch，不仅比较 minVersion。
- npm/semver 之外的 scheme、未指定规则、缺失范围、非法版本/范围分别返回 unknown 原因。无关 Agent 的非法声明不污染目标。
- 即使 semver 库把空字符串解释为通配，市场也拒绝空白声明，不把缺数据变成兼容。超大数不接受精度损失；128 声明、4096 字符范围与 4096 证明步限制超出后安全未知，使用独立 core-range-evaluation-limited 原因。
- 宿主预发行按当前已确认产品规则严格判断，不因为展示预发行包而全部放行。这不同于官方 pluginManager 的 includePrerelease:true peer 行为；本算法不声称替代官方安装决策或授权兼容豁免。

### 3. 发行事实汇总

`evaluatePackageReleaseFacts` 保留真实 installed、当前接受集合 latestPublished、核心匹配 latestCompatible；以完整版本/摘要/发行身份判断候选。

- 制品、verification 与核心兼容三维独立：缺制品不令 latestCompatible 退回旧版，未实测不增加试装勾选。
- 同包同版多摘要/声明差异不最后 Map 值覆盖；verification/installability 状态差异不伪造核心元数据冲突。
- 同一完整发行的来源镜像不制造假歧义；同 precedence 的不同 build 身份保留显式歧义，不选任意默认。
- 已装比目录新时保留真实版本/降级关系/确认要求；目标或全局库存未知不从目录补版本，无关旧异常不全局封锁。
- 发布状态必须由接受目录生命周期提供，不从 hard-incompatible 或缺制品推断撤回；未知发布状态不进入最新有效发行集合。
- historyCoverage 与缓存 stale 保留。latestCompatible=null 且历史不完整不表示全历史不存在适配版。
- 没有 defaultReleaseId、clientDefaultUpgrade、加载、弹窗阶段、等待或轮询状态，也不授权安装。

两函数从现有 Node `/dsh` 入口导出，根入口仍只含浏览器安全合同。本批没有新增 Remote 方法，没有改 Core API 1.0.0 / Remote 2.0.0 或源码包版本，未手改生成产物。

## HC-0 身份核实与未闭合问题

### 证据

1. 官方 `@deepseek-ai/dsh-app-boot/lib/types/plugin-compatibility.d.ts:12` 明确 `getDshRuntimeVersion()` 返回 app-boot 包自身的有效运行时语义版本；实现 `lib/index.js:271` 从自身 import.meta.url 定位 package.json。
2. 官方 `evaluatePluginCompatibility` 默认用这个 getter 评估 DSH 核心/组件 peer；官方 pluginManager 调用时没有另传 Desktop 发行号。
3. 本地开发依赖为 0.1.7-rc.2，指定验收 Desktop 为 0.2.0-rc.1。不能证明实际 Desktop 内运行时与任一开发观测版本相同。
4. Forge source 明确 agentId=dsh，但没有定义其版本域。外部只读 `docs/IMPLEMENTATION-PLAN.zh-CN.md:975` 仍将 dsh 首个版本规则和资料来源列为待确认问题。

### 决策

**不擅自将 Agent Forge dsh 绑定 Desktop 发行号或 app-boot 运行时版本。** 两种域在当前记录中不同；纯评估器能工作不代表生产身份已证明。市场旧 hostVersion 字段原义和读取路径本轮不改，尚未接线 hostCore/hello；下一批未绑定时必须显示 unknown，不能报“DSH 核心版本过旧”。

建议明确登记：Forge dsh 的范围对照官方 `getDshRuntimeVersion()` 的运行时域，Desktop 发行号仅作发行诊断；但这需要产品/数据维护者确认语义，不是依据路径或包名自动推断。运行时读取还须确认实际宿主加载的官方模块实例，不能直接拿开发依赖观测当生产快照。

## 最终验证

- 串行构建成功；生成 Host/Client/Remote 和两个包入口，随后聚合 typecheck 通过。
- 最终全量：86 文件，84 passed / 1 failed / 1 skipped；**1060 passed / 1 failed / 2 skipped**。唯一失败仍是基线已有 `tests/client/dialogs.test.tsx:94` 的任务记录旧选择器；本轮没有改 Client 或该测试，不宣称全量通过。
- 新范围测试 87 项、新发行事实测试 33 项、投影 30 项、Agent Forge 32 项、Runtime 合并 2 项均在最终全量中通过。范围 oracle 包括 384 组有限允许集组合；不是穷尽所有真实宿主情况。
- 实际加载规划 fixture：20 个版本事实场景验证的是后端事实，不验证 Client 默认选择；范围 probe 另覆盖选定场景。6 个交互场景未因纯函数测试而自动通过。
- 最终 verify-package：82 个包文件、37 个 Remote descriptors、双包边界通过；lint、git diff --check 通过。
- 直接导入构建后的 `/dsh` 并用明确合成绑定评估：1.0.0 对 >=2.0.0 返回 core-too-old；根入口没有暴露评估器。直接校验现有目录：61 plugins、18 个有声明、32 条 npm 声明。此为数据及模块验证，不是现有插件兼容通过。
- 未联网刷新真实目录、未启动官方 Desktop、未读取真实 Profile、未安装第三方插件、未运行 browser-check 或发行上传。

## 下一步

1. 确认 Forge dsh 版本域并登记可信宿主读取机制；无法确认则 API 必须保留 hostCore unknown，不能把纯 fixture 当真实核心版本。
2. HC-3 主控串行冻结 releaseOptions、分页 context、checkUpdates 共用摘要、计划/写前范围复验、版本/能力协商和旧 Host 矩阵。
3. 后端仍需补既有 management/task 意图的只读恢复查询，不新建任务系统；维护保存失败的事实分层继续沿用第一批保护。
4. HC-4 才接前端默认适配升级/保留手选、过旧提示、超时原操作恢复与进度锁；Client owner 收口基线任务记录测试。
5. HC-5 最终全回归、包边界和真实官方 Desktop 验收；历史较旧版本元数据及超限源采集缺口仍按审计处理。
