# EAC Market 工程文档总目录

当前源码：adapter `0.1.0-mvp.10` + core `0.1.0`，尚未正式发布；当前安装版：`0.1.0-mvp.9`。先读 [接手入口](handoff/START-HERE.md)、[唯一当前升级指南](UPGRADE-GUIDE.md) 和 [双包接口指南](CORE-ADAPTER-GUIDE.md)。`PRODUCT.md` 保留产品要求，当前接口和路径以双包指南为准。

下表为资料索引，不是待执行清单。带日期的验收、旧计划和审查均是历史证据；不再称为“最新版升级指南”，不能用旧未完成清单覆盖最新实现。

| 文档 | 用途 |
|---|---|
| [Core / Adapter 底座指南](CORE-ADAPTER-GUIDE.md) | 两包职责、公开API、通信协商、版本、打包、后续TUI边界 |
| [本批拆包接力](handoff/CORE-ADAPTER-2026-09-29.md) | 实际变更、测试结果、发行与未验范围 |
| [发现页与全部插件基础接力](handoff/DISCOVERY-FOUNDATION-2026-09-30.md) | 首推海报、皮肤推荐、高分分区、全部插件网格与双包合同 |
| [Agent 插件投稿指南](contributing/AGENT-SUBMISSION.md) | 作者Agent提示词、写入白名单、材料/制品检查、Fork投稿与维护者发布边界 |
| [UI 与交互升级记录](handoff/UI-UPGRADE-2026-09-29.md) | 2026-09-29：导航、焦点、筛选、卡片、任务与安装弹窗升级及本批验收 |
| [DSH 核心宽泛兼容阶段一](handoff/DSH-CORE-COMPAT-2026-09-29.md) | 2026-09-29：0.1.7/0.2.0 peer gate、官方适配层、隔离 Desktop 验证与未来版本边界 |
| [真实下载修复交付](handoff/PULLABILITY-2026-09-28.md) | 历史 mvp.6：作者发行、安装入口及当批镜像验证 |
| [发行与皮肤中心交付](handoff/DISTRIBUTION-2026-09-28.md) | mvp.4发行包、82项清点、公开镜像、真实Desktop与未验边界 |
| [首次使用链路复检](reviews/2026-09-28-portability-recheck.md) | 远端源码、干净构建、安装链、制品下载及Gitee 451限制 |
| [本机皮肤目录操作](contributing/LOCAL-EAC-SKINS.md) | 管理器与皮肤的用户安装顺序、固定来源、许可证及复现脚本 |
| [下一模型接力入口](handoff/START-HERE.md) | 最新状态、阅读顺序、路径、执行默认、环境与可复制启动提示词 |
| [第二轮独立复查](reviews/2026-09-28-independent-review.md) | 历史复查：当时的 Desktop 问题与证据，不代表当前仍未修复 |
| [阶段实施计划](NEXT-STAGE-PLAN.md) | 历史 G0–G6 规划；当前待办以接手入口为准 |
| [作者／分发／双扩展接口](ECOSYSTEM-INTERFACES.md) | 两条发行路线、公共协议边界、上架模板、五槽位及两个接入方式 |
| [多智能体协作约定](handoff/NEXT-AGENT-PLAYBOOK.md) | 独占文件与串行构建仍适用；旧 REV 顺序和拆包前路径仅供追溯 |
| [当前复查工作登记](handoff/CURRENT-REVIEW-REGISTER.md) | 历史 REV、AUD/ACC 与 E 需求登记，当前顺序以接手入口为准 |
| [阶段成果复查与接力报告](handoff/REVIEW-HANDOFF-2026-09-28.md) | 深度复查、R01–R10 风险、真实证据边界和下一阶段规划 |
| [接力运行报告](handoff/RUN-REPORT-2026-09-28-ai-and-workers.md) | 自动检查、最终包摘要、隔离 profile 和真实未验证边界 |
| [接力工作清单](handoff/WORK-QUEUE.md) | AUD 缺陷与新增需求的 owner、完成条件和证据账 |
| [旧验收要求登记](handoff/ACCEPTANCE-REGISTER.md) | 旧矩阵每一条要求独立登记为 ACC，防止与审查编号混淆 |
| [正式内容输入清单](handoff/CONTENT-INPUTS.md) | 合作作者、正式制品、来源和缺料时继续工作的方法 |
| [升级计划 v2](UPGRADE-PLAN-V2.md) | 上一阶段历史计划，已有部分实现；本轮顺序和分工以上述新计划为准 |
| [AI 辅助操作守则](AI-ASSIST-RULES.md) | 已确认方向下的允许范围、执行约束、模型指引与验收；AI 骨架已实现，真实模型和完整执行待验 |
| [2026-09-28 实际体验与升级讨论](reviews/2026-09-28-experience-audit.md) | 历史桌面复现及当时讨论，不是当前待办 |
| [architecture.md](architecture.md) | 代码层次、依赖方向、目录与生命周期 |
| [protocol.md](protocol.md) | Host/Client 契约、状态、错误、持久化 |
| [host-capabilities.md](host-capabilities.md) | 当前官方接口及降级能力 |
| [UPGRADE-GUIDE.md](UPGRADE-GUIDE.md) | 唯一当前操作指南：版本、升级、维护、发布与回退 |
| [troubleshooting.md](troubleshooting.md) | 可执行排错与限制 |
| [testing.md](testing.md) | 测试层次、脚本和证据规则 |
| [ACCEPTANCE-MATRIX.md](ACCEPTANCE-MATRIX.md) | 场景到测试映射 |
| [../ACCEPTANCE.md](../ACCEPTANCE.md) | 已执行的真实批次、产物摘要与未验证项 |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | 原始可执行开发计划 |
| [PROTOCOL-EVIDENCE.md](PROTOCOL-EVIDENCE.md) | 源码事实与已知风险 |
| [UI-DESIGN-BRIEF.md](UI-DESIGN-BRIEF.md) | UI设计任务书 |
| [AGENT-PROMPTS.md](AGENT-PROMPTS.md) | 多智能体分工提示词 |

`PRODUCT.md` 是需求事实源；`ACCEPTANCE.md` 是实际验证记录。两者不可互相替代。

## 专项维护与历史证据

- [历史发行验收](handoff/DISTRIBUTION-2026-09-28.md)
- [镜像/目录维护](contributing/DISTRIBUTION.md)
- [EAC和官方插件差异](contributing/EAC-PLUGIN-INVENTORY.md)
- [皮肤中心接线](UI-SKIN-CENTER-2026-09-28.md)
