# 第二轮独立复查：真实安装、交互与下一阶段边界

日期：2026-09-28。源码基线：`ea84b9f79754e720efde2bb8f38988faabc695eb`。本轮交付为**复查与实施规划**，没有修复业务代码。下一轮执行入口为 [START-HERE](../handoff/START-HERE.md)，实施顺序为 [下一阶段计划](../NEXT-STAGE-PLAN.md)。

结论：市场能够通过官方安装页安装并显示，也确实能调用官方安装器安装一个无害测试插件；但目前不能称为可靠完成的商城。真实手点发现未验证试装确认失效、安装后库存不刷新、目录刷新误报；独立探针进一步复现取消、恢复、来源及 AI 接线问题。优先修完整调用链，再增加作者与扩展能力。

## 1. 本轮核对对象与证据等级

| 对象 | 实际状态 |
| --- | --- |
| 工程 | `D:/eac-market`，首次提交 `ea84b9f` 保存既有实现；提交前仅整理忽略规则及 37 个文件的末尾空行，没有借审查改业务 |
| 官方源码 | `D:/deepseek-harness-source/deepseek-harness-master`，根版本 `0.1.7-rc.2`，无 `.git`，不推断上游提交 |
| 官方 Desktop | 本机已安装 Windows x64 `0.1.7-rc.2`；通过原生电脑操作工具实际点击 |
| 团队协议快照 | 本轮经已登录账号的 GitHub API 核对 `DSH-EAC/DSH-Desktop-EAC` 的 `beta-pack`，仍为 `44178ab1360dcb8221a666e782391a11f5716074`；此结论不代表所有远端分支或看板均无变化 |
| 测试包 | `dsh-eac-market-0.1.0-mvp.0.tgz`，358423 字节，SHA256 `A15C1A1AFA46197E71A8329ED513E6F8A128074DD274DF65CF3FAECE2CBE944C` |
| 安装后入口指纹 | Host `4774DE003FF0C538DEDC91E1A7661EC0D118766485B43EF7D0A4FE7CC447D7EF`；Client `8A3754625B14A154E7FF72A83467D2BF76EBD6DEB81A5161923EF45327F98155`，与被测包一致 |
| 重新跑的原有测试 | 12 文件、49 项通过；不是重跑全部 110 项，也不是本次全部产品验收通过 |

证据标记：**D**＝官方 Desktop 亲手操作；**S**＝当前源码；**P**＝生产类搭配合成服务的探针；**F**＝探针使用真实文件锁／持久层。P/F 不等于真实第三方插件或真实模型验收。报告中的源码行号定位于上述基线，后续按函数名查找。

测试目录为 `D:/eac-market-verify/review-next`，DSH_HOME、Electron userData、APPDATA、LOCALAPPDATA、Agents 目录均使用该目录下专用路径；pnpm 使用已有 `D:/.pnpm-store` 缓存并配置 offline，**没有做到包缓存完全独立，也不宣称是网络隔离沙箱**。测试未调用真实模型。

官方 Desktop host 固定占用 `127.0.0.1:19387`（官方 `apps/desktop-host/src/index.ts:30`），并行启动曾因端口冲突失败。随后正常退出空闲的日常 DSH，再启动专用实例。测试结束正常退出专用实例，并恢复日常 DSH 可见窗口；真实用户 profile 没有新增市场或 fixture 依赖。失败现场保留，不将环境启动失败记成市场缺陷。

## 2. 真实体验记录

| 编号 | 实际操作 | 观察与边界 |
| --- | --- | --- |
| D01 | 新 profile → 官方「插件／添加插件」输入被测本地 tgz → 安装 → 立即启用 | 成功，侧栏出现 EAC；磁盘依赖与入口摘要吻合。补足旧报告 R10 的**市场包官方安装页**证据 |
| D02 | 进入发现、全部插件、我的插件和任务 | 关闭态抽屉遮挡已改善；首页首屏主要是大段教学与技术说明，核心浏览入口不突出。未作帧率性能测量，不声称已量化卡顿 |
| D03 | 未配置目录来源时点击刷新目录 | 后台返回 failed，界面却显示「目录已刷新」；来源控制模块存在不等于 Host/UI 已接上 |
| D04 | 作者工具新建并保存标题为「复查用草稿，不发布」的草稿 | **首次保存成功，文件确实落盘**；没有把客户端临时 ID 误判为保存失败。重开列表、完整 README/媒体/ZIP 流程另列未完成 |
| D05 | 将合法、明确标为 unverified 的测试目录放入专用缓存，重启测试宿主；点击 fixture 的「查看安装方案」 | 出现一个未勾选的「仍然尝试安装未验证内容」框；点击生成方案得到 unverified、blockers=[]，确认按钮可用 |
| D06 | **始终不勾上述框**，点击确认安装 | 安装实际成功；官方回执 applied、任务 completed/item disabled，profile 出现 fixture 依赖。证明试装门禁失效，不是正常成功验收 |
| D07 | 安装完成后在市场内切到「我的插件」 | 新插件缺失；全部插件仍显示安装入口。官方插件页已能看到它；切到官方页再进入 EAC 后才显示。重挂载后停用包又显示「状态未知」 |
| D08 | 在市场里启用该 fixture | UI 显示已启用，profile bundles 增加 fixture；无害 Host 类能加载。它没有真实业务 UI，不能证明任意合作插件功能可用 |

fixture 为工程已有 `@dsh-eac/fixture-plugin-a@1.0.0` 的原字节副本，509 字节，SHA256 `5598c2d01736df5db979fa8311a3328c79c1f90e5a7019dc9ad4d1cae06bbc7d`。它仅是测试包；目录使用的社区 Manifest 是测试辅助资料，**不是作者包内原有声明**。本次没有从 GitHub/Gitee 下载正式合作制品，不把本地成功称为线上双源通过。

D06 计划 `plan-26820f1e864450e2b5c78854d1eec249241f9d56eea85ede0180a61496286deb`，任务 `task-6a540423502704925ff35716d7dba38a`。原始专用现场位于 `review-next/desktop-home/profiles/desktop/eac-market/state`；可共享截图及精简证据见 [evidence](evidence/2026-09-28-review-next/README.md)。

## 3. 必须进入下一轮的修复清单

P1 表示阻止可靠交付，不等于已造成真实用户损失。P2 表示影响体验、正确展示或后续接入。编号为新的 REV 系列，不覆盖旧 AUD/ACC 的含义。

| ID／级别 | 缺陷及触发 | 依据 | 完成判据 |
| --- | --- | --- | --- |
| REV-01 P1 | 未勾试装也能安装 unverified；确认 UI 与后台规则脱节 | D05–06；`core/planner.ts`、`host/market-runtime.ts:planCreate`、`client/components.tsx:InstallPlanDialog` | 未确认零写入；确认绑定确切目标、验证状态与计划；取消勾选作废旧方案；已知硬不兼容始终拒绝 |
| REV-02 P1 | 成功安装来源没有接入实际 Host 适配器，已装包被归 unknown，更新／同版本保留会被 local-identity:protected 拦截 | S/P03；`adapters/dsh/host-port.ts:142`、`manager.ts:98` | 安装→重启→更新可用；回执、依赖引用及制品一致才能证明市场归属；file/link/fork 不被猜成市场包 |
| REV-03 P1 | 已确认 sourceRef 被实际下载适配器忽略；下载期间外部状态变化后仍写入；关键库存读取失败仍可调用安装 | S/P04/P10/P14/F；`artifact-adapter.ts:18`、`task-manager.ts:625`、`host-port.ts:154` | 固定来源描述；每次写前复核环境、版本、启停、归属和关键库存完整性。变化暂停，无写入；没有证据表明摘要校验被绕过 |
| REV-04 P1 | 取消记录等待整段安装锁；下载中取消后两组件仍写入，第一组件取消后第二个继续装 | P06/P07/F；`task-manager.ts:365/515`、`persistence-adapter.ts:87` | 取消可及时持久记录并中止下载；正在进行的官方写入等真实结果；尚未开始项零写入 |
| REV-05 P1 | 官方返回 restart-required，旧运行成员仍 active 时放行依赖目标版本的后续组件 | P05；`manager.ts:201`、`task-manager.ts:806/833` | 区分磁盘版本、配置启用和运行版本；真实宿主重启且目标成员核实后才继续，不用服务重建或包数量冒充重启 |
| REV-06 P1 | 中断后重放回执未知的旧安装；摘要写成、索引失败后记录从列表消失 | P08/P12/F；`task-manager.ts:444/577`、`persistence/task-store.ts:100` | 先核对旧结果；未知不重放；孤立记录可恢复可见；逐个持久化断点验收 |
| REV-07 P1 | 仅同 planId 防重，新生成的等价计划可重复装；retryOfTaskId 未保存 | P09/F；`task-manager.ts:304/317` | 活动等价意图只有一次有效执行；冲突有查看原任务入口；明确失败后的重试建立真实历史关联 |
| REV-08 P1 | 普通启停／卸载绕开统一协调，忽略 expectedVersion 和防重键；AI 首次点击自动 riskConfirmed，且只执行 actions[0] | S/P11；P02 为**手工注入提案后的潜在分支**；`market-runtime.ts:298/378`、`components.tsx:309` | 全部入口共用确认／协调；第一次危险确认零写入；不静默截断多动作；核心和市场自身保护由 Host 执行 |
| REV-09 P1 | diagnosticsExport 固定空；AI 分析后从不登记提案，正常确认必 blocked | S/P01；`market-runtime.ts:106/374/401` | 有限脱敏证据→严格建议→Host 持久登记→确认→任务链全部走通。不能只补 Map.set 后放开 REV-08 的潜在写入 |
| REV-10 P1/P2 | 任务完成未同步库存；A 的晚到开始结果可关闭 B；AI 建议状态在多个任务卡共用 | D07、S；`MarketPage.tsx:156`、`components.tsx:179/393` | 稳定数据控制器、目标代次与任务作用域；同页完成即更新，重开与双标签一致，旧回包不能覆盖新目标 |
| REV-11 P1/P2 | 登记目录来源模块未接入 Host；刷新错误被客户端丢弃；verified 目录验证未传宿主上下文 | D03、S/P13；`market-runtime.ts:115/183`、`catalog/store.ts`、client facade | Host 只用登记来源；失败保留缓存并准确显示；有效证据按实际宿主判断，不因缺接线拒绝整份合法目录 |
| REV-12 P2 | 作者后端能力未贯通：草稿重开缺失、README 目标/revision 接线缺口、媒体预览及 ZIP 导出仍断开；Host 空 provenance 覆盖参数须修正并回归 | S；`MarketPage.tsx:350/380`、`market-runtime.ts:358`、`authoring/package.ts` | 新建→重开→README 差异确认→媒体→ZIP→另一测试环境再导入完整往返；保留署名许可及来源 |
| REV-13 P2 | 首页借 distribution= recommended 当精选；新增推荐／发布时间字段未贯通；兼容性优先排序把比较差乘 0 | D02、S；`MarketPage.tsx:800`、`client/model.ts:348` | 人工推荐记录与分发类别分开，排序用真实字段；无料时紧凑空态；不显示开发解释和假榜单 |
| REV-14 P2 | 官方正常停用或无运行成员显示 unknown；从未知成员推断重启；默认界面暴露 open-plugin-or-settings 等内部代码，市场自身有自停用入口 | D07–08、S；`manager.ts`、`client/model.ts`、`components.tsx` | 配置、运行、重启事实分开；未知只指真实缺证据；中文下一步接实际导航；市场自身管理转官方入口 |
| REV-15 P2 | 版本比较忽略 prerelease 内容，rc.2 与 rc.1 双向均得 0，进而可能把升级判为降级 | S＋本轮实际调用 `compareVersions`，两方向均 0；`core/planner.ts:36` | 复用严谨 SemVer 比较；覆盖 rc.2/rc.10、正式版、build 元数据、非法版本。不能仅凭字符串不等就猜降级 |

REV-01 已进一步核实根因：试装字段从 Client 到 Host 没丢，规划器 `planner.ts:174/251` 的套餐与单项分支都只检查 unknown，漏掉合法的 unverified。应两分支共用正确规则；验收逐项 blocker 与执行步骤，不要求混合套餐整体一律 blocked。详见 [确认专项](details/2026-09-28-unverified-confirmation.md)。

安装专项细节、原探针条件及修复备选见 [安装专项](details/2026-09-28-installation-review.md)；原始本机文件为 `D:/eac-market-verify/review-next/install-review/INSTALL-REVIEW-2026-09-28.md`。可迁移证据和复现入口随仓库保存；探针显示 reproduced 是**缺陷复现成功**，绝不是产品验收通过。

## 4. 对旧报告的精确修订

- R10：市场最终包通过官方「添加插件」安装与启用已有 D01 证据；独立合作扩展包、远端正式插件及完整市场事务仍未验。
- R01/R05：AI 不只是重启丢失，正常分析后根本没有登记；诊断空列表仍在。
- R03：`retryOfTaskId` 不只是传错，当前任务创建也没有保存它。
- 不再声称首次作者草稿保存失败，D04 成功；这不证明整个作者流程闭环。
- AUD-F01 的遮挡改善可记录；AUD-F04/08/13 等不能因上一轮改过或测试绿色直接关闭。
- 原自动检查 110 项及最终包摘要保留为当时事实；本轮 49 项重新通过与新缺陷复现并存。
- 原「尚无 Git 提交」已失效；当前实现已在 `ea84b9f` 保存。远端状态以本轮完成后的 GitHub 核验记录为准。

旧文件保留作历史，不把它们改写成新一轮已验收。后续应分别填写 `reproduced → fixed → verified`，并记录旧 AUD、ACC、新 REV 的对应关系。

## 5. 这轮没有完成或没有证明的事项

没有修复上述业务缺陷；没有进行真实模型调用；没有完成正式合作插件双源下载、降级／卸载影响、套餐故障恢复、低磁盘及断电级事务验收；没有量化 UI 流畅度或证明跨系统兼容。没有将测试 fixture 放入生产目录，没有触碰组织仓库、官方源码或用户真实 profile。

未来新能力也不是现成接口：作者双构建路径、官方-only 元数据输入、发布撤回记录、独立扩展服务和五个扩展槽位均属 [生态接口计划](../ECOSYSTEM-INTERFACES.md)；实施时才能标完成。本次上传的私人 GitHub 仓库是**源码协作仓**，不是面向新手的公共插件下载源。

## 6. 计划交叉审查与归档检查

本轮实际使用三名子智能体分别复查安装、作者分发、UI与扩展，主控亲自操控Desktop并核对关键源码与磁盘。文档形成后，两名Reviewer定向检查安装/AI方案及扩展/文件分工；发现一处“待核对可能过早释放写占用”的歧义，已改为持久阻断至旧写入停止且共享状态核实，补第二任务零写入用例，原Reviewer再次核对确认。此为**计划审查通过**，不是功能实现通过。

当前入口文档链接、代码块、Git diff空白和待提交文本秘密候选检查通过。审计工具便携副本定向重放P04/P13，仍复现原错误。上传不含tgz、node_modules、测试profile或用户凭据；已有实现及本轮报告分提交保存。其余原始探针未因路径迁移反复全跑，业务源码未更改，也未重新打包后冒用旧桌面证据。
