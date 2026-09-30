# EAC 市场：当前接力入口

当前工作是用户已批准的 **Core / Desktop Adapter 双包底座**。源码位于 `D:/eac-market`；桌面 `升级eac` 目录仅保留项目入口和历史规划。

1. [本批进度与真实验收](CORE-ADAPTER-2026-09-29.md)。
2. [接口、目录与升级指南](../CORE-ADAPTER-GUIDE.md)。
3. [产品要求](../PRODUCT.md)、[通用升级约束](../UPGRADE-GUIDE.md)。
4. [后端协作者指南](BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)：Core、Host、目录和适配器的当前接入边界。
5. [多智能体协作规则](NEXT-AGENT-PLAYBOOK.md)：沿用独占文件、合同先行、最多三名worker、构建/打包/宿主验收串行；其中旧REV任务不自动成为本轮范围。

候选为 core 0.1.0 + adapter 0.1.0-mvp.10。原市场包名、数据目录和第三方作者接入规则保留。当前源码和远端、测试结果、是否发布必须查实际状态；不要把本地候选写成已经上线。

当前正式安装版是 mvp.9，单包结构；真实 Desktop 兼容加载的历史证据来自 mvp.8，见[兼容阶段一](DSH-CORE-COMPAT-2026-09-29.md)。双包仅完成本地测试源空缓存安装与官方 Web 验证，公网 core、Desktop 新装和整包升级待验。

唯一当前操作指南是 [UPGRADE-GUIDE.md](../UPGRADE-GUIDE.md)。[旧入口归档](archive/START-HERE-before-core-adapter.md)、旧计划及历史审查仅用于追溯，不能覆盖本文件的版本、路径和任务顺序。GitHub 默认分支承载源码，Gitee 默认分支承载发行资料；不能用源码树整体覆盖 Gitee 发行树。

本轮按用户要求统一两边 README、升级指南与接手入口；文档同步不等于发布新双包。后续先完成隔离 Desktop 新装/升级和 core 公网来源验收，再发布最终不可变制品。当前有效维护约束均汇总到升级指南，历史报告不再作为操作入口。

官方源码、组织仓和用户日常profile只读；测试使用 D:/eac-market-verify 新批次。下载按用户Motrix约定；权限以本轮工具配置为准。不要提交凭据、真实profile、用户日志。提交、推送和发布按当前会话授权，避免对已授权事项重复确认。
