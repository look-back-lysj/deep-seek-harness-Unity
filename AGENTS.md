# EAC Market 开发约束

全程中文汇报。事实必须来自当前源码、真实运行或已标记测试，不能把计划写成验收结果。

继续本项目先读 `docs/handoff/START-HERE.md`。真实工程已经存在；任务是修复既有 MVP 并升级，不按历史 v1 文档从零重建。

产品决定以 `docs/PRODUCT.md` 和用户最新指令为准；文件所有权、阶段、环境和验收编号按接力入口执行。官方源码、EAC 组织仓及真实用户 profile 不属于本工程写范围。

既有实现已保存为 Git 基线 `ea84b9f`；第二轮独立复查和下一阶段计划由接力入口链接。具体分支、未提交修改及远端状态开工再查，保留未知文件及必需的 `packages/market/src/protocol-ambient.d.ts`。外部动作按当前会话授权办理；个人仓上传不等于公开发布或修改组织仓。

下一轮必须按 `docs/handoff/NEXT-AGENT-PLAYBOOK.md` 使用真正的子智能体、独占文件和串行构建。`tools/review-probes` 是错误复现工具，输出 reproduced 不代表产品通过；不要接入正常 CI 当正确行为期待。
