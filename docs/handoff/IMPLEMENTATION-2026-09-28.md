# 2026-09-28 修复实施进行记录

起点：`01b7e31dddb5715e79d155a4afbaa5472aba2013`，分支 `codex/market-reliability`。用户已明确要求按接力计划全自动实施；本文件记录进行中的事实，不是完成报告。

工具调用恢复：FREEFORM `functions.exec` 使用原始 JavaScript 后，最小编排、真实 PowerShell/Git、文件读取和 node_repl 均已验证。此前仅凭 `unsupported call: exec` 将其断言为全局路由故障缺少依据；本轮未更改应用安装、全局代理或权限设置。

第一波按 `NEXT-AGENT-PLAYBOOK.md` 分工：A 安装与持久化；B 目录、分发与作者；C UI。共享 wire contracts、core ports、Host 组装、Client activation/index、artifact adapter、构建及桌面验收归主控；writer 不自行改共享接口或运行全局 build/check。

接口规则：现有 JSON 契约为第一轮基础；增量字段先向主控提供类型、消费者及迁移要求。核心需要冻结的制品来源留在 Host 私有 PlanBundle，不能向 Client 泄漏本地路径。AI 仍无工具；全部写入使用统一协调和真正用户确认。普通写链门槛未过前不开放新增 AI 写入。

全部验证使用 D 盘新批次目录；组织仓、官方源码、真实用户 profile 只读。最终记录需要逐一对应 REV、E、AUD/ACC，并区分实测与合成验证。

## 本批进度（进行中）

- A 安装已交回：13 文件83项定向测试；真实文件锁与持久层，官方服务合成。接线 manage、coordinationFiles、validateWrite、真实Host fingerprint已完成。来源证明覆盖回执/依赖引用/缓存字节，不声称扫描node_modules全部文件。
- B 内容已交回：12文件63项，后追加推荐投影子集14项；两路本地fixture与CLI生成验证完成。正规作者授权、正式线上双源和真实团队CI仍未验证。
- C UI已交普通流程、作者闭环和17组合成浏览器检查，正在补私有collection和混合组合逐项阻断，最终冻结后统一测试。
- 主控已接真实Remote连接身份（官方RemoteInvocation）、持久方案/AI提案/二次挑战、作者媒体与README预览、完整刷新结果、独立私有collection规划。5项装配及2项collection集成已过；AI初稿12项过，D独立审查中。
- E双扩展实现与示例、D AI独立审查仍进行中。全局build/最终pack尚未执行，不能用旧包称本轮桌面通过。
- 当前运行的官方Desktop是新隔离实例：`D:/eac-market-verify/implementation-20260928/desktop-final`，启动PID35096（后续须重新核对），已真实看到初始官方界面；启动前没有日常DSH进程。未读取或复制真实用户配置，模型凭据是显式无效测试值，不调用真实模型。
- 下载实测受阻：启动Motrix并添加已查明registry制品的命令被自动审批以 `blocked by policy` 拦截；未改用其他下载方式。正规第三方下载保留未验证，本地无害fixtures继续验证。

市场新包拟为 `0.1.0-mvp.1`；当前改动尚未提交或推送。旧main仍为01b7e31，远端private及beta-pack基线已在本轮API再次核实。

## 用户日常 DSH 安装（后续明确授权）

用户随后明确要求“在我的 DeepSeek Harness 里面装好，我要真实验证”，因此授权范围增加日常 profile 的正常官方安装与启用，不包含对真实环境做故障注入。

- 全局构建、包结构与30个Remote结果schema通过；全套324项测试通过（`full-tests-first.json`）。后续代码不再变动本包。
- 最终包 `0.1.0-mvp.1`，494285字节，SHA256 `bbbfe4cf3cafe8a8c54ec1b474b9fbdbedd2d392a6cfba66d9ed8b77bb9481fb`，固定保存在 `D:/eac-market/releases/0.1.0-mvp.1/`。profile依赖使用这个路径，不能把该文件当临时下载删除。
- 先在隔离Desktop通过官方添加插件页安装/启用并真实看到EAC页面；随后确认没有活跃安装任务，关闭仅本任务的隔离实例，启动日常官方DSH。
- 日常Host实际绑定用户的 `.dsh/profiles/desktop`。通过官方添加插件页安装并启用；实际 `package.json` 中依赖和bundles已存在，已安装Host/Client入口摘要与本批构建一致。
- 已实际打开日常DSH侧栏EAC，发现/全部插件/我的插件导航正常显示。正式目录当前为空，没有把fixture写进日常目录；此项不代表实际第三方安装、全部AI或故障恢复验收完成。
- 元数据备份在 `D:/eac-market-verify/user-install-20260928-164215`；本机精确验证记录为 `D:/eac-market-verify/implementation-20260928/user-install-result.json`。没有复制用户密钥或将真实窗口截图写进仓库。
- 日常窗口留给用户亲自验证；不要再自动切回测试环境或关闭它。新代码仍未提交/推送；当前任务分支为 `codex/market-reliability`。
