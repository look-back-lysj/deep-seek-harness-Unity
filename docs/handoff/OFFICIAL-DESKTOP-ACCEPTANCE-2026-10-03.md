# 官方 Desktop 实际安装与功能验收

**后续更新（2026-10-04）：**本报告是原始失败账本，根因与修复复验见[最新报告](OFFICIAL-DESKTOP-FIXES-2026-10-04.md)。不要把下文历史的 root cause 未确认或网络阻断当作当前结论，也不要删除这些失败证据。

日期：2026-10-03。分支：`refactor/market-core-adapter`；HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`，dirty 工作区。**结论：partial / 发布阻断；不能宣称“所有功能通过”。** 本轮实际启动官方 Desktop、用其插件页安装/启用市场并执行真实 Remote、页面与管理操作，非合成浏览器或独立 CLI 冒充实机。

## 1. 安装与隔离身份

- 实际已安装官方程序：`G:/Deepseek Harness Desktop/DeepSeek Harness.exe`。exe 版本和 asar manifest 均为 **0.2.0-rc.2**；`@deepseek-ai/dsh-desktop`，官方 commit `04f392c9ddd144fa426da2045178797da6db6c11` / dirty=false；实际 DSH getter 同为0.2.0-rc.2。
- 当前接力原指定载体0.2.0-rc.1。本轮没有取得/安装rc.1，**rc.2实测不替代rc.1验收**，也不擅自改原验收规则。
- 全新批次：`D:/eac-market-verify/desktop-20261003-rc2-b1`；DSH_HOME=`<批次>/harness`，Electron user-data=`<批次>/electron`。未读取/复制日常 Profile、会话、密钥或模型凭据，未修改官方源码/asar。
- 官方固定web端口19387被其他实例占用；第一启动失败。仅隔离 Profile 的webserver改为127.0.0.1:0，随后正常启动，不停止原实例。
- 选择官方“Add API Key → Set up later”，无账户/模型凭据；AI 正向能力因此未验。

### 当前源码包

| 制品 | 版本 | 实际安装SHA256 |
| --- | --- | --- |
| Core | 0.1.6 | `832d7d5158c3bb12a92d3c2dcea2468667c336d59951d2e96e2a70c0f938a6d7` |
| Adapter（Registry Core依赖） | 0.1.0-mvp.17 | `4ec168d49bf773157d6415e7f99cf16ae6f781a87cad09839a3e8d78e084e417` |

安装源为隔离 loopback Registry，不是正式公网源。官方“Plugins → Add plugin → Custom address”安装 `@dsh-eac/market@0.1.0-mvp.17`，Profile 顶层只新增市场，Core/Zod/SemVer由官方pnpm11.7自动取得；Core0.1.6、Zod4.6.5、SemVer7.8.5实物存在，启用后EAC侧栏/主页正常。8个已安装核心/页面/合同/目录文件与当前构建字节逐项相同。

曾先测试 URL-Core 依赖版本，Adapter SHA256=`ac7cb7967f8b5b386bdd04c406d4f17cc0cbb90960fa2a00e6137fc40b1f1e59`，**官方拒绝**：`ERR_PNPM_EXOTIC_SUBDEP` / blockExoticSubdeps。不关闭供应链保护，改精确Registry依赖继续。正式双包交付须按此真实限制再验，不能用此前CLI-smoke推断URL子依赖能安装。

本地Registry测试元数据没有time，官方警告跳过minimumReleaseAge；此为夹具缺项，不能当正式供应链验收。所有包/日志只保留本地，未上传/发布。

## 2. 实机发布阻断与问题

### P0：带市场启用的完整冷启动失败

热安装/启用可运行；完整退出再启动，官方窗口停在 `HARNESS / Loading plugins…`。欢迎页报 `desktop welcome: Web RPC failed`，locale bootstrap 同样失败。

从**实际该实例** `/api/settings/describe` 获得领域错误：

```text
gateway/definition-unavailable
typert gateway: settings/describe: its strict definition was withdrawn and SRC fallback is forbidden
```

官方boot重试曾返回injections，但再次重载仍无法进入主界面；**重试/注入结果不算启动通过**。仅隔离patch禁用`dsh-eac-market`，同安装依赖/数据下完整重启可进入官方工作区。保留“市场启用相关的冷启动回归”结论，不据此假定确切根因。

独立只读复核：官方gateway该分支要求local.get为空且hasSeen=true，证明settings严格定义曾注册后撤回；可能来自typert-loader entry失去资格或注册effect清理。当前市场39个invocation都属eacMarket、无直接settings定义；schema工厂可创建。本地与官方Zod版本相同但不证明同实例解析。**尚未查明撤回owner/时刻，不能归因于某个schema、Zod或官方bug，也不修改官方代码绕过。**

### P1：目录制品、公网刷新与README正向链路未通过

在市场实际预检 `dsh-settings-scroll-fix@2.0.2`，确认启动真实Task；获取来源失败，最终failed/changed:false、0已完成，未装插件。同幂等请求仍返回同taskId；实际TaskDrawer展示5条历史与获取/校验错误，没有伪造成功。

默认Gitee/GitHub刷新和GitHub README预览均被安全检查拒绝，错误为“来源主机解析到本机或私网地址”；旧目录保留并标stale。**没有关闭SSRF限制或静默换来源。** 单独终端DNS复核Gitee/API GitHub返回公网IPv4，但不是当时官方Host解析过程；raw.githubusercontent.com解析失败。网络/实际解析上下文根因仍待进一步诊断，不能直接称整个公网或目录服务失效。

### P1：作者异常未统一脱敏

真实authorMediaRead对不存在draft返回ENOENT，错误消息包含隔离Profile绝对路径。诊断导出本身去敏通过，但不能因此说所有Remote错误去敏。本轮仅记录复现，不在正式数据或报告中复制凭据。

### P2：作者列表不随页面显示/外部新增重新读

草稿在真实后台已保存，打开长期挂载的作者页却显示“还没有保存的草稿”；Page reload后列表显示，重开/页面保存/阅读预览可用。当前AuthorWorkspace挂载即读列表，隐藏页面切回并不重读。此为UI数据刷新边界，不是后台草稿丢失。

### 测试限制与脚本误判

- 真实生成Remote要求optional参数占位：`checkUpdates()`零参数报expected1，`checkUpdates(undefined)`与现有UI显式request正常。初次脚本失败记录不能算真实更新功能失败或忽略生成协议差异。
- 初次脚本用了错误policy字段、把未知taskEvents空页当成应抛错，轮播暂停找错“播放”而实际为“继续”，作者菜单找错“作者工作区”而实际为“作者工具”。纠正脚本后的补充结果单独保存，不覆盖首轮原记录，也不修改产品来迎合错误断言。
- 在真实页面下尝试CDP窄屏/forced-colors emulation，观测viewport仍1280x822、媒体queries=false，**未生效，不能计窄屏/高对比通过**。读屏、物理DPI、120%–200%原生缩放未验。

## 3. 功能分组实际结果

| 功能组 | 本轮结果 | 证据与未完成边界 |
| --- | --- | --- |
| 官方市场安装/自动Core取得/热启用 | passed（隔离Registry） | 官方插件页实际安装；EAC出现；8文件字节比对相同；正式公网Core未验 |
| 冷启动/完整重启 | **failed / P0** | 市场启用时settings定义撤回；禁用对照正常；不能计恢复验收通过 |
| 发现/轮播/全部目录/搜索/详情/返回 | passed（实际页面） | 已有61plugins/21listings；轮播next/pause；搜索精确条目；未逐个验证61个第三方功能 |
| 宿主版本/协议/版本列表 | passed（API-only） | 官方getter0.2.0-rc.2；61包逐一releaseOptions；错误输入拒绝；不默认选择；新UI选择尚未实现 |
| 核心不适配保护 | passed | skin loader要求0.1.7-rc.2时真实预检core-too-new，零Task写；不能靠tryUnverified绕过 |
| 安装预检/取消确认 | passed | 侧栏插件真实详情与计划，关闭不启动Task |
| 插件下载/成功安装/升级/降级 | **failed / blocked** | 实际安装Task公网制品获取失败；无成功安装，不宣称升级/降级、依赖图、套餐通过 |
| Task失败/历史/幂等/页面重载 | passed（失败分支） | taskId保留、5条真实history、重复start同task；完成任务、取消竞态/脚本批准/重启resume正向未验 |
| 启用/停用 | passed（API-only安全夹具） | 官方安装无行为/无依赖noop，实际market禁用/启用applied changed:true，官方库存disabled/enabled吻合 |
| 卸载/结果未知/不重放 | partial | noop卸载Registry404，官方已停用但仍installed，market unknown changed:true；重复保持原结果不重放。**成功卸载未通过** |
| 维护/偏好/只读版本检查 | passed（现有UI及API） | true/false保存、revision冲突拒绝、automaticDownloads/Installs=false；关闭定时检查持久记录存在；调度定时正向未验 |
| 目录刷新/AgentForge | partial/blocked | 默认来源存在；失败旧缓存stale正确；未配置Forge不伪报成功；真实五类Forge导入未验 |
| 草稿CRUD/冲突/图片绑定/ZIP往返 | passed（实际服务） | 保存/重开/更新/冲突拒绝、图片digest、1317字节真实ZIP再导入、revision删除；原draft保留 |
| 作者页面列表/重开/保存/阅读预览 | partial | 初开stale空列表；reload后重开/页面保存/预览通过；公网README因上述网络未验正向 |
| 皮肤浏览/缺管理器提示 | passed（降级） | 浏览13款，无实际uiSkinLoader；**安装/切换正向blocked**，现有皮肤要求旧runtime |
| AI分析/确认 | partial/blocked | 无授权API key时分析failed、伪proposal确认blocked changed:false；真实模型提案与执行未验 |
| 诊断导出 | passed（该接口） | redacted=true、环境身份吻合，未含Profile路径；不覆盖作者错误脱敏失败 |
| 键盘/modal | partial | CDP可信Tab留在TaskDialog、Escape关闭；触发按钮由脚本打开未focus，不能计完整焦点恢复验收 |
| 主题/高对比/读屏/真实缩放 | not-run | 仅实际深色截图检查，emulation未生效；无native验收不能写通过 |
| 扩展/套餐/离线/Force等 | not-run/not-implemented | 目录无pack/collection；未装合作扩展；不临时填入假目录冒充产品功能 |

## 4. 39个 Remote 覆盖账本

以下“安全分支”不等于正向全功能通过；API-only与页面验证区分。未触发方法保留not-run，不计算虚假总通过率。

| Remote | 实际调用结论 |
| --- | --- |
| clientConnect | 旧最低2.0握手accepted，返回Provider2.1/Core API1.1 |
| hello / hostCore | 实际已安装版本、DSH runtime0.2.0-rc.2正确 |
| catalog / inventory | 目录61/21、官方市场active、noop启停事实核实 |
| releaseOptions | 61个包逐一真实调用，核心范围/unknown/来源不补造；参数安全拒绝 |
| catalogSources | Gitee/GitHub默认来源、stale状态真实 |
| catalogRefresh | 失败、原目录保留；正向未通过 |
| agentForgeRefresh | 未登记sourceId返回failed，不是导入通过 |
| maintenanceStatus | 本环境、市场/失败Task/noop维护状态读取 |
| checkUpdates | 实际request/undefined占位成功，旧零参数不符合生成arity |
| updatePolicyGet / updatePolicySave | 读、保存关闭automaticChecks、revision冲突拒绝；自动写始终false |
| planCreate | 可安装条目ready；已知过新核心blocked；UI取消零Task |
| taskStart / taskGet / taskList / taskEvents | 实际失败安装与分页history；start幂等sameTask；unknown任务events可空页 |
| taskCancel | **not-run**：没有在途可取消成功任务；不把误判中止脚本当已调用 |
| taskApproveBuilds / taskResume | 不存在任务安全拒绝；授权/重启正向未验 |
| pluginSetEnabled | noop disable/enable实际applied+库存核实；重复disable原回执；市场自保护拒绝 |
| pluginRemove | noop unknown changed:true/Registry404、重复不重放；自卸载拒绝；成功卸载未通过 |
| authorDraftList / authorDraftGet / authorDraftSave | 原草稿真实保存/查询/revision冲突，页面reload后重开/保存成功 |
| authorDraftDelete | 错revision拒绝；只删除本轮导入副本并核实不再list，原稿保留 |
| authorMediaRead | 图片digest/binding验证；错误draft泄露绝对路径为P1 |
| authorExportDraft | 真ZIP及摘要验证 |
| authorTransferBegin / authorTransferChunk / authorTransferRead / authorTransferDispose | 真图片入站、ZIP出站再入站、完成后释放；内容digest核实 |
| authorReadmePreview | 非法本机URL拒绝；公开GitHub预览网络阻断 |
| authorReadmeImport | 非法本机URL拒绝；正向未验 |
| authorReadmeApplyPreview | 伪preview不存在安全拒绝，真实网络preview没取得故正向未验 |
| aiAnalyze / aiConfirm | 无凭据failed、伪proposal blocked；真实模型正向未验 |
| diagnosticsExport | 去敏事实输出通过，不能代表全接口脱敏 |

## 5. 证据与现场

- 截图：`D:/eac-market-verify/desktop-20261003-rc2-b1/market-home.png`，已人工查看实际1920x1233截图；不是合成fixture。
- 原始实机领域/UI结果：工作区`.verify/desktop-rc2/`，含summary、api-results与addendum、ui首轮/修正轮、author-task-ui-final、real-install-plan/task、management-results、network-policy-readme、installed-byte-comparison、cold-without-market、settings-rpc-error等。
- 原始首轮API脚本13pass/3fail、UI修正轮10pass/1fail，不把错误脚本断言修改后直接抹掉记录；以本文具体事实/补充结果为准，不简单拼接总“通过数”。
- 本地制品/Registry请求证据：`C:/Users/metaone/.codex/visualizations/2026/10/03/01a0ffdb-e738-7783-922b-fab830004ed0/desktop-market-registry-b2`（市场首次成功安装），b3包含noop。早期URL包在desktop-market-artifacts；失败b1 Registry现场保留。
- Desktop原始日志可能含仅本隔离实例的launch token，**不提交/发布原始日志、cdp全boot注入或Profile数据**。本文只写去敏事实。
- 原验收Profile保留已安装市场/草稿/Task/未知卸载记录，市场最后按诊断patch **disabled:true**，automaticChecks关闭；noop仍installed disabled。没有声称完成卸载或删除测试目录。
- 结束时隔离Desktop exit.json为code0，最终调试端口63081及取包端口61000/56079/50182均不再监听；三工具session查询已不存在。两次请求主动停止服务的审批超时，未声称这些命令执行成功，最终只读状态确认已退出。

本轮产品运行源码未修复；新增验收脚本/fixture及文档，串行构建产生本地制品。脚本语法与git diff --check通过；**本轮未重跑全量产品单元测试**，此前1242pass/1fail/2skip属于第三批历史证据，不能写成本轮实机结果。

## 6. 下一步与放行门槛

1. **先修P0冷启动，再谈发布。** 追踪官方settings contribution注册owner、首次withdraw时刻、settings与typert-loader fiber状态，比较冷启用/禁用；不要改官方源码或放开SRC fallback绕过。
2. 修作者错误脱敏与作者列表显示/刷新代次；保留用户编辑与其他窗口revision冲突。
3. 核实真实Host网络解析/代理与safeFetch边界，明确Registry-Core可安装路径；修复公网链路不能以allowPrivateHosts或关闭供应链限制取得表面通过。
4. 恢复可安装且当前runtime适配的真实制品后，完整跑安装成功/升级/降级/卸载/取消/脚本授权/重启恢复，以及skin manager与切换。
5. 配置获授权的测试模型再验AI正向；不借用日常凭据。rc.1载体、native缩放/读屏/forced-colors逐项标待验。
6. 全回归/最终双包摘要/实际官方新装与冷启动全部对应同批制品；修复后必须重打新候选并重装重验，不能靠本轮热启用结果放行。
