# 详细修改记录：核心兼容、发行选择、媒体与管理恢复

客户端日期：2026-10-05（Asia/Shanghai）。工作区：G:/Code/fork/agent-market。协作分支：refactor/market-core-adapter。

## 1. 范围、证据等级与不变边界

本文覆盖任务指定工程基线9fc09a2、接力HEAD 9c6a1d2之后的全部有效本地产品、测试、文档与交付工具变化，不限最后RW-13。9c6a1d2只是handoff提交，不能把其原始源码树当作后来未提交候选的实机安装字节。

开工按当前git diff与git ls-files --others --exclude-standard登记；主控在撰写期间提交并合并，因此改用固定基线到已提交补丁的只读差异核对，防止提交后文件从清单消失。本文件作者只新增本文，不执行测试、构建、网络、官方启动或任何修改Git状态的操作。

- **源码事实**：当前源码、合同、基线差异可核实的实现，不等于正式发行或实机通过。
- **历史验证**：已保存阶段报告及原始测试/隔离实机证据，只适用于对应源码、载体、隔离环境和制品字节；本文不重跑。
- **主控确认**：主控本轮通知的已发生提交、合并与build结果，和本文作者独立执行的验证分开。
- **待验**：没有对应证据、前置或授权的项目。not-found、unknown、blocked、API-only、fault injection、合成浏览器和实际官方UI不互相替代。

边界依据AGENTS.md、docs/handoff/START-HERE.md、NEXT-AGENT-PLAYBOOK.md、docs/PRODUCT.md与Core/Client协作者合同。官方源码/asar、组织仓、外部Agent Forge仓、日常Profile、凭据、系统VPN/DNS/hosts及安全软件均不属本文写范围。实施方案中的未执行步骤不能写成完成。

清单排除.pnpm-store/、.verify/、Profile/userdata、token/凭据日志、产品生成lib及安装/打包制品。只引用去敏证据文件名、公开版本号和SHA-256，不交付原始证据或制品。tools/desktop-acceptance/fixture-plugin/lib/index.js是手写合法noop夹具源码，不能按lib名字误删。packages/market/src/protocol-ambient.d.ts保留，未作本次改动。

## 2. 本地修复与两次上游合并时间线

| 身份/时点 | 已发生事实 | 不能推出的结论 |
| --- | --- | --- |
| 开工9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b | 本地Core0.1.6/Adapter0.1.0-mvp.17有效变化当时未提交 | HEAD原树等于实机候选；正式发布 |
| 远端更新 | 主控报告fetch首轮reset、HTTP/1.1单次重试成功；只读ref/log核实origin到b8a977b，相对开工HEAD多3提交 | 本文执行fetch；本地已合并/推送 |
| 3fa1fc6 | 主控提交113个有效产品/测试/lock文件；只读提交差异核实范围 | 所有文件都有实际UI验收 |
| 9709c75 | 主控提交22个既有实施报告/指南及handoff夹具；只读差异核实 | 全部历史计划已执行 |
| e880a883a84e86d284bd2ddcf08ccc301ec705a8 | 正常merge，父提交为9709c757c8f74fb2dab162457dfcb38f38af5f44与b8a977b868eea0bd2f937c875afd38ae2a20aabb，双方历史保留 | 合并后全量、新字节官方验收或push通过 |
| 合并后 | 源码Adapter为mvp.18；主控确认merged源码build通过 | 旧mvp.17的1866/0/2、browser49或字节比对可用于新UI |
| 84a516b | 31个工具/fixture/离线测试/独立审计输出/忽略规则文件提交 | 官方新版安装或完整layout-audit通过 |
| 5df36be | 详细开发者交接、修改记录及四处入口/状态文档提交 | 当时未产生的第二次合并或远端push已经完成 |
| 推送前再次fetch | 网络失败后按主人“重试”成功；origin由b8a977b前进至4f9a627，新增5提交 | 可以force覆盖远端，或mvp.18数字适用于mvp.19 |
| 第二次正常merge | 父输入为5df36be和4f9a627；源码Adapter为mvp.19，两个子智能体分别处理独占Client冲突与只读语义复查，主控串行处理Core/合同/测试/文档 | 新官方制品、真实UI矩阵或晚到回执追账通过；结果SHA不能在自身提交内自引用 |

上游三提交：f47174a（StoryStream/tactile/布局节奏、mvp.18）、aa2ef09（mvp.18 Registry/GitHub adapter制品准备）、b8a977b（双通道固定URL文档）。两个Git冲突按主控通知已解决：MarketFrame保留documentHidden类及MEDIA_CSS；Detail用上游全宽带头并保留CatalogMediaIcon；dialogs保留6条history严格断言及上游结构断言。未通过丢弃任一方功能或放宽断言解决冲突。

上游视觉将发现页改编号章节/轨道流、目录改行情行、库存改机架行，加入详情带头、设置台账及任务日志。触感层包括按钮台阶、精确指针磁吸、状态动效和成功彩纸，兼顾reduced-motion、forced-colors、页面隐藏；布局修正空轨道/行尾空白、导航对齐、详情半空列和按键错位：行布局flex、详情单列流、按钮本体不随按压推移内容。DESIGN.md里的上游758/0/2、browser54/55等是上游历史自述，不能作本次合并数字。

**发行风险**：上游归档包/固定URL存在只证明仓内材料存在；其打包早于本地业务修复合并，不能推断制品包含新Core/Adapter字节。merged源码重新打包、双通道依赖/摘要绑定、最终测试、新字节官方验收及远端交付由主控补录。指南“正式发行包”用语不替代公网可得或实机证明。

## 3. DSH核心身份与完整semver范围

### 3.1 根因和可信身份

Desktop发行号、market-core包版本、Core API和旧hostVersion都不是目标Agent核心范围的替代值。早期HC-0曾把版本域列为未决，主人随后明确：Forge dsh范围对应官方getDshRuntimeVersion()返回的DSH运行时版本；本文采用最新决定，不把早期未决当当前结论。

Adapter新增src/host-core.ts读取官方getter，提供HostCoreSnapshot：Agent身份/名称、version/status、versionScheme、source、hostRevision。getter缺失、抛错、非字符串、首尾空白或非法semver降为unknown，不回退Desktop发行号。revision用SHA-256绑定身份，OfficialHostPort的hostFingerprint加入核心revision。Core只消费Adapter可信注入，不扫描电脑或猜Profile；hello.hostCore、hostCore()与版本API接线，Client tsconfig排除Node Host模块。

### 3.2 声明投影与范围评估

- Agent Forge保留完整记录原字节、metadataDigest、target/name/version及sourceId/revision；packageDocuments与离线packageBytes避免解析重编码丢原证据。
- target级versionScheme保留semver/npm/pep440/calver/date/custom/unknown，缺省不补semver，package级scheme不冒充target规则；engines.dsh/核心peer投影为npm规则。
- evaluateHostCompatibility使用固定semver@7.8.5与@types/semver@7.7.1，lock同步；caret、tilde、hyphen、OR、通配和严格预发行语义由成熟库处理。本文不安装依赖。
- 多声明按允许集合求交：等价字符串/部分重合不自动冲突，空交集为conflict/metadata-conflict；证明整个集合的上下关系区分core-too-old/core-too-new，OR空洞或排除预发行用core-range-mismatch，不只比较minVersion。
- 缺范围/身份/规则、非法值、非semver/npm方案分别unknown；目标不符和元数据冲突有独立原因。无关Agent坏声明不污染目标，空白不当通配。
- 128声明、4096字符范围、4096证明步及安全数值边界超限安全未知，reason为core-range-evaluation-limited。严格宿主预发行判断不因展示预发行包放宽；不替代官方pluginManager的安装/peer决策。

### 3.3 发行事实和更新比较

evaluatePackageReleaseFacts分开报告真实installed、当前接受目录/通道latestPublished、核心匹配latestCompatible、歧义、历史覆盖与stale。兼容性、verification、制品可用性三维独立：缺制品不让最新核心匹配版悄悄退旧，缺实测不伪称不适配。

完整身份含pluginId/packageName/version/metadataDigest/artifactDigest/releaseId。同包同版多摘要/声明不由Map最后值覆盖，镜像不制造假歧义，同precedence不同build身份保持歧义。真实已装比目录新保留降级关系，库存unknown不从目录补版本；历史不全时latestCompatible=null不等于全历史无适配版。update-check附releaseSummary仍只比较，不下载/安装、不返回UI默认选择。publication来自接受生命周期，不从hard-incompatible/缺制品推断撤回。

阶段入口：HOST-CORE-IMPLEMENTATION-2026-10-03.md、HOST-CORE-RANGE-IMPLEMENTATION-2026-10-03.md、HOST-CORE-API-IMPLEMENTATION-2026-10-03.md、HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md；测试是实现证据入口，不代表上游字段已补齐。

## 4. 目录版本、来源合并和生命周期

根因包括按pluginId覆盖导致多版本丢失、镜像最后写入覆盖撤回/冲突、库存只按数量revision掩盖同数量状态变化。catalog/merge.ts与MarketRuntime.readCatalogContext合并base及已登记来源，输出sourceRevisions/mergeIssues。

- 按id+version/package+version核对完整候选；来源同名而revision/快照不一致、身份/内容/引用冲突显式报告并暂停对应候选，不擅定权威。
- 展示、交付、packs和私有collections保持完整引用检查；listing始终资料、不可安装。整体revision反映可核查内容，来源覆盖取保守值，不把多个latest-only拼成完整历史。
- 来源内容差异的保守暂停不等于semver集合语义冲突；真正交集由兼容评估器判断。
- native v2 publication绑定release的plugin/package/version及metadata/artifact摘要，缺证据unknown；已知withdrawn/hard-blocked持久投影，active镜像不能解除；acceptance损坏时stale/安装阻断并保留已知撤回。
- CatalogRepository.sourceSnapshot带provenance/collections，离线包留原字节，发现页投影不授予执行权。
- DshManagerAdapter.inventory改为canonical SHA-256覆盖environment/items/unknownItems，而非条目/行/unknown数量。
- desktopCatalogSourceOptions对undefined/空数组不覆盖Core默认源；显式登记保持trust/fallback。Agent Forge继续目标dsh、HTTPS/受控路径门禁。

目录/来源刷新只提供事实，不授予任意URL/路径安装权，不自动下载/安装；撤回、引用未知、摘要变动与目标冲突仍阻止对应写。

## 5. releaseContext、写前复验与任务只读恢复

### 5.1 合同和可选能力

Provider Core API为1.1.0（此前1.0.0）、Provider Remote为2.1.0（此前2.0.0）；Core源码包仍0.1.6。Client最低仍Core API1.0.0/Remote2.0.0，新增方法/字段optional并双探测capability与方法。当前Adapter Host要求Core API1.1.0，不代表新Adapter可配旧provider。

| 能力/API | 原始事实/请求 | 边界 |
| --- | --- | --- |
| host-release-options；hello.hostCore、hostCore、releaseOptions | 已登记packageName、includePrerelease、cursor/limit；可信宿主、库存、完整发行、历史/歧义与上下文 | 只读，不接受任意下载地址；旧Host安全降级 |
| host-release-context；PlanSelection/InstallPlanItem.releaseContext | environment、host/catalog/inventory revision、checkedAt/stale、完整身份与sources | optional；服务器核对并冻结，不信Client自报，不补造历史绑定 |
| operation-recovery；taskStartRecover | 原planId/planDigest/key与当前可信caller | 只读归属/摘要/task bundle/environment/start key，不创建任务或写入 |
| operation-recovery；pluginActionRecover | 原packageName/expectedVersion/action/key | 当前环境原记录，只读stage/receipt/result，不补维护/启停/卸载 |

本轮两个恢复方法把此前已含hostCore/releaseOptions的39描述符增为41；41是该批打包声明数，不是41项功能通过。browser-safe根入口只含合同/API，Node评估器经现有/dsh导出，不把React/DOM/Node runtime拉进根入口。

### 5.2 列表、摘要与写前冻结

release-options分页默认20、limit 1～100，cursor有界并绑定环境/宿主/目录/库存/通道；变化返回stale-cursor/stale-context，不能混页造列表。完整身份绑定来源，报告获得/评估记录、已知总数及覆盖，unknown总数不补完整数量。

release-context严格允许键/身份/时间/来源集合，checkedAt是生成时间，不作事实等同性比较；其他identity/revision/stale变化拒绝release-context/stale。PlanBundle新增host/catalog/inventory内容绑定并入bundleDigest，items保存原选择，预检后不静默换版。旧调用方新建计划也冻结当前事实，历史缺绑定不补造。

列表读取前后、planCreate/taskStart、下载前及首次官方dispatch前复验宿主/目录/所选发行。下载前变化零下载/零写；下载后dispatch前变化零官方写。已发生写入保留原回执/unknown，不用stale掩盖。原幂等任务查找优先于新预检，恢复不是新建计划重写。

### 5.3 Client选择与TaskCard锁

InstallPlanDialog消费列表，release-selection按完整身份合并页，保持有效手选；宿主已知、库存可信、目录fresh时默认最高selectable适配新装/升级，不自动降级、不覆盖用户。未知、冲突、缺制品、未加载最新记录、历史不全和核心过旧分别说明，过旧附Agent/当前核心/最新包/要求范围；降级再次确认，预检传原releaseContext，旧Host保留fallback。

TaskDrawer/TaskCard以task-request-guard管理真实原Promise，不按updatedAt或展示超时解锁；迟到回包不覆盖unknown/新连接，恢复到了而原Promise仍pending也不新写。原开始身份只读核对，not-found不等于没执行。目录核对用catalog只读，不重发指定source refresh；原sourceId不丢。Client测试类型修正只改真实applied回执、Client-safe imports、明确policy fixture，不降低断言。

真实安装task的自然断线/重开恢复正向仍待验，不能拿不存在身份拒绝或管理恢复替代。

## 6. Agent Forge media完整传递与前端交互

根因：完整package media与index摘要混用、投影丢icon/previews/alt/theme、上游图被误称真实截图。新增agent-forge-media.ts与optional CatalogDisplayMedia，完整package权威，index仅摘要校验、不回填完整记录缺失媒体。

- 完整previews 1～12，index摘要最多1；无凭据HTTPS，URL≤4096 Unicode码点、非空alt≤500码点，theme为light/dark/system；非法字段/类型/重复项拒绝，稳定id绑定角色/URL/alt/theme，顺序保留。
- 可执行记录完整预览同时进media、旧screenshots和presentation.media；listing也可有media但不可安装。海报用第一预览，不用icon冒充；无媒体旧数据兼容。
- Core/API/缓存/离线保持字节来源，媒体不提升审核/许可/核心适配/安装权。后端不下载/缓存/代理图片，不执行theme代码。
- Client media.tsx/mediaStyles.ts支持icon加载占位/失败回退、预览懒加载、失败来源/重试、放大Modal/关闭，listing展开才展示；现有样式字符串注入MEDIA_CSS，无新CSS管线，图片no-referrer与客户端URL复核。
- “上游图片”不等于官方实测截图。合成React/Edge只证明交互实现；默认61插件/21listing无media，真实公网图官方解码/展示仍待验。

媒体没有新增业务Remote或提高Client最低版本，沿现有目录API传optional字段；Core给完整事实，加载/失败/重试/放大/展开等中间态归Client。

## 7. 管理完整业务回执与Client原意图（RW-13）

### 7.1 官方层结束不等于业务完成

旧stage=settled/receipt=applied只证明官方动作结束，不能证明维护保存；官方执行锁与维护提交间有窗口，查询也可能据当前库存重算历史。现有schemaVersion=1记录新增optional completion，不新建记录系统。management-record保存完整PluginActionResult、maintenance saved/revision或not-required，digest绑定fingerprint/outcome/receipt/result/maintenance；严格解码拒绝损坏、身份/语义不一致或unknownSharedImpact假凭证。

顺序：原请求/dispatch耐久保存→原官方回执保存→后置状态核对→维护意图提交→完整凭证耐久保存。维护提交、凭证保存及卸载preflight纳入现有execution锁。maintenance-save-failed/business-result-save-failed返回unknown，保留实际changed/权限/诊断，不把已写失败压成changed=false。

完整新记录同key同内容直接返回原业务结果，不读当前库存猜历史、不再官方写/维护提交；同key异内容拒绝。目标后来删除/重装/启停不改原结果。recover只读原记录，旧缺completion为business-result-unavailable unknown；not-found不证明未写入，损坏凭证拒绝。

只有明确重入原管理写API且原官方状态仍可核实，旧记录才可能补维护/完整凭证，仍不重放官方动作；状态变化拒绝补提交。只读核对不偷换成迁移。applied、restart-required、failed且changed=true/false与权限事实保留；官方cancelled保留changed/权限，但业务仍unknown，不伪称可解锁终态。公共结果去敏。

### 7.2 Client最小指针与不可重放

management-pointer/management-request写前保存一次可信environment+原packageName/expectedVersion/action/key。localStorage只放最小原身份，不放凭据、库存或业务结果，不是第二任务系统。20秒只是展示超时，不是取消；真实Promise pending继续锁，可能已提交的传输错误不发新key，迟到回包不盖unknown或新连接。

导航、重连、重挂、重开按原环境只读核对，回包前后复核environment，capability/方法双探测。缺能力、not-found、旧unknown、指针损坏、存储不可访问/clear抛错都保留保护。UI分开展示stage/receipt与完整result；可信非unknown完整结果且安全清指针才允许新操作，原Promise未结束仍锁。库存刷新失败不改原回执。保留系统/官方组件保护、卸载两步确认、真实changed/权限/restart-required及官方核对入口。

## 8. 作者页、README、ZIP、脱敏与官方写门禁

### 8.1 作者错误与存储

原生fs/JSON/URL异常曾穿Remote泄露Profile路径、ENOENT、node:fs/栈。authoring/errors只把可识别原生存储/解析错误转安全领域错误，程序异常不吞并；draft/media/package领域错误去stack，区分not-found/storage/corrupt/validation/revision conflict，读入结构/摘要继续验证。provenance与正文同原子文件，旧provenance安全兼容读取，不伪装保存/导出成功。

ZIP导入/导出维持路径、大小、摘要、README/markdown一致、媒体归属及固定commit要求，非法URL/JSON安全领域报错；不执行ZIP内容、不授安装权。本批未重写zip.ts或扩大上限，不能把边界加固写成新增ZIP引擎。

### 8.2 作者页显示时刷新

常驻挂载导致挂载读取不等于返回页面更新。AuthorWorkspace增加visible/listGeneration/listStatus，再显示读草稿列表、丢迟到回包，区分loading/failed/unavailable/真空列表；显示切换不重置编辑表单，不盖dirty内容，Remote替换才重置。保存/导入使旧列表请求失效；媒体读取异常改安全提示。历史官方验证隐藏时新增草稿、返回后列表出现且未保存标题保留。

### 8.3 README固定commit安全transport

raw GitHub DNS不稳定；默认reader严格验证内部固定SHA raw坐标，再从同仓/路径/完整40位SHA的GitHub Contents API raw media读取。拒凭据、浮动分支、危险路径、双重编码/穿越等，保留注入RemoteBytesReader合同。safeFetch仍验证HTTPS/DNS/重定向/时限/体积，超大声明取消body；403/429/timeout不伪报成功。不加token/任意代理或固定IP绕过。

### 8.4 官方适配写屏障

无关旧皮肤/插件unknown只提示，不全局封锁目标；inventory-safety统一全局bundle读取失败与目标异常分类。pluginManager不可用、listBundles失败/缺名、目标版本未知/重复/异常、活动请求和官方run记录仍是对应屏障。OfficialHostPort dispatch前复核活动/目标库存和制品大小/摘要/版本，无法核实unknown。TaskManager/Runtime共享规则，安装后核对目标确认版本；插件启动/功能失败不是安装字节错误，也不保证插件业务可用。

官方pluginManager始终唯一插件写入者，市场自身/核心/系统组件/只读或不可卸载目标受保护；核心兼容算法不授豁免。卸载不额外清理独立配置、用户文件、未知目录，不保证第三方自身卸载保存全部数据。unknown/partial/restart-required不得压成applied。

## 9. 测试夹具与交付工具

- **打包根因**：隔离Registry在pnpm安装目录直接npm pack产生tar type1硬链接；官方落盘曾使Zod 840文件中176个为零字节，v4/package.json非法、typert-loader启动AggregateError。不是settings冲突/Zod版本不匹配，不改官方loader fallback。
- **package-fixture.mjs**：regular逐文件读取字节、独占写staging再pack，断开inode共享；拒symlink/越界/覆盖与归档链接，核对完整集合/源字节。Zod/semver/noop共用。历史14项定向与官方有效127字节package.json支持此修复。
- **Edge夹具根因**：四处隔离Edge及通用browser-check被Kaspersky注入域脚本阻塞，ready=loading/body空/fixture无定义。仅在测试CDP会话屏蔽精确http://me.kis.v2.scr.kaspersky-labs.com/*；产品请求/SSRF不变，未关闭安全软件/改系统、增加sleep、降低断言或跳过测试。
- **输出隔离**：browser-check默认独立时间戳目录，避免覆盖历史；初轮失败留initial-failure，上一媒体批原browser49另存，不能拿已覆盖旧默认路径引用历史通过。
- **验收工具**：desktop-acceptance含CDP/session/Registry/制品检查、官方安装、网络/作者/页面/管理、release API/UI、业务历史/冷启动恢复、trace/source-audit；文件存在不等于已执行，本次文档不运行工具。
- **诊断预算**：dns-shape区分record/string/非法DNS形态，不输出代理凭据；source-audit按请求/时间/字节预算分别读普通HTTPS和原safeFetch。诊断较大读取预算不改变产品8MiB门禁。review-probes是复现工具，reproduced不作产品通过或正常CI期待。

## 10. 历史验证、局部官方实机与待验

### 10.1 最新已保存结果属于旧mvp.17管理批

证据入口MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md；本文只读取原证据，不重跑。

| 层次 | 已保存结果 | 适用边界 |
| --- | --- | --- |
| 全量 | **1866 passed / 0 failed / 2既有skipped**，success=true，总1868 | final-full-corrected.json；不是merged mvp.18结果 |
| 通用browser | **49/49** | browser-final/browser-results.json明确synthetic React/隔离headless Edge，不是官方Desktop |
| 历史静态/build | build、Client测试tsc、lint、包边界、browser语法与diff检查通过 | final-validation-status.json等；不是本文执行或合并后新验收 |
| 定向 | 后端扩展92/0；前三处夹具86/0、版本选择50/0；管理focused39/0 | 各专项，不和全量重复相加 |

失败过程保留：后端宽回归774/2（scheduler隔离24/0）；全量首轮1748/2/114 pending、再串行1800/0断言失败/64 pending仍整体失败；第四夹具首轮与browser初轮注入阻塞。pending不能算skipped，最终通过不抹失败。更早媒体批完整1796/0/2、media专项198/0、browser49；版本上下文批1598/0/2均只属各自历史，非当前最新。

### 10.2 rc.2旧字节与局部验收

载体官方Desktop **0.2.0-rc.2**，build 04f392c9ddd144fa426da2045178797da6db6c11、dirty=false；**不是原指定0.2.0-rc.1**。官方Plugins→Add plugin→Custom Registry→Enable now安装本地不可变候选到独立隔离环境，不直接覆写官方插件文件、不降低blockExoticSubdeps、不调用模型。Profile/Registry/原日志不纳入交付。

| 旧管理批制品 | SHA-256 | 原实际字节 |
| --- | --- | --- |
| Core0.1.6 | 6384d553776e512d906e034ba88a0f13cf0816e58f682b3c7460e74c0c614efa | **95/95**；Registry摘要一致，文件及源lib无mismatch |
| Adapter0.1.0-mvp.17 | a1ef8023e335acb821105359ab3a849c3fe0eb176c8fafc2564543cb1c351428 | **96/96**；Registry摘要一致，文件及源lib无mismatch |

依据official-installed-bytes-and-completion.json，仅绑定该不可变本地候选。相同Core0.1.6也不能套用于merged新构建；更早media Core94/Adapter92、版本上下文Core93/Adapter88是不同字节，不能拼一批、冒充mvp.18。

1. 合法noop官方API停用/启用/卸载及历史/冲突4组，真实维护explicit/完整completion；目标删除后原历史稳定。
2. 原请求重复只读核对3组、正常退出清零后冷启动原结果只读恢复3组，零重放。首探针对maintenance.generatedAt误报，失败保留；纠正仅排生成时间、继续比较所有业务事实/revision，不改产品。
3. 实际Client停用/启用/两步卸载3组最终核实。真实卸载超过20秒unknown，原key/锁保留，稍后手动“核对原操作”只读恢复完整result、清指针/关Modal、库存无fixture，**零重放**；漏采指针/过早核对失败保留。
4. 跨重开Client原disable指针恢复确有UI证据，但脚本种入标faultInjectedPointer，**不是natural断线cold-start**。真实三组official-client-actions-readonly-final.json另标faultInjected=false，不混淆两类。
5. 2026-10-05 14:12:15北京时间Browser.close，14:12:16 code0退出且精确PID/userdata清零，再冷启动通过；不证明旧media关闭竞态根因已修。第二实例14:36:38 code0退出未证实发起者，不记第二次主控正常关闭；端口已关未取得截图，不补视觉通过。

此前媒体批目录refresh/README初装与重开实际通过，不能把公网全部写blocked；但默认目录无media，官方正向图片未通过。旧版本上下文两阶段API11/0/9 unknown、安全UI8/0/1 blocked、receipt applied/result unknown按原批保留，不被后来的修复覆盖。旧实机记录见OFFICIAL-DESKTOP-ACCEPTANCE/FIXES/RELEASE-CONTEXT对应报告。

### 10.3 真实来源核实与未通过门禁

历史来源窗口2026-10-05 13:41～13:42北京时间，非本文在线核验：8次小文档HTTP200、普通HTTPS/原safeFetch摘要一致，revision 20261004T180213Z；Agent Forge main ef33ea9e2baa240f72bb8c5d12471919edc59696、packages 3022bd1b898093d8aa90f76ebe0989b517195aa2。6份完整公开记录声明26 previews、4个真实图片URL两链路完整同摘要字节，不等于官方图片解码/展示，未下载保存图绕过显示限制。

真实dsh/plugin索引 **18,375,959字节 > 8,388,608字节门禁**，原reader delivery/too-large；不是整体公网不可达。样本缺icon/theme、可信DSH范围、版本/历史/可安装制品映射，许可unknown；作者tag/Release不是目录包版本。两份公开ZIP未取得可信摘要/身份，不试装未知制品。建议source config enabled=false、未激活Profile，未改外部上游；raw GitHub DNS仍不稳定，不声称全网稳定。

**仍未通过：**

- 原指定rc.1；merged mvp.18最终全量/布局/交互回归及官方新字节。
- public release：公网Core可得、双通道新摘要/固定URL绑定merged源码、正式发布、mvp.9→双包升级/失败回退；仓内制品或个人分支push不替代。
- natural断线/cold-start管理正向与真实安装原task恢复；seeded指针、not-found拒绝不替代。
- media实际UI长链路：符合门禁真实源→完整记录→媒体/版本→加载/失败/重试/放大→真实选择/预检→公开制品安装；合成图片、4个URL字节、无媒体目录不替代。
- 实机适配升级/降级、多依赖/套餐、审批/取消/重启、皮肤/AI正向、旧Host fallback、读屏/forced-colors/DPI/120%～200%缩放。
- 旧退出竞态独立归因；一次正常退出不抵消受控终止/残留历史，未经owner证据不归咎安全软件或某资源。

### 10.4 兼容、权限与回退风险

旧Client最低协议不变、optional探测；新Adapter必须配新Core provider。同Core0.1.6/Adapter版本曾多批复用本地字节，正式发行应新字节有新可识别身份，不覆盖公开版本或仅靠版本号证明。

历史计划/管理缺绑定/completion不补造；只读unknown不删记录/清指针/换key解除保护。降旧代码可能不消费新completion/media/绑定，须验持久数据兼容，不清空数据假回退。execution锁与Client原Promise保护要一起保留，回退一半会重开重复写窗口。

semver必须随准确制品交付且遵守官方供应链；fixture不恢复硬链接风险。来源冲突/撤回/stale及8MiB门禁不为验收而放宽。UI合并重验media注入/hidden态/图标、分页/选择、原指针/任务锁；build不能证明视觉/字节/业务长链路。

## 11. 完整有效文件清单

A/M相对开工接力基线9c6a1d2，不是最终status。覆盖本地修复/既有文档/新增工具162文件（99新增、63修改），不含本文：Core38、Adapter/Client22、tests52、docs22、tools26，另.gitignore/lock各1。主控提交后文件不再显示未提交，仍保留在修改清单。清单固定到本任务登记批次，不冒充主控随后新增handoff的最终交付全集；最终交付范围由主控补。

### 11.1 Core产品与合同（38）

```text
M packages/market-core/package.json
M packages/market-core/README.md
M packages/market-core/src/adapters/dsh/host-port.ts
M packages/market-core/src/adapters/dsh/manager.ts
M packages/market-core/src/api.ts
M packages/market-core/src/authoring/drafts.ts
A packages/market-core/src/authoring/errors.ts
M packages/market-core/src/authoring/media.ts
M packages/market-core/src/authoring/package.ts
M packages/market-core/src/authoring/readme.ts
A packages/market-core/src/catalog/agent-forge-media.ts
M packages/market-core/src/catalog/agent-forge.ts
M packages/market-core/src/catalog/discovery.ts
A packages/market-core/src/catalog/host-requirements.ts
M packages/market-core/src/catalog/lifecycle.ts
A packages/market-core/src/catalog/merge.ts
M packages/market-core/src/catalog/model.ts
M packages/market-core/src/catalog/offline-pack.ts
M packages/market-core/src/catalog/store.ts
M packages/market-core/src/catalog/validate.ts
M packages/market-core/src/contracts/compatibility.ts
M packages/market-core/src/contracts/types.ts
M packages/market-core/src/core/execution-state.ts
A packages/market-core/src/core/host-compatibility.ts
M packages/market-core/src/core/index.ts
A packages/market-core/src/core/inventory-safety.ts
A packages/market-core/src/core/management-record.ts
M packages/market-core/src/core/planner.ts
M packages/market-core/src/core/ports.ts
M packages/market-core/src/core/README.md
A packages/market-core/src/core/release-facts.ts
M packages/market-core/src/core/task-manager.ts
M packages/market-core/src/core/update-check.ts
M packages/market-core/src/dsh.ts
M packages/market-core/src/host/market-runtime.ts
A packages/market-core/src/host/operation-recovery.ts
A packages/market-core/src/host/release-context.ts
A packages/market-core/src/host/release-options.ts
```

### 11.2 Adapter / Client（22）

```text
A packages/market/src/catalog-options.ts
M packages/market/src/client/action-feedback.tsx
M packages/market/src/client/action-state.ts
M packages/market/src/client/AuthorWorkspace.tsx
M packages/market/src/client/components.tsx
M packages/market/src/client/data-controller.ts
M packages/market/src/client/InstallPlanDialog.tsx
A packages/market/src/client/management-pointer.ts
A packages/market/src/client/management-request.ts
M packages/market/src/client/MarketPage.tsx
A packages/market/src/client/media.tsx
A packages/market/src/client/mediaStyles.ts
M packages/market/src/client/model.ts
M packages/market/src/client/PendingListings.tsx
M packages/market/src/client/README.md
A packages/market/src/client/release-selection.ts
A packages/market/src/client/task-request-guard.ts
M packages/market/src/client/TaskDrawer.tsx
A packages/market/src/host-core.ts
M packages/market/src/index.ts
M packages/market/src/version.ts
M packages/market/tsconfig.client.json
```

### 11.3 测试与测试支持（52）

```text
A tests/adapter/catalog-options.test.ts
A tests/adapter/desktop-package-fixture.test.ts
A tests/adapter/host-core.test.ts
A tests/adapter/install-state-gate.test.ts
A tests/authoring/error-redaction.test.ts
A tests/authoring/readme-transport.test.ts
A tests/catalog/agent-forge-media.test.ts
M tests/catalog/agent-forge.test.ts
A tests/catalog/catalog-merge.test.ts
A tests/catalog/host-requirements.test.ts
A tests/catalog/media-contract.test.ts
A tests/catalog/publication-projection.test.ts
M tests/client/action-state.test.ts
M tests/client/activation.test.ts
A tests/client/agent-forge-media.test.tsx
A tests/client/author-refresh.test.tsx
M tests/client/browser-check.mjs
M tests/client/browser-fixture.tsx
M tests/client/data-controller.test.ts
M tests/client/dialogs.test.tsx
A tests/client/install-version-selection.test.tsx
A tests/client/management-browser-harness.ts
A tests/client/management-recovery.test.tsx
A tests/client/management-request.test.ts
A tests/client/media-integration.test.tsx
M tests/client/protocol-guard.test.ts
A tests/client/release-selection-browser.test.tsx
A tests/client/release-selection.test.ts
A tests/client/task-browser-harness.ts
A tests/client/task-inflight.test.tsx
A tests/client/task-recheck.test.tsx
M tests/client/visual-polish.test.tsx
A tests/core-api/agent-forge-media.test.ts
M tests/core-api/backend.test.ts
M tests/core-api/browser-boundary.test.ts
A tests/core-api/operation-recovery-wire.test.ts
A tests/core-api/release-options-runtime.test.ts
A tests/core-api/release-options-wire.test.ts
A tests/core/host-compatibility.test.ts
A tests/core/inventory-safety.test.ts
A tests/core/release-context-fixture.ts
A tests/core/release-facts.test.ts
M tests/core/reliability.test.ts
A tests/core/start-release-validation.test.ts
M tests/core/update-check.test.ts
A tests/delivery/dns-shape.test.ts
A tests/host/catalog-merge-runtime.test.ts
A tests/host/management-business.test.ts
A tests/host/management-outcome.test.ts
A tests/host/operation-recovery.test.ts
A tests/host/release-context.test.ts
A tests/host/release-options.test.ts
```

### 11.4 既有报告、指南和handoff夹具（22）

```text
M docs/CORE-ADAPTER-GUIDE.md
A docs/handoff/AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md
A docs/handoff/AGENT-FORGE-MEDIA-PLAN-2026-10-05.md
M docs/handoff/BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md
A docs/handoff/DESKTOP-FUNCTION-MATRIX-2026-10-03.md
A docs/handoff/fixtures/host-core-compatibility-cases.v1.json
A docs/handoff/HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md
A docs/handoff/HOST-CORE-API-IMPLEMENTATION-2026-10-03.md
A docs/handoff/HOST-CORE-COMPATIBILITY-PLAN-2026-10-03.md
A docs/handoff/HOST-CORE-IMPLEMENTATION-2026-10-03.md
A docs/handoff/HOST-CORE-RANGE-IMPLEMENTATION-2026-10-03.md
A docs/handoff/MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md
A docs/handoff/NEXT-IMPLEMENTATION-PLAN-2026-10-05.md
A docs/handoff/OFFICIAL-DESKTOP-ACCEPTANCE-2026-10-03.md
A docs/handoff/OFFICIAL-DESKTOP-FIXES-2026-10-04.md
A docs/handoff/OFFICIAL-DESKTOP-RELEASE-CONTEXT-2026-10-04.md
A docs/handoff/REMAINING-WORK-2026-10-04.md
M docs/handoff/START-HERE.md
M docs/index.md
M docs/PRODUCT.md
M docs/README.md
M docs/UPGRADE-GUIDE.md
```

### 11.5 隔离验收与诊断工具（26）

```text
A tools/desktop-acceptance/api-checks.js
A tools/desktop-acceptance/artifacts.mjs
A tools/desktop-acceptance/author-task-ui.js
A tools/desktop-acceptance/cdp.mjs
A tools/desktop-acceptance/fix-checks.js
A tools/desktop-acceptance/fix-management-check.js
A tools/desktop-acceptance/fixture-plugin/cordis.patch.yml
A tools/desktop-acceptance/fixture-plugin/lib/index.js
A tools/desktop-acceptance/fixture-plugin/package.json
A tools/desktop-acceptance/install-market.js
A tools/desktop-acceptance/install-network-check.js
A tools/desktop-acceptance/install-registry.js
A tools/desktop-acceptance/management-business-checks-20261005.js
A tools/desktop-acceptance/management-business-recovery-20261005.js
A tools/desktop-acceptance/management-checks.js
A tools/desktop-acceptance/management-client-checks-20261005.js
A tools/desktop-acceptance/management-recovery-checks-20261005.js
A tools/desktop-acceptance/package-fixture.mjs
A tools/desktop-acceptance/registry.mjs
A tools/desktop-acceptance/release-api-checks-20261005.js
A tools/desktop-acceptance/release-ui-smoke-20261005.js
A tools/desktop-acceptance/session.mjs
A tools/desktop-acceptance/source-audit-20261005.mjs
A tools/desktop-acceptance/trace-host.mjs
A tools/desktop-acceptance/ui-checks.js
A tools/review-probes/dns-shape-20261004.mjs
```

### 11.6 lock及本地缓存交付排除（2）

```text
M .gitignore
M pnpm-lock.yaml
```

测试分工：adapter覆盖getter/默认源/写屏障/无链接打包；authoring覆盖领域错误/Contents transport；catalog覆盖原文/媒体/声明/合并/生命周期；core/host覆盖集合评估、库存revision、冻结/零写/完整凭证；core-api覆盖wire/运行时/浏览器安全；client覆盖可见性/分页选版/任务锁/原管理恢复/media及4处Edge夹具；delivery DNS形态测试不表示修改产品安全规则。

文档保留计划、审计、实施、历史失败和待验的区别，指南指向当前入口，不能把阶段实录升级为产品总验收。新增fixture JSON记录版本对照用例，不补造上游真实范围。新增工具归隔离验收owner，不是执行授权；.gitignore忽略.pnpm-store，本次不删除缓存。产品源码README/API指南说明新可选合同及不变边界。

### 11.7 上游三提交非制品清单

这是开工HEAD到origin当时三提交的只读差异，已正常merge，不代表新全量/官方通过。重叠文件最终只计一次，不将两份清单数量相加作为最终Git总数。

```text
M DESIGN.md
M README.md
M docs/UPGRADE-GUIDE.md
M packages/market/README.md
M packages/market/dsh-plugin.json
M packages/market/package.json
M packages/market/src/client/InstallPlanDialog.tsx
M packages/market/src/client/MarketPage.tsx
M packages/market/src/client/action-feedback.tsx
M packages/market/src/client/marketStyles.ts
M packages/market/src/client/ui.tsx
M packages/market/src/version.ts
M tests/client/browser-check.mjs
M tests/client/browser-fixture.tsx
M tests/client/dialogs.test.tsx
A tests/client/layout-audit.mjs
A tests/client/preview.mjs
M tests/client/ui-audit.test.tsx
M tests/client/visual-polish.test.tsx
```

上游另带releases/0.1.0-mvp.18-dual/的release.json、SHA256SUMS和两个tgz，共4项；用来解释上游准备来源，但按任务排除出本文新增源码/工具交付清单，不生成/复制/执行，不宣布发布。原上游差异共23项，非制品19项已列全。

## 12. 自查、冻结和主控交付补录

交付前只读自查：清单与固定基线/主控提交/新增工具逐项核对；合同/Remote、getter/版本域、算法/预算、publication/merge、releaseContext/摘要/恢复归属、completion/只读路径、Client指针/Promise、media投影/样式、作者错误/Contents、打包硬链接与注入脚本边界跨文件核对。原full-corrected的success/计数、browser明确synthetic标记、rc.2字节及真实UI三组已读取对应存档摘要。没有在本次文档阶段重新测试/启动官方。

**冻结通知：仅docs/handoff/MODIFICATION-RECORD-2026-10-05.md由本文作者新增，现已交回主控。** 其他产品/测试/文档/工具/制品/Git状态均未由本文作者修改。主控可补本节最终结果，不能移用第10节旧字节证据。

| 主控补录项 | 2026-10-05实际状态 |
| --- | --- |
| 已发生本地提交/合并 | 3fa1fc6、9709c75、e880a88见第2节；84a516b交付31个工具/fixture/离线测试/独立输出目录/忽略规则文件。本文所属提交用`git log -1 -- docs/handoff/MODIFICATION-RECORD-2026-10-05.md`查，不自引用未产生的SHA |
| e880a88合并后build | `node scripts/build.mjs`通过；本机`.verify/github-delivery-20261005/build.log`保存输出，没有新官方制品SHA |
| e880a88合并后全量/浏览器/静态 | 串行Vitest`full.json`为success=true，1877 passed / 0 failed / 2既有pending，failed suites=0；合成browser55/55；额外Client tsc/lint/包边界通过，工具专项9/9。具体命令与本机日志见开发者handoff10.2 |
| 独立布局审计 | 输出改为`EAC_LAYOUT_AUDIT_OUT`或默认时间戳目录，不覆盖旧findings；CDP精确阻断已定位注入脚本，违规阈值未降低。执行被主人中断，没有完整结果，不签通过；随后未发现本批遗留审计进程 |
| mvp.18新制品/官方实机 | **待验**；没有本轮新SHA、安装字节或实机业务证据，旧mvp.17结果不移用。主人后续将收尾限定为Git提交及推送 |
| GitHub当前分支 | 网络曾reset/无法连接；主人要求重试后fetch成功，远端5提交至4f9a627已第二次正常合并；逐文件取舍和最终复验见第13节。提交后普通push，实际远端SHA必须再查询与HEAD核对，不force；本文件冻结不是远端ref成功证明 |
| public release/公网渠道/升级回退 | 未证明通过；独立授权及实际公开获取/安装证据，不等于分支push |
| rc.1/natural断线/media UI长链路 | 保留待验；补前置/步骤/实际结果，不用fault injection/局部API顶替 |

下一步按新handoff与当前账本收口merged候选验证，独立推进真实源体积/缺字段、固定revision、可信DSH范围、不可变制品及安装原task恢复。未经授权不扩读取预算、不启未知来源、不改官方或日常用户环境。

## 13. 两次合并的逐文件修改与取舍

此节是主控在最终提交前补写的实际合并记录，不仅罗列上游提交。第11节清单为第一次交付冻结快照；本节补齐第二次同步、接线修正和新增回归，不能将快照数字当作最终Git总数。两次合并都保留双方提交历史，未整文件选择ours/theirs、未force。

### 13.1 第一次：9709c75 + b8a977b → e880a88

远端三提交为f47174a、aa2ef09、b8a977b；源码Adapter由mvp.17变mvp.18，保留本地Core0.1.6、核心兼容/恢复/media实现，并带入StoryStream、tactile、flex布局修正和双通道预备材料。实际两个冲突文件处理如下（已用`git show --cc e880a88`复核）：

| 冲突文件/位置 | 合并实际修改 | 取舍依据与未改变事项 |
| --- | --- | --- |
| packages/market/src/client/MarketPage.tsx / MarketFrame | 保留远端documentHidden状态、visibilitychange订阅与hidden类，同时style仍注入本地MARKET_CSS + MEDIA_CSS | 不丢后台动效控制，也不丢media加载/失败/重试/放大样式 |
| 同文件 / DetailView | 将带头放在detail直接子元素，保留远端单列/宽屏布局；图标用本地CatalogMediaIcon，删除main内重复带头 | 保留真实media/icon，不退回纯首字母，也不重复h1/图标 |
| tests/client/dialogs.test.tsx | 同时保留本地6条task-history严格数量断言和远端details/summary结构断言 | 不是把严格断言换成“任意存在”来掩盖冲突 |

其它上游非冲突修改正常并入：marketStyles/ui/action-feedback触感及布局、browser夹具/检查、layout-audit/preview、包版本和文档。保留上游已跟踪的mvp.18 tgz/release.json/SHA256SUMS，未覆盖或新公开发布。同版本制品早于本地修复，不能称它们含有本轮新字节。

合并后重新build、额外Client tsc、lint、包边界通过，全量success=true、1877/0/2既有pending、failed suites=0；合成browser55/55，工具离线9/9。layout-audit执行中断，没有完整结果。官方191文件和4/3/3结果只属此前mvp.17不可变批次。

### 13.2 第二次：5df36be + 4f9a627 → 本次mvp.19候选

五个远端增量：f6aef9f（安装日志/宽松方案）、ad53f2e（供货草稿）、e011b8b（只读previewPacks）、2fc644c（夜计划实录）、4f9a627（全表面UI/panel锚定/mvp.19）。远端增量50文件，包含新源码、测试、文档；它不等于50处冲突。主控确认10个冲突文件，另外修正三个非冲突测试接线/用例，详见表：

| 文件 | 实际合并修改与保留内容 |
| --- | --- |
| packages/market-core/src/adapters/dsh/host-port.ts | constructor第4参继续为readHostCoreRevision，第5参新增installLog；保留可信核心revision、原回执/幂等，同时接入上游逐项postcheck日志和官方applied的宽松后核对行为 |
| packages/market-core/src/catalog/model.ts | listings仍为本地MarketListingRecord以保留Agent Forge权威metadata，另增previewPacks；不退回会丢媒体原文身份的CatalogListing-only模型 |
| packages/market-core/src/contracts/types.ts | InstallPlanItem同时保留releaseContext与新增warnings；供货/PreviewPack/InstallLog可选合同保留，不因字段相邻冲突删任一字段 |
| packages/market-core/src/core/task-manager.ts | 管理settled→settleBusiness→completeManagementRecord仍在execution锁内，并在原路径追加logManagement；安装applied后postcheck/logged按上游策略记录，不回退成旧纯unknown；使用本地共享inventoryIssueAffectsPackage helper而非已移除的实例方法 |
| 同文件 / 重启状态 | 修正宽松存疑分支遗漏restartRequired：item优先为restart-required，installOutcome亦为restart-required，task为awaiting-resume；不因库存疑点将官方重启要求吞成completed |
| packages/market-core/src/host/market-runtime.ts | 同时构造InstallLog并传核心getter/日志sink；validateStart/validateWrite继续走统一assertSelectedReleaseActive，保留精确package/version/digest/releaseId、来源撤回、releaseContext、可信dsh范围；仅移除普通hard-incompatible标签硬拒绝以兼容计划warnings。没有照搬远端仅检查hard-blocked的弱校验，也没有恢复重复全items检查破坏部分计划 |
| packages/market/src/client/MarketPage.tsx | 独占Client子智能体解冲突：AuthorWorkspace保留visible和outline返回；media CSS/icon/preview、releaseOptions默认选版、原意图恢复保留；previewPacks只读展区、安全来源链接、撤回/未解析说明、nextChapter动态编号、panel/tactile布局和禁用原因无障碍关联并入 |
| tests/core-api/backend.test.ts | Core业务方法精确数量由本地40/远端37合成41，不删方法或放宽为下界 |
| tests/core-api/browser-boundary.test.ts | 合同/运行时方法仍完全相等，精确41；保留5个可信callerId必填检查，含taskStartRecover，不退回远端4个旧检查 |
| DESIGN.md | 保留本地与上游设计/历史验证段，合入Round-3/4，不把上游60项/0布局违规冒充本次验收；去除多余EOF空行 |
| docs/UPGRADE-GUIDE.md | 当前候选改mvp.19，保留详细交接、历史失败和mvp.18固定制品不可覆盖/不等于新源码的边界；不直接采用远端“已发布”文字来宣布本轮发布 |
| tests/adapter/receipt-recovery.test.ts（非冲突接线） | 新日志sink从误占第4参改传第5参，核心getter位置留undefined；保留上游装后存疑日志断言 |
| tests/core/loose-install.test.ts（新增回归） | 增“装后核对存疑仍保留官方要求的重启状态”，实际fake Host返回applied/restartRequired且库存未知，断言awaiting-resume与postcheck/logged，不能completed |
| tests/adapter/install-state-gate.test.ts（策略对齐） | fixture增加日志sink；原“写后重复目标→unknown”预期按上游拍板改为“官方applied且目标未知日志”，同时严格断言postcheck.pass=false、无纠正启停、同request只安装一次。写前重复/未知目标/摘要检查仍不放行，不删旧用例 |

其它50文件增量中的非冲突部分正常并入：InstallLog只读API/Adapter/settings导出、supply read/validate/classify及导入CLI、previewPack validation/project/display/gates、Author/Skin/Task等panel锚定、UI反馈/按钮/布局和browser测试。两份上游夜计划文档保留原始“计划/执行”区别，没有把真实供货缺失或官方待验改成完成。

**业务兼容取舍：**宽松安装是上游明确决定的行为改变，不仅是新增字段。官方applied的后置核对存疑只写日志；普通unknown保留原枚举/提示且不自动重放，但不阻塞后续独立任务。可信dsh核心范围incompatible/conflict、撤回、摘要/字节、原caller/计划身份、官方供应链和管理completion真实失败仍保留。日志不是管理完整业务凭证，也不证明未知任务后来成功。

**已知待改：**第二次复查静态确认普通unknown被写成execution verified/attempt finished，因此冷启动恢复会跳过后续追账；taskStartRecover仍是原快照只读，不会自行补结算。需要另行设计非阻塞的原request只读追账并测试晚到回执，不能把此场景写成已通过，也不能通过自动重发来“修复”。本次没有增加第二套状态机；原管理完整恢复仍保留。

**第二次验证轨迹：**输出在`.verify/github-delivery-20261005/upstream-mvp19/`，独立于首次证据。build/额外Client tsc/lint/包边界通过（96文件、42Remote descriptor）；merge-focused81/81。首轮全量success=false、1905 passed/1 failed/2pending，失败为上述写后重复目标旧断言；按已决定策略增强日志与零重放断言后merge-corrected-focused35/35。最终串行`full-corrected.json`为success=true、1906 passed / 0 failed / 2既有pending、failed suites=0、总计1908；合成browser60/60。首轮失败不删除。未运行新官方Profile/Registry、未生成新版官方制品SHA、未重跑中断layout-audit或公开发布。

最终具体命令、证据文件和不随Git交付的边界见开发者handoff10.5；本节两次合并取舍及实际结果在最终提交前补齐，不将仍待验的功能写成已完成。GitHub最终merge SHA由`git log --merges --oneline`取得，文档所属提交由`git log -1 -- docs/handoff/MODIFICATION-RECORD-2026-10-05.md`取得；推送后仍须独立查询ref，不让文档代替远端验证。
