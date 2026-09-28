# Deep Seek Harness Unity / EAC 市场：当前接力入口

> **最新定向复检**：[首次使用链路报告](../reviews/2026-09-28-portability-recheck.md)。源码/安装基本链可用；在线目录出现Gitee451，不能沿用上一轮“全部在线入口可用”的状态。

> **本批优先入口**：[发行与皮肤中心交付](DISTRIBUTION-2026-09-28.md)，含公开 Gitee 镜像、完整 EAC 清点、新环境构建及实际验收。先查这份，再读下面历史状态。

> **当前状态**：发行与首次使用复检已完成，当前日常用户安装的是 `0.1.0-mvp.4`。私人 GitHub `main` 已核对到 `3872b7f`；当前工作树干净。下一位协作者先读发行交付与首次使用复检，历史 mvp.2 文档只作历史证据。

更新：2026-09-28，**发行与首次使用复检完成**。已有实现，不能从零重建。当前产品状态为 **partial**：源码构建、市场包安装和既有插件下载链已核验；Gitee 在线目录刷新仍受 HTTP 451 拦截。

## 1. 当前事实

- 工程 `D:/eac-market`；真实插件 `packages/market`，运行包名仍 `@dsh-eac/market`。
- 当前交付提交 `3872b7f11cefd3920a1e336f3772835a426c7421`；GitHub 私仓远端 `main` 与本地提交、树摘要一致。
- 公开源码仓：[look-back-lysj/deep-seek-harness-Unity](https://github.com/look-back-lysj/deep-seek-harness-Unity)；协作者可直接克隆或 Fork，`main` 受代码所有者审核保护，上传的实际提交以远端 main 为准。
- 本轮亲自操作官方 Desktop `0.1.7-rc.2`：通过官方添加插件页安装并启用市场；市场内无害 fixture 安装和启用确实有磁盘事实。
- 同时复现：未勾试装仍安装、我的插件安装后未刷新、目录刷新失败报成功。源码/合成探针有取消、恢复、更新来源、AI确认等缺口。
- 本轮重新跑12文件49项通过；旧110项是上轮结果。测试通过没有覆盖掉本轮缺陷。
- 被测市场tgz 358423字节，SHA256 `A15C1A1AFA46197E71A8329ED513E6F8A128074DD274DF65CF3FAECE2CBE944C`；位于 `D:/eac-market-verify/audit-20260928/ai-run-3/`。
- 官方源码 `D:/deepseek-harness-source/deepseek-harness-master` 是无git的0.1.7-rc.2归档；团队 beta-pack 本轮远端核验 `44178ab1360dcb8221a666e782391a11f5716074`。不要猜官方master提交或沿用旧看板状态。

## 2. 阅读顺序

| 顺序 | 文档 | 目的 |
| --- | --- | --- |
| 1 | [PRODUCT](../PRODUCT.md) | 已定产品范围；两种发行路线、两种扩展都保留 |
| 2 | [独立复查](../reviews/2026-09-28-independent-review.md) | D/S/P/F证据、REV-01–15、哪些旧结论需纠正 |
| 3 | [下一阶段计划](../NEXT-STAGE-PLAN.md) | G0–G6、修复设计、UI、AI、验证门槛和备选 |
| 4 | [生态接口](../ECOSYSTEM-INTERFACES.md) | 上架/安装/双源/官方标准/五槽位/双扩展接入 |
| 5 | [多智能体提示词](NEXT-AGENT-PLAYBOOK.md) | 完整主控/worker提示词、独占文件、构建与Desktop串行 |
| 6 | [当前工作登记](CURRENT-REVIEW-REGISTER.md) | REV/AUD/E对应、当前状态和证据填写方式 |
| 7 | [AI守则](../AI-ASSIST-RULES.md)、[ACC登记](ACCEPTANCE-REGISTER.md)、[旧AUD](WORK-QUEUE.md) | 既有要求继续有效，不能因新编号遗漏 |
| 8 | [协议证据](../PROTOCOL-EVIDENCE.md)、[内容输入](CONTENT-INPUTS.md)、[总目录](../index.md) | 原始接口、许可、团队资料及历史索引 |

最新用户指令优先。旧v1/v2和旧报告保留历史，不覆盖本轮事实。前一接力入口归档于 [这里](archive/START-HERE-before-independent-review.md)。

## 3. 下一位协作者做什么

优先处理公开目录的 451：维护者可先向 Gitee 申诉内容拦截；若不能恢复，另建公开目录镜像并登记故障切换。不要把这个问题误判为市场包或制品下载失败。源码构建、市场安装、随包目录和制品下载已有本轮证据，继续工作时应先复用这些证据，避免重复全量审查。

首页保留发现/全部插件/我的插件。人工精选和规则排序都做；留首页补充、更多工具、二级页、详情补充、作者工具五类位置，后续成员无需改核心安装器加内容。独立DSH扩展不是“以后再说”的占位接口。

不做在线作者账号/认领/自动发布或任何Star；不在新手电脑构建作者源码，不引入自由模型工具，不改官方/公共协议，不把私人开发仓当生产下载源。公开 Gitee 只放发行资料；源码协作仍需要被授予私人 GitHub 仓访问权。

## 4. 环境与授权

官方源码、EAC组织仓、守岸人和用户真实profile只读。所有安装试验用 `D:/eac-market-verify/<新批次>`。原 `review-next` 留作证据，不清理覆盖。

官方桌面host固定19387端口，普通进程和隔离进程不能只换DSH_HOME就并行；后启动也可能单例转发。证明profile/userData及进程归属后才能写入。日常DSH有工作时不强退，改专用用户/VM；空闲且已有任务授权时正常退出、测试后恢复。上轮review-next专用实例已正常退出，日常窗口已恢复；其pnpm缓存共享D盘store，不能声称全部隔离。

下载遵守用户Motrix约定，大文件放D盘。工具权限以当前实际配置为准；本轮为全访问/never，不传旧require_escalated参数。不得将RPC secret、用户API Key、登录token、测试profile或个人日志提交。

本轮已获「建个人仓并上传」授权，具体是否上传和当前HEAD查Git/GitHub。该授权不包含公开仓、发行tag/npm、组织PR、评论或合并。下一轮仍按会话现有授权行动，不重复索取已给的授权，也不从文档推断新的外部权限。

## 5. 启动下一轮的最短提示

```text
请完整读取 D:/eac-market/docs/handoff/START-HERE.md，
按 NEXT-STAGE-PLAN 和 NEXT-AGENT-PLAYBOOK 实现下一阶段。
使用真正子智能体，冻结共享接口、独占文件、分波并行；主控亲自验官方Desktop最终包。
先修真实安装/确认/恢复，再接安全AI、作者两种发行方式及两种市场扩展；不要从零重建。
授权内连续完成，不让我逐阶段点继续；新重大取舍说明方案，缺外部条件准确记录。
```

完整角色和协作约束必须实际提供给 worker，不能只转发以上五行。最后逐项回答REV/AUD/ACC/E状态、最终包SHA、实测与未测、源码/远端状态、用户环境是否恢复。
