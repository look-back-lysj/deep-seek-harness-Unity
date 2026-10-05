# 宿主核心适配：首批实现与验证

日期：2026-10-03。分支：`refactor/market-core-adapter`，起点 `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。状态：**首批安全修复与数据投影已实现；整个宿主版本方案仍为 partial。** 未提交、推送或发布；保留此前规划文档修改。

## 范围与协作

按 [实施方案](HOST-CORE-COMPATIBILITY-PLAN-2026-10-03.md) 开始 HC-0/HC-1 和 HC-2 数据准备。三个真正的子智能体分别独占管理结果、纯目录合并、库存安全门；主控串行处理合同、数据投影、Adapter 接线、Runtime 集成、构建与包验证。

没有安装额外依赖，没有修改锁文件、官方源码、外部 Agent Forge schema 或真实 Profile。没有改变 Core API 1.0.0 / Remote 2.0.0，也没有添加后台服务、静默安装、前端默认版本或 UI 状态机。公共目录 DTO 只增量提供真实范围声明、元数据摘要、已绑定 releaseId、合并问题与来源 revision 向量。

## 已实现

1. 管理动作保留官方变更事实。官方成功后维护写盘失败、写后库存抛错或管理回执落盘失败，返回 unknown 并保留本次已收到的 changed/权限/脱敏诊断；使用现有管理派发记录拒绝重放。旧记录没有可靠回执时仍为 unknown，不能补造 changed:true。
2. HostPort / TaskManager 复用浏览器安全的诊断分类。目标 duplicate、目标版本未知、全局 listBundles 失败或缺少 bundle 名称拒绝写入；无关包错误不全局封锁。测试覆盖初始检查、下载后检查、真实 HostPort 调用链及零官方写。
3. 多源合并不再最后 Map 值覆盖。内容/身份/摘要/引用冲突暂停候选并通过 CatalogSnapshot.mergeIssues 返回；已知 hard-blocked 不被旧镜像解除。完整来源 revision 向量生成稳定 SHA-256，输入顺序不决定胜者；允许分别验证后的 v2 随包投影与 v1 Agent Forge 投影合并。
4. Runtime 展示、制品接线和写前检查使用合并目录。新任务的确切写入目标缺失、冲突、撤回或不可安装时阻断，不静默换版本/摘要；各登记来源仍核对已知撤回。独立复核后，启动检查移至 TaskManager 判定原幂等任务之后、创建新任务之前；仅检查实际 steps，不因当前目录阻断已有任务恢复或 keep 零写入项。每次写前复验仍保留。组合投影不再被基础目录集合覆盖。
5. Desktop 默认空来源配置不再传 catalogSources:[] 遮蔽 Core 默认来源；显式配置仍只转发维护者登记列表。Agent Forge 显式限定 targetAgent=dsh；这不等于已经证明 app-boot 版本与上游核心范围语义相同。
6. 保存 Agent Forge 在线/受控本地/离线原始记录字节与摘要，在私有目录文档保留发行目标出处；公开 DTO 仅投影范围事实和出处，不发送原始文档。范围与 name/version/raw digest 绑定，错配或篡改拒绝。
7. 现有 package.json/Manifest 原字节中只投影 engines.dsh 和 peerDependencies["@deepseek-ai/dsh"]；其他组件依赖、空 compatibility、Evidence 不生成核心范围。保留同发行多条声明供后续完整评估，不在本批猜语义等价、有效性或兼容结论。

## 数据现状

最终源码直接验证随包目录：61 plugins / 21 listings；61 条插件保留已校验 metadataDigest；18 条具有明确核心范围声明，43 条缺声明仍未知。该数字是数据投影覆盖率，不是兼容或实测通过率。上游 latest-only 来源不会因为有 versions 标签变成完整历史；研究 listing 不制造制品或可执行 releaseId。

## 验证证据

- 最终 `node scripts/build.mjs` 通过；生成 Host / Client / Remote 与两个包入口，之后 `tsc -b tsconfig.host.json tsconfig.client.json` 通过。
- 最终全量 Vitest：84 个文件中 82 passed、1 failed、1 skipped；893 个测试通过、1 失败、2 跳过。不能宣称全量通过。
- 唯一失败为基线已有 `tests/client/dialogs.test.tsx:94` 的旧正则要求 `<details><summary>`，而 HEAD 的 TaskDrawer 已含 class/aria-label。两者本批未改；留 Client owner 收口，不降低测试标准。
- 8 个本批新增测试文件共 138 项在最终全量中通过：管理结果17、纯合并39、库存分类/TaskManager36、完整安装门31、范围投影7、默认来源3、Runtime合并2、新任务发行检查/旧任务恢复/keep3。
- 隔离发行测试 28 项通过；需要既有 `D:/eac-market-verify/split-release-unit` 写范围，已通过工具审批运行；不属于官方 Desktop 实机验收。
- 最终 `node scripts/verify-package.mjs` 通过：82 个包文件、37 个 Remote descriptors、分包外部依赖及浏览器安全边界；仅打包 dry-run，不发布。
- 最终 lint / git diff --check 通过。故障注入的 recovery error 日志和已有 CJS import.meta warning 保留，不把它们冒充新产品故障或隐去。
- 未运行 browser-check、官方 Desktop、真实 profile 历史恢复、真实源网络或第三方安装验收。

## 下一步与门槛

1. **请求批准显式 semver 运行依赖。** 拟在 market-core 声明 semver，配套 TypeScript 类型作为开发依赖；安装前先核实允许版本/本地缓存并冻结版本，不借用传递依赖。尚未批准/安装，完整范围引擎和 latestCompatible 尚未实现。
2. HC-0：核实 AgentId=dsh 与可信宿主核心版本的绑定，读取失败返回 unknown，不把 app-boot、market-core 或协议版本互相替代。
3. HC-1 尚需补既有 management 记录的只读恢复查询，以及安装未收到 taskId 的原幂等意图查询；不新增任务系统。维护保存失败的未知层级现已保留，但公开结果分层与维护恢复查询仍待合同设计接线。
4. HC-2：完整 SemVer range、OR 空洞、预发行规则、过低/过高/空范围/声明冲突及同 precedence 歧义的纯评估；使用规划 fixture 不代表当前已执行所有场景。
5. HC-3：hostCore、releaseOptions、checkUpdates 同评估器、分页 context、计划/写前范围复验、协议能力与兼容矩阵。不得把本批声明投影当已经存在版本列表 API。
6. HC-4：前端默认适配升级选择、保留手选、核心过旧提示、任务在途锁、超时原操作恢复；加载/等待/轮询中间态仍归前端。顺带由 Client owner 修复现有任务记录测试选择器。
7. HC-5：最终串行构建/全回归/包边界及官方 Desktop 验收；历史目录采集与 8 MiB 超限来源仍按审计列缺口，不无限放开大小或伪造较旧适配版。

下一位第一步：读本文及实施方案，重查工作区；取得范围依赖批准，再完成 HC-0 身份与 HC-2 评估，不直接接 UI 假列表。
