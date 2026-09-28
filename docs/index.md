# EAC Market 工程文档总目录

先读 [下一模型接力入口](handoff/START-HERE.md) 与本目录 [PRODUCT.md](PRODUCT.md)，再按任务选择下列文档。旧计划和历史验收保留，当前状态同时核对最新体验审查；历史通过不能覆盖新失败。

| 文档 | 用途 |
|---|---|
| [Agent 插件投稿指南](contributing/AGENT-SUBMISSION.md) | 作者Agent提示词、写入白名单、材料/制品检查、Fork投稿与维护者发布边界 |
| [真实下载修复交付](handoff/PULLABILITY-2026-09-28.md) | 当前mvp.6：从作者实际发布补回14安装入口、22可用镜像及官方业务验证 |
| [发行与皮肤中心交付](handoff/DISTRIBUTION-2026-09-28.md) | mvp.4发行包、82项清点、公开镜像、真实Desktop与未验边界 |
| [首次使用链路复检](reviews/2026-09-28-portability-recheck.md) | 远端源码、干净构建、安装链、制品下载及Gitee 451限制 |
| [本机皮肤目录操作](contributing/LOCAL-EAC-SKINS.md) | 管理器与皮肤的用户安装顺序、固定来源、许可证及复现脚本 |
| [下一模型接力入口](handoff/START-HERE.md) | 最新状态、阅读顺序、路径、执行默认、环境与可复制启动提示词 |
| [第二轮独立复查](reviews/2026-09-28-independent-review.md) | 当前最新：亲自操作官方 Desktop、15组问题、证据及旧结论纠正 |
| [下一阶段实施计划](NEXT-STAGE-PLAN.md) | 两部分方案、G0–G6、技术备选、逐项验收 |
| [作者／分发／双扩展接口](ECOSYSTEM-INTERFACES.md) | 两条发行路线、公共协议边界、上架模板、五槽位及两个接入方式 |
| [下一轮多智能体提示词](handoff/NEXT-AGENT-PLAYBOOK.md) | 当前执行分工、文件owner、两波并行、完整角色提示词 |
| [当前复查工作登记](handoff/CURRENT-REVIEW-REGISTER.md) | REV、旧AUD/ACC及新E需求的追踪方式 |
| [阶段成果复查与接力报告](handoff/REVIEW-HANDOFF-2026-09-28.md) | 深度复查、R01–R10 风险、真实证据边界和下一阶段规划 |
| [接力运行报告](handoff/RUN-REPORT-2026-09-28-ai-and-workers.md) | 自动检查、最终包摘要、隔离 profile 和真实未验证边界 |
| [接力工作清单](handoff/WORK-QUEUE.md) | AUD 缺陷与新增需求的 owner、完成条件和证据账 |
| [旧验收要求登记](handoff/ACCEPTANCE-REGISTER.md) | 旧矩阵每一条要求独立登记为 ACC，防止与审查编号混淆 |
| [正式内容输入清单](handoff/CONTENT-INPUTS.md) | 合作作者、正式制品、来源和缺料时继续工作的方法 |
| [升级计划 v2](UPGRADE-PLAN-V2.md) | 上一阶段历史计划，已有部分实现；本轮顺序和分工以上述新计划为准 |
| [AI 辅助操作守则](AI-ASSIST-RULES.md) | 已确认方向下的允许范围、执行约束、模型指引与验收；AI 骨架已实现，真实模型和完整执行待验 |
| [2026-09-28 实际体验与升级讨论](reviews/2026-09-28-experience-audit.md) | 最新桌面复现、MVP 缺口、待讨论方案；未实施修复 |
| [architecture.md](architecture.md) | 代码层次、依赖方向、目录与生命周期 |
| [protocol.md](protocol.md) | Host/Client 契约、状态、错误、持久化 |
| [host-capabilities.md](host-capabilities.md) | 当前官方接口及降级能力 |
| [UPGRADE-GUIDE.md](UPGRADE-GUIDE.md) | 收录、升级、协议和后续功能 |
| [troubleshooting.md](troubleshooting.md) | 可执行排错与限制 |
| [testing.md](testing.md) | 测试层次、脚本和证据规则 |
| [ACCEPTANCE-MATRIX.md](ACCEPTANCE-MATRIX.md) | 场景到测试映射 |
| [../ACCEPTANCE.md](../ACCEPTANCE.md) | 已执行的真实批次、产物摘要与未验证项 |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | 原始可执行开发计划 |
| [PROTOCOL-EVIDENCE.md](PROTOCOL-EVIDENCE.md) | 源码事实与已知风险 |
| [UI-DESIGN-BRIEF.md](UI-DESIGN-BRIEF.md) | UI设计任务书 |
| [AGENT-PROMPTS.md](AGENT-PROMPTS.md) | 多智能体分工提示词 |

`PRODUCT.md` 是需求事实源；`ACCEPTANCE.md` 是实际验证记录。两者不可互相替代。

## 发行与后续维护

- [六项交付/验收](handoff/DISTRIBUTION-2026-09-28.md)
- [镜像/目录维护](contributing/DISTRIBUTION.md)
- [EAC和官方插件差异](contributing/EAC-PLUGIN-INVENTORY.md)
- [皮肤中心接线](UI-SKIN-CENTER-2026-09-28.md)
