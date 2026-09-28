# EAC Market 开发约束

全程中文汇报。事实必须来自当前源码、真实运行或已标记测试，不能把计划写成验收结果。

继续本项目先读 `docs/handoff/START-HERE.md`。真实工程已经存在；任务是修复既有 MVP 并升级，不按历史 v1 文档从零重建。

产品决定以 `docs/PRODUCT.md` 和用户最新指令为准；文件所有权、阶段、环境和验收编号按接力入口执行。官方源码、EAC 组织仓及真实用户 profile 不属于本工程写范围。

既有实现已保存为 Git 基线 `ea84b9f`；第二轮独立复查和下一阶段计划由接力入口链接。具体分支、未提交修改及远端状态开工再查，保留未知文件及必需的 `packages/market/src/protocol-ambient.d.ts`。外部动作按当前会话授权办理；个人仓上传不等于公开发布或修改组织仓。

下一轮必须按 `docs/handoff/NEXT-AGENT-PLAYBOOK.md` 使用真正的子智能体、独占文件和串行构建。`tools/review-probes` 是错误复现工具，输出 reproduced 不代表产品通过；不要接入正常 CI 当正确行为期待。

## 工具调用排错

当轮工具定义为 FREEFORM 的 `functions.exec` 必须传原始 JavaScript，不能按 JSON 调用或套 recipient_name/parameters。内部再用 `await tools.exec_command({ cmd, workdir })` 等结构化参数调用工具。优先读取当前工具定义，不照搬旧模型的调用封装。

遇到 `unsupported call: exec`，先纠正外层调用类型，再用 `text({ probe: 'functions.exec', ok: true })` 做一次最小验证，然后验证一条只读命令。不得在同一格式上无意义重试，也不能未经区分就声称整个工具通道故障或要求用户重启。2026-09-28 已实际验证原始 JavaScript、命令执行、文件读取和 node_repl 正常；这不代表尚未验证的工具或项目功能自动通过。
