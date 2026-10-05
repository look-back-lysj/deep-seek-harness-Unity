# Agent Forge media 接线与 VPN 复验计划

执行日期：2026-10-04（UTC记录）；文件和隔离批次保留原有20261005标识，不作为另一次完成日期。用户要求重试VPN网络，并把Agent Forge已提供的media传给前端。保留当前工作区改动，不修改外部Agent Forge仓、官方安装、日常Profile或本机VPN配置；不发布、不增加库。

## 当前事实和合同

- 普通Node HTTPS请求已取得Gitee及GitHub API HTTP200；系统DNS仍返回198.18/15和2001:2::/48。普通访问成功不等于市场安全链路通过，必须在原隔离官方Profile实际重试；不放宽SSRF。
- 已读取本地Agent Forge当前schema与`docs/MEDIA-MIGRATION.zh-CN.md`：可选`media.icon={url,alt}`、有序`media.previews=[{url,alt,theme?}]`；HTTPS无凭据、url<=4096、alt非空<=500、预览1～12张、theme仅light/dark/system。索引只带所选版本至多首张预览；完整记录为权威。
- Agent Forge本地有未提交media改动，不能仅凭本地推断发布。随后已通过git ls-remote和固定commit raw文件核验：main=c3c1bbbd24a04212086cdea2b212d78721f85769、packages=3022bd1b898093d8aa90f76ebe0989b517195aa2，两个分支package/index schema均HTTP200且media合同存在；GitHub API后续403保留，不借用凭据或修改外部仓。
- 接线前market投影把可执行包presentation.media与screenshots写为空；listing也未传media。该缺口已按下方执行结果补齐。
- 公共合同冻结：`CatalogMedia.theme?`，`CatalogDisplayMedia={icon?:CatalogMedia,previews?:readonly CatalogMedia[]}`，`CatalogPlugin.media?`和`CatalogListing.media?`。图片仍用既有id/alt/sourceUrl；来自完整记录的previews同步投影到既有screenshots/presentation.media，旧Client仍可消费。无字段的旧记录保持原样。
- 不把图片地址、theme、投稿或元数据存在解释为审核、许可、宿主适配或安装授权；后端只提供校验后的引用，不下载、缓存或代理媒体，不执行皮肤代码。加载、失败、重试、放大等中间态仍归前端。

## 文件独占与顺序

1. 主控：公共contracts、catalog/validate、投影/Remote集成回归、文档、构建、打包、官方重试；不与worker并行构建。
2. Core worker：独占catalog/agent-forge.ts、可选新增agent-forge-media.ts、tests/catalog/agent-forge-media.test.ts；验证package/index媒体、完整记录投影、边界/摘要/旧记录。不得修改公共合同、validate、其他Core/Host文件。
3. Client worker：独占client/components.tsx、可选media辅助组件/样式、tests/client/agent-forge-media.test.tsx；消费已冻结字段，图标及预览失败可读fallback，不重做业务规则、不下载媒体到磁盘。不得改MarketPage、Core、合同或锁文件；需要listing页面额外接线由主控串行完成。
4. 主控收回worker后补Remote与listing实际接线，focused→build/tsc/lint/包边界→完整测试；新字节只装新隔离官方Profile，不覆写上一批tgz。

## 验收与停止条件

- 第一阶段立即恢复上一批不可变Registry/隔离Desktop，重试实际目录与README；失败保留原环境结果。未获授权不改VPN或系统DNS。
- 源码验收需完整media经过AgentForge→market验证→repository→backend/Remote保留，且不能丢theme、顺序或误把摘要当完整画廊。
- 真实UI验证图片加载/失败fallback、预览及纯展示主题标签；合成浏览器不冒充官方验收。外部图片、完整上游媒体或目录无法获取时分别记blocked。
- 若当前VPN安全重试仍失败，报告普通HTTPS可达但安全链路拒绝及当前DNS证据；这不是取消媒体接线工作的理由。
- 发布、真实用户环境、模型、系统代理/DNS变更仍需另行明确授权。

## 已执行结果

详见[媒体实施实录](AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md)。真正Core/Client子智能体独占开发，主控串行合同、接线、测试、构建和官方安装；media专项198/0、完整1796/0/2 skipped、通用browser49/49。新官方rc.2的Core94/94、Adapter92/92安装字节一致；图标、完整预览和theme已提供API，交互中间态仍在Client。

网络首次仍保留地址拒绝，随后初装/重开目录refresh和README均通过；不能延续“全部公网blocked”的旧结论，raw GitHub DNS仍不稳定。默认目录无media，官方真实媒体正向待验。正常退出首次超时，受控终止本轮精确进程后重开及UI8/0/1 blocked通过；不把强制退出记成正常关闭通过。原失败和原字节保留，不发布。
