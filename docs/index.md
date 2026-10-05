# EAC Market 工程文档总目录

当前源码候选：adapter `0.1.0-mvp.17` + core `0.1.6`；新规划未修改运行代码或发布，正式安装记录仍为 `0.1.0-mvp.9`。开始工作前先读 [当前接手入口](handoff/START-HERE.md) 和 [最新版升级指南](UPGRADE-GUIDE.md)。

## 当前有效文档

| 文档 | 用途 |
| --- | --- |
| [当前接手入口](handoff/START-HERE.md) | 当前分支、版本、阅读顺序、边界和验证命令 |
| [宿主核心与前后端实施方案](handoff/HOST-CORE-COMPATIBILITY-PLAN-2026-10-03.md) | 已确认产品规则、范围来源、API/交互分离、迁移、owner 和 HC-0–HC-5 施工门槛；尚未实施 |
| [版本数据审计](handoff/HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md) | 当前真实字段、覆盖统计与不可推断部分 |
| [合成验收场景](handoff/fixtures/host-core-compatibility-cases.v1.json) | 测试设计数据，非真实插件要求，非通过证据 |
| [最新版升级指南](UPGRADE-GUIDE.md) | 用户升级、维护者构建、发布、回退和证据规则 |
| [Core / Desktop Adapter 底座指南](CORE-ADAPTER-GUIDE.md) | 两包职责、公开 API、通信协商、目录合同和发布边界 |
| [后端协作者指南](handoff/BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md) | Core、Host、目录、适配器和失败语义 |
| [Core 新增能力补齐计划 v1.2](handoff/CORE-NEW-CAPABILITIES-PLAN-2026-10-01.md) | 已选定的后端补齐方案、轻量网络路径及验收门槛 |
| [当前交互审查](handoff/INTERACTION-AUDIT-2026-09-30.md) | Client 动作状态、导航、任务、皮肤、作者工具和未验宿主 |
| [UI 重构合同](handoff/UI-REBUILD-CONTRACT-2026-09-30.md) | 发现页、全部插件、视觉层级、动效和兼容性不变边界 |
| [Client 维护边界](../packages/market/src/client/README.md) | Client 文件职责、Remote 使用和测试入口 |
| [产品要求](PRODUCT.md) | 已确认的产品范围和不做事项 |
| [测试与证据](testing.md) | 测试层次、脚本和证据规则 |
| [作者投稿指南](contributing/AGENT-SUBMISSION.md) | 作者材料、制品、审核和发布边界 |
| [目录内容维护](contributing/CATALOG-CONTENT.md) | 目录、来源、版本和媒体资料维护 |
| [发行维护](contributing/DISTRIBUTION.md) | 固定制品、摘要和发行入口 |
| [协作约定](handoff/NEXT-AGENT-PLAYBOOK.md) | 文件 owner、合同先行、串行验证和交接格式 |

## 历史资料

旧阶段报告、旧验收登记、旧 UI 记录和旧发行记录统一在 [历史接力归档](handoff/archive/2026-09-legacy/README.md)。归档文件只用于还原当时事实，不是当前任务清单，也不能覆盖当前版本或下载地址。

## 需求、验证和历史的关系

- `PRODUCT.md`：需求事实源。
- `ACCEPTANCE.md`：实际验证记录，未验项目必须保留为 partial。
- `UPGRADE-GUIDE.md`：当前操作指南。
- `handoff/START-HERE.md`：当前接手和协作入口。

如果多个旧文档与当前入口冲突，以当前接手入口、最新版升级指南和实际源码/测试为准，并在交接记录中说明冲突。
