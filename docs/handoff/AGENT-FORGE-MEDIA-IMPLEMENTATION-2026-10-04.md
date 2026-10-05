# Agent Forge media 接线与网络复验实录

日期：2026-10-04，按原始 UTC 运行记录。隔离批次与证据目录沿用 `20261005` 名称（Asia/Shanghai）；命名不替代原始时间戳。分支 `refactor/market-core-adapter`，HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。未 commit、push 或发布。

## 结论

- Agent Forge media 已经经过完整 package 读取、严格校验、市场公开投影、缓存重开与 API 提供给 Client。索引首图摘要不替代完整画廊。
- Client 已接入图标、完整预览、主题声明、加载失败、重试和放大；listing 默认收起时不发媒体请求。后端仍只提供元数据和事实，不承担交互中间态。
- 新媒体字节已由官方 Desktop 插件管理器装入全新隔离 Profile；186 个包文件与制品一致，当前 lib 与 build 一致。实际载体为官方 0.2.0-rc.2，不是原指定 rc.1。
- VPN 首次重试仍被保留地址 DNS 拒绝；随后新批次目录刷新和 README 读取各两次真实通过。不能继续写成“全部公网阻断”，也不能声称所有域名稳定可达。
- 正常退出没有通过：第一次 `Browser.close` 超时，宿主连接已结束、窗口隐藏但进程仍在。仅终止本批隔离进程后重开成功；这证明受控终止后的冷启动恢复，不证明正常退出。
- 默认实际目录的 61 个 plugin、21 个 listing 都没有媒体引用。因此官方公网图片/完整上游画廊正向仍未触达；合成浏览器结果不能替代它。

## 公共合同与分工

可选扩展：`CatalogMedia.theme?: 'light' | 'dark' | 'system'`、`CatalogDisplayMedia = { icon?: CatalogMedia; previews?: readonly CatalogMedia[] }`，以及 `CatalogPlugin.media?`、`CatalogListing.media?`。保留既有 `id/alt/sourceUrl`，上游 `url` 映射成 `sourceUrl`。

- 完整记录至少 icon 或 previews；previews 有序 1～12 项，索引摘要最多 1 项。HTTPS 无凭据，URL 最多 4096 Unicode 码点，alt 非空白且最多 500 码点，重复项按 schema 拒绝。
- 保存 alt、theme、顺序及稳定 id。完整可执行记录的预览同时写入旧 `screenshots` 和 `presentation.media`；icon 不充当预览海报。没有 media 的旧记录保持兼容。
- 原记录字节与摘要身份保留。metadata、media、theme 的存在不提升审核、许可、宿主兼容或安装权限；listing 仍不可安装。
- 后端不下载、缓存或代理图片；Core 不依赖 React/DOM。加载、失败、重试、放大、收起展开归 Client。主题仅显示上游声明，不执行皮肤代码。
- Provider 版本与 Client 最低协议不提高，没有新增业务 Remote；现有目录 API 提供可选字段，旧 Host/Client 仍可缺字段运行。

真正子智能体独占开发：Core worker 修改 Agent Forge parser/helper 与专项测试，Client worker 修改媒体组件/样式及专项测试。主控负责公共合同、native validator、发现页/详情/listing 接线、API/缓存测试、文档、串行构建与官方实测。两个 worker 已关闭。

主要实现：`packages/market-core/src/contracts/types.ts`、`catalog/agent-forge.ts`、`catalog/agent-forge-media.ts`、`catalog/validate.ts`、`catalog/discovery.ts`；`packages/market/src/client/components.tsx`、`media.tsx`、`mediaStyles.ts`、`MarketPage.tsx`、`PendingListings.tsx`。项目没有 CSS 文件构建管线，媒体样式通过现有样式字符串注入，已在真实安装中核实。

## 实际网络结果

按发生顺序记录，不能用最后一次结果覆盖早期失败：

1. 普通 Node HTTPS：Gitee 与 GitHub API 曾 HTTP200。`git ls-remote` 核实 Agent Forge main `c3c1bbbd24a04212086cdea2b212d78721f85769`、packages `3022bd1b898093d8aa90f76ebe0989b517195aa2`；两个固定 commit 的 package/index schema 曾 HTTP200，合同含 media。后续 API403 与 raw DNS ENOENT 也保留。
2. 旧不可变候选官方重试：DNS 返回 `198.18/15`、`2001:2::/48`，实际目录刷新 failed、README blocked；安全链路拒绝“来源主机解析到本机或私网地址”，保留 stale 缓存。
3. 新媒体候选初次安装：实际目录刷新 `refreshed`、`stale:false`，README preview 成功；作者缺失/媒体脱敏及 dirty-preserved 三组通过，挂载核对通过，合计六组 passed。
4. 后续系统 DNS：Gitee 返回 `180.76.198.225/77`、`180.76.199.13`；GitHub API 一次 timeout、另一次 `20.205.243.168`；raw GitHub 两次 ENOENT。Fake-IP 是首轮有依据的推断，不确认具体 VPN 产品，也不能当作当前所有域名的状态。
5. 受控终止后重开：真实目录再次 `refreshed`、`stale:false`，README preview 再次成功；零安装 task。启动时缓存 `stale:true` 是尚未成功重刷的事实，不能手工改 fresh。

未修改系统 VPN、DNS、hosts、代理、官方源码/asar、日常用户 Profile 或 Agent Forge 外部仓；未放宽 SSRF、摘要、幂等、权限、官方 `blockExoticSubdeps`，未借用凭据或固定公网 IP 绕过门禁。

## 源码与浏览器验证

- media 集成专项：198 passed / 0 failed；另上下文回归 55/0、媒体视觉纠正组 46/0。
- Client worker 专项 35/0，其中 11 项真实隔离 Edge、24 项 Node/SSR；媒体素材为合成数据，不是官方公网验收。
- 完整首轮：1795 passed / 1 failed / 2 skipped。唯一失败是既有视觉断言仍期待“真实截图”，而上游图片不代表实机证据；改为“上游图片”并保留来源、失败、重试断言，原失败不删。
- 完整最终：1796 passed / 0 failed / 2 skipped，总计 1798。通用隔离 browser-check 49/49。
- build、额外 Client 测试 tsc、lint、包边界、diff 检查通过。Adapter 92 文件、41 Remote descriptor；Core 0.1.6、Adapter 0.1.0-mvp.17，browser-safe 边界保留。既有 CJS `import.meta` 警告未越界修改。

## 官方安装与冷启动边界

- 官方可执行：`G:/Deepseek Harness Desktop/DeepSeek Harness.exe`；版本 `0.2.0-rc.2`、build `04f392c9ddd144fa426da2045178797da6db6c11`、dirty=false。
- 新 Profile：`D:/eac-market-verify/desktop-20261005-media-b2/harness/profiles/desktop`；本机隔离 Registry `http://127.0.0.1:59790`，实际通过官方 Plugins/Add plugin/Custom Registry 安装并 Enable now。
- Core 0.1.6 tgz SHA256：`711150b8a5f5685b27a23e63eb106b1fbe7ea84f599391ba8fcaf8a375e4974b`；Adapter mvp.17：`98e97aedfe6021b58361abb744fc9a0969abd68dc6d6a49786c45189f3f87f97`。仅同版本不同字节的本机候选，不可覆盖公开版本。
- 包比对：Core94/94、Adapter92/92，总186文件 installedMatch=true，当前 lib/build 一致。样式真实注入，不只存在于源码。
- 两阶段只读 API 各 11 passed / 0 failed / 9 unknown；未知项主要为真实核心范围与版本历史缺口，不伪造兼容结论。此批没有管理写回执，不套用上一批原 key 的恢复证据。
- 首轮 UI 6 passed / 3 failed：系统组件默认收起，探针未展开；返回 dirty 作者页后离开确认未处理，导致后续皮肤/首页检查失败。补真实展开与“离开并保留编辑”，不放宽产品断言。第二轮探针 Runtime.evaluate 超时，原评估清理由实际进程重开隔离，不把空输出当通过。
- 重开后纠正 UI：8 passed / 0 failed / 1 blocked，实际首页、搜索、stale/unknown确认保护与取消、展开系统库存、任务、帮助/设置、草稿及返回首页通过。皮肤正向切换仍缺获准 loader/fixture。
- 第一次关闭 Browser.close 超时后仍有本 Profile 四个进程。只读官方 main.js 可见退出等待 policy dispose、backend.close、platformView.dispose 的 Promise.all；尚不能确定哪项卡住，也不能推断由 market media 导致。官方写范围之外，保留 RW-08 宿主问题。
- 仅终止本批 PID41628及同 userdata子进程，确认清零后重开 PID31952；媒体 CSS、13项库存、市场启用、已保存作者草稿保留，零task。正常关闭失败和受控终止后的重开成功分开记账。
- 已查看真实首页截图：默认无媒体的文字海报与 fallback 正常；不据此宣称媒体正向、读屏、全主题、DPI矩阵通过。
- 重开后的补充截图请求 `Page.captureScreenshot` 超时，未生成截图，不能补记视觉通过。收尾前该实例已经退出，原始 `exit.json` 记录 UTC `2026-10-04T18:55:18.829Z`、code0、signal=null；最终 quit 请求因端口已关闭而失败，不将先前退出归因于该请求。最终本 userdata 进程为零，两次 Registry 的精确匹配 PID47520/40944已停止，未删除 Profile/制品/草稿/原失败。后续观察到 code0 不抹去第一次关闭超时。

## 证据与下一步

工作区 `.verify/media-vpn-20261005/` 保存 schema、DNS、首轮失败、新安装、186文件比对、198专项、完整两轮、49浏览器、API两阶段、官方网络两阶段、UI首轮/冷启动纠正、关闭失败及受控恢复证据；截图位于隔离批次根目录。原制品、Profile、草稿与失败材料保留，收尾仅停止精确归属本轮的进程。

下一步按优先级：

1. RW-15：取得真实已发布、含 icon/previews 的 Agent Forge catalog/source，配置隔离 Profile，验证前端实际收到完整媒体、真实 HTTPS 图片加载/失败/重试/放大与 theme。默认 EAC 目录无 media，不能伪造记录或借合成图签官方通过。
2. RW-14/RW-03：目录和 README 通路已两次通过；继续取得真实核心范围、完整历史和合法可安装制品，补版本选择→预检绑定→公网下载/摘要→官方安装→原任务只读恢复。逐域核查不稳定 DNS，不先改 VPN。
3. RW-08：将退出残留 PID、时间、官方退出等待结构交给宿主维护者；隔离复现与获准调查后才能定位根因。保持原指定 rc.1 待验，不用 rc.2 或强制退出冒充。
4. RW-13：仍需既有管理记录的完整维护回执和 Client 原意图恢复闭环；本批媒体工作未实现它。
5. RW-07、RW-09～RW-11：正式渠道、新版本、升级/回退、皮肤/组合、AI正向、无障碍/DPI及目录数据缺口仍待验。发布、真实用户 Profile、网络配置和模型费用另需明确授权。
