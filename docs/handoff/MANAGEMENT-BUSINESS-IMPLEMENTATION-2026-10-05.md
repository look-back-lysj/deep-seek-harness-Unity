# 管理业务回执与前端原意图恢复实施实录

日期：2026-10-05，Asia/Shanghai。工作区：`G:/Code/fork/agent-market`；分支：`refactor/market-core-adapter`；HEAD：`9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。这是当前未提交工作区的实施与隔离验收，不是发布记录。

## 1. 本轮范围与协作

执行主人要求的“后端先修，可并行部分同时做”。主控修改Core管理业务回执、恢复接线与测试，串行集成/构建/打包/官方操作；Client子智能体独占前端及测试；来源子智能体独占只读公网审计和辅助工具。两名子智能体已交回并冻结，未增加第三方库、第二任务系统或公共Remote。

保留开工前所有未知和未提交文件；未修改官方源码/asar、外部Agent Forge仓、日常Profile、VPN/DNS/hosts或安全软件配置。候选仍为Core `0.1.6` / Adapter `0.1.0-mvp.17`，只用于新的本机隔离Registry；同版本新字节没有上传或覆盖正式发行。

## 2. Core实现（RW-13A）

涉及`core/execution-state.ts`、新增`core/management-record.ts`、`core/task-manager.ts`、`host/operation-recovery.ts`和`host/market-runtime.ts`。

1. 既有schemaVersion=1管理记录新增可选completion：完整PluginActionResult、维护提交的saved/revision或not-required事实、绑定原fingerprint/outcome/receipt/result/maintenance的SHA-256摘要。不另建记录系统、不把stage=settled解释成完整业务已完成。
2. 按顺序执行：保存原请求与dispatch事实→保存原官方回执→核对后置状态→提交维护意图→耐久保存完整业务凭证。维护提交、完整凭证保存及卸载preflight纳入现有execution锁，避免官方写已结束而业务提交仍在锁外的窗口。
3. 维护保存失败返回`management/maintenance-save-failed` unknown；业务凭证保存失败返回`management/business-result-save-failed` unknown，保留真实changed、权限变化和诊断，不把已写入的失败压成changed=false。
4. 新记录的原完整请求同key再次调用直接返回历史结果，不再读当前库存猜结果，不再调用官方动作或维护提交；同key不同内容拒绝。目标后来被删除/重装/启停不改变已有历史完整结果。
5. `pluginActionRecover`只读原记录。旧记录缺completion仍返回`management/business-result-unavailable` unknown；not-found不证明没写入；损坏/不一致凭证拒绝。查询不补维护、不调用任何官方写。
6. 只有调用方明确重入原管理写API时，旧记录才可能在原官方状态仍可核实的前提下补业务提交，且不重放官方动作；目标状态已变化时拒绝补提交。不能把只读核对偷换成迁移或补写。
7. 公共结果去敏；applied、restart-required、failed且changed=true/false、权限变化、cancelled等原语义保留，unknownSharedImpact不能形成可信completion。

公共恢复协议未变，仍是not-found或found+stage/receipt/result；不提高Client最低Core API/Remote版本。

## 3. Client实现（RW-13B）

涉及MarketPage、新增management-request/management-pointer、action-state/action-feedback、既有task-request-guard及对应测试。

- 写前按可信environment保存一次原packageName、expectedVersion、action和key；最小浏览器指针不存凭据、库存或业务结果。
- 20秒仅是展示超时；原Promise未结束仍保留在途锁，迟到回包不能覆盖unknown或新连接。可能已提交后的传输错误不提供自动新key重写。
- 导航、重连、重挂及页面重开以原身份只读核对；capability与optional方法双重探测。not-found、缺完整业务结果、旧unknown、存储损坏/不可访问/清除失败均保留保护。
- 官方stage/receipt与完整业务result分开显示。只有可信完整终态且原指针安全清除后允许新管理操作；若原Promise还pending则继续锁定到它实际结束。
- 保留官方/系统组件保护、卸载两步确认、权限与changed事实、restart-required和官方核对入口。

后端仍只提供API、业务事实及耐久回执；loading、展示超时、核对按钮、存储指针、页面恢复和提示由Client实现。

## 4. 源码验证与夹具故障

证据根：`.verify/management-business-20261005/`。

- 后端focused扩展：92 passed / 0 failed；Core tsc与完整`node scripts/build.mjs`通过。
- 额外Client测试tsc、lint与双包边界检查通过；当前打包校验Remote描述符为41，不据此宣称41个功能都在官方通过。
- 后端宽回归首轮774 passed / 2 failed：既有update-check-scheduler计时用例；隔离重跑24/0。保留首轮失败，未改阈值或scheduler。
- 首轮全量并发：1748 passed / 2 failed / 114 pending；随后串行：1800 passed / 0断言失败 / 64 pending，仍因夹具beforeAll失败而整体不通过，不能用“0断言失败”报成功。
- 真实诊断确认四处隔离Edge夹具被注入的Kaspersky域脚本阻塞：页面ready=loading、body为空、fixture未定义。仅在各测试CDP会话中阻断精确`http://me.kis.v2.scr.kaspersky-labs.com/*`，产品请求与SSRF规则不变，未改安全软件或系统配置。不是增加sleep、降低断言或跳过测试。
- 首三处夹具专项修复86/0；版本选择第四处诊断失败保留于`release-fixture-before.log`，修复后50/0。管理focused39/0（React/Edge27、逻辑12），覆盖clear抛错与恢复完成但原Promise仍pending时的零新写。
- 最终完整串行回归1866 passed / 0 failed / 2既有skipped，整体success=true；通用browser-check49/49。最终Client测试tsc、lint、包边界、browser脚本语法及diff检查通过，证据分别为`final-full-corrected.json`、`browser-final/browser-results.json`与`final-validation-status.json`。
- 通用browser-check也复现相同注入脚本阻塞，已限定测试CDP隔离修复；默认输出改为独立时间戳批次，避免继续覆盖历史路径。本次首轮使用旧默认地址写了失败结果，已复制到本批`browser-check-initial-failure.json`；上一媒体批次的49项原始证据仍完整保存在`.verify/media-vpn-20261005/browser-check/`，不拿重写后的旧默认文件引用历史通过。

## 5. 官方Desktop实际安装与管理

实际载体：官方Desktop `0.2.0-rc.2`，build `04f392c9ddd144fa426da2045178797da6db6c11`，dirty=false。原指定rc.1仍待验，rc.2不冒充rc.1。

隔离Profile：`D:/eac-market-verify/desktop-management-business-20261005-b3`。不可变本机Registry：`D:/eac-market-verify/packages-management-business-20261005-b3`。通过官方Plugins→Add plugin→Custom Registry安装并Enable now，未直接写官方插件文件，未降低blockExoticSubdeps。

| 制品 | SHA-256 | 真实安装字节 |
| --- | --- | --- |
| Core 0.1.6 | `6384d553776e512d906e034ba88a0f13cf0816e58f682b3c7460e74c0c614efa` | 95/95，与tgz及当前lib一致 |
| Adapter mvp.17 | `a1ef8023e335acb821105359ab3a849c3fe0eb176c8fafc2564543cb1c351428` | 96/96，与tgz及当前lib一致 |

验收只管理本工程合法noop fixture，不安装/执行来源未知的第三方插件，不调用模型。

1. 官方API停用→启用→卸载及后续历史/冲突检查四组通过；原完整result与实际原返回一致、维护explicit正确；删除后查询历史启停结果仍稳定。三个私有completion实际存在。
2. 原请求重复只读核对三组通过，未重放写入。首探针将每次新生成的maintenance.generatedAt当业务变化误报；失败文件保留。纠正为比较全部业务事实及revision、仅剔除合同规定的快照生成时间，再通过，不改产品。
3. 14:12:15北京时间请求Browser.close，14:12:16官方code0退出；后续核实本PID/userdata进程为零，没有受控终止。14:13确认清零后冷启动，原三组完整结果只读恢复通过。
4. 官方Client冷启动恢复原真实disable身份、分开展示receipt/result且安全清除指针通过。该跨重开指针由验收脚本种入，明确标记faultInjectedPointer；不是自然断线或传输超时的cold-start正向证明。
5. 重装并启用合法noop后实际点击市场停用、启用及两步卸载。停用首探针漏采瞬间清除的指针；只读取得Client保留的原identity并核实完整回执，未重放该动作。改用保留identity继续启用/卸载，三个独立原key最终均有完整applied记录。
6. 实际卸载耗时超过20秒，Client如实显示unknown、保留原key并锁定，不是fault injection；探针第一次过早核对后等待超限的失败保留。稍后明确点击“核对原操作”，只读取得原完整result，指针清除、卸载Modal关闭、库存无fixture。实际UI三组最终只读核实通过，没有自动轮询或重写原卸载。
7. 第二次实例在14:36:38北京时间code0退出，收尾查询本PID/userdata为零；未取得退出发起者证据，不将其冒充主控第二次正常退出验收。后续截图端口已关闭，未生成图片，不补记本批视觉截图通过。

收尾确认本官方userdata及本批Registry进程为零，Profile、不可变制品和失败全部保留。另关闭两份此前已观察到的eac-author-refresh隔离测试userdata残留Edge进程，未删除测试目录；其创建时间早于本批，不能说是本批创建或将其存在当作测试阻塞的因果证据。精确PID、范围与说明保存在`cleanup.json`，最终清零证据为`cleanup-final-confirmed.json`。

证据：`official-business-initial.json`、`official-installed-bytes-and-completion.json`、`official-business-readonly-repeat-corrected.json`、`official-normal-close-confirmed.json`、`official-business-cold-readonly.json`、`official-client-seeded-pointer.json`、`official-client-cold-restored.json`、`official-client-actions-readonly-final.json`。采样/过早核对等失败与原请求分别留存，不删除未知记录。

## 6. 来源并行核实（RW-11/14/15）

最后只读复核为2026-10-05 13:41～13:42北京时间：八次小文档请求全部HTTP200，普通HTTPS与原Core safeFetch两条链路摘要相同；公开revision仍为`20261004T180213Z`。Agent Forge main为`ef33ea9e2baa240f72bb8c5d12471919edc59696`，packages为`3022bd1b898093d8aa90f76ebe0989b517195aa2`，不是直接沿用旧main值。

- 六份公开完整记录声明26张preview，四个真实图片URL两条链路均取得完整同摘要字节；未下载保存图片绕过显示限制、未宣称官方图片解码/展示通过。
- 真实dsh/plugin index的18,375,959字节超过现有8,388,608字节门禁，原reader实际拒绝delivery/too-large。这是已定位的体积阻断，不是“整个公网不可达”。未擅自增大门禁或用本地子集冒充公开源。
- 六份样本未声明icon/theme、可信DSH运行时范围与版本/历史映射，许可记录unknown；作者tag/Release不等于目录可安装包版本。两份公开ZIP有界下载未成功取得实际摘要/身份，不能试装未知制品。
- 建议source config仍enabled=false，未应用到任何Profile。独占60文件与工具摘要已冻结，详细见`.verify/management-business-20261005/source-audit/FINAL-HANDOFF-20261005.md`。

## 7. 剩余任务与顺序

1. RW-13收尾：以最终全量/浏览器检查和本实录更新入口、账本、计划；源码与本批rc.2管理范围可分别关闭，不把它扩大为全产品通过。
2. RW-11/15：向上游提交体积/缺字段证据，取得真实可固定revision、符合门禁的媒体源及完整记录；本仓不修改外部源、不合成发布事实。另有明确评审与资源预算前不扩大读取上限。
3. RW-14/03：取得真实DSH semver范围、已声明且可下载核验的不可变制品、历史覆盖；再跑版本列表→默认适配→预检绑定→公网摘要→官方安装→原task只读恢复。范围缺失保留unknown，不拿Desktop发行号替代dsh版本。
4. RW-08：本批一次正常退出通过不证明上批关闭竞态已修复；保留上批失败，建立独立对照组并定位资源/宿主等待owner。原指定rc.1载体仍需可信来源。
5. RW-09/10：补真实升级/降级、多依赖/套餐、审批/取消/重启、皮肤与无障碍/DPI/主题/图片矩阵。真实用户Profile、模型费用和新增工具仍需主人授权。
6. RW-07/12：获准后决定新发行号、冻结真正公开Core/Adapter匹配制品、验证mvp.9升级/回退并分开提交/发布；本轮无commit、push或release。

下一位协作者先读当前入口、最终证据与来源blocked清单，不重跑已完成写探针、不重用未知key、不清空旧记录解除保护。
