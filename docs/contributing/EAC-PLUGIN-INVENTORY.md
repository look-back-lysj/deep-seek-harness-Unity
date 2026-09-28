# EAC 差异插件清点与发行材料

## 最新 v3 冻结更正

最终入口：`D:/eac-market-verify/distribution-20260928/inventory-v3/catalog-fragment.json`，可维护副本在 `catalog-source/eac-inventory/inventory-v3/`，索引见该目录上层 `CURRENT.json`。**后文 v2 记录作为历史保留，以本节为准。**

- 两个皮肤版本为 `1.1.1-eac.dc22280.2`。已确认 `SKIN_META.version` 是传给 `registerSkin()` 的真实运行身份，不只是显示标签；此前对此判断错误，`.1` 不得上架。
- 生成器断言唯一 `SKIN_META` 对象、唯一 version 字面量、预期旧值、皮肤 ID，以及唯一直接展开该对象且未覆盖 version 的 `registerSkin()` 调用，再按准确字节区间替换。未修改 UI 版本门禁。
- 定向检查独立定位 `.2` 的实际登记值，逆转这一处版本差异后逐字节等于最新 beta；其他执行文件、LICENSE/NOTICE 和第三方许可完全相等。派生记录包含客户端变更前后的 SHA256/Git blob、行号、偏移和匹配次数；重复对象、错误旧值、调用端覆盖版本均被拒绝。
- 主控经 Motrix 提供的 `source-blobs-api` **6/6 校验并纳入，缺失 0**。补入聚合包及其 5 个改名成员后，共 **82 个包名、55 条插件记录、27 条 listings、22 个 tgz**。聚合包和嵌套成员不擅自标为可安装；上游内附验收不替代本轮运行证据。
- 最终片段为 **43 plugins、43 presentations、27 listings、6 releases、6 releaseStatuses、3 deliveries**；合并原14款后为57个插件版本记录及27条listings。原14款冻结来源及旧两款1.1.0撤回历史保留。
- v2/Release/Metadata、22个tgz、定向修复、版本排序、归档复现和最终合并校验通过。真实Desktop运行仍未由本worker执行，不写成已验证。此次不执行第三方代码、不改共享实现、不覆盖旧冻结、不等待其他网络。

复现到新的子目录：

```powershell
python scripts/catalog/eac-inventory.py --output D:/eac-market-verify/distribution-20260928/inventory-v3/reproduction --blob-cache D:/eac-market-verify/distribution-20260928/source-blobs-api
python scripts/catalog/eac-inventory.targeted.py D:/eac-market-verify/distribution-20260928/inventory-v3/reproduction
node --experimental-transform-types scripts/catalog/eac-inventory.verify.ts D:/eac-market-verify/distribution-20260928/inventory-v3/reproduction
node --experimental-transform-types scripts/catalog/eac-inventory.fragment.ts D:/eac-market-verify/distribution-20260928/inventory-v3/reproduction
```

本批次只生成目录材料和可核对的归档，不安装插件，不修改官方源码、组织仓、用户 profile 或已有市场实现。当前来源由主控通过 GitHub API 复核；清点脚本本身完全离线。

## 固定输入与完整性

| 输入 | 固定身份 | 用途 |
| --- | --- | --- |
| EAC beta | `dc22280beb9d0a6338d1e02d99f5e5346f72f4f0` | 注册清单、分发分类、实际插件资产、保留归档 |
| beta-pack | `44178ab1360dcb8221a666e782391a11f5716074` | 47 份真实公共 Manifest，以及 Pack/Lock/Parsed 原字节备查 |
| beta-skins | `afa947215a862a9c3304f6fff7a812efe5a42fdc` | 14 个皮肤体系作者原 tgz、SHA256SUMS 与原署名许可 |
| 官方 DSH | 本地源码归档 `0.1.7-rc.2` | 实际 package.json、CLI 依赖闭包和默认 base/web-app 补丁 |

实际官方路径是 `D:/deepseek-harness-source/deepseek-harness-master`；最初指定的带 `0.1.7rc2` 后缀路径不存在。归档没有 Git，不能声称它对应某个 master commit。所谓“官方自带”分别记录同名包是否在源码、是否在 CLI 发布依赖关系中、默认补丁是否引用，不假装已经检查真实用户 profile。

EAC 最新注册表有 62 项，固定 tree 中有 27 个插件资产目录，35 项没有目录。另收录 beta-pack 独有的 12 个插件，以及最新 tree 内保留的归档。旧统一市场的通用生态搜索快照不作为“EAC 随包插件”全量导入，只为已经在本次范围内的包补充描述。

## 产物与接入

最终材料目录为 `D:/eac-market-verify/distribution-20260928/inventory-v2`；`inventory` 保留第一轮证据，其 `1.1.0-eac.dc22280.1` 派生版本不应作为最终发行输入。

最终冻结：82个已知包名，55条当前插件记录、27条仅清点条目；22个归档中15个是可供明确试装的候选。原14款发行记录及已撤回事件沿用历史，但旧miku/trading版本不重复放在主浏览列表。公开目录最终为55+27项，15个下载入口。

6个缺失Git blob已通过Motrix官方API取得，逐个Git blob SHA1校验，缺失为0。归档结构、元数据/发行绑定、两个派生包版本单点变更、许可保留、重复归档和升级排序通过。静态检查不替代Desktop业务验收；实际发行验收见主控交付报告。

| 文件 | 主控如何使用 |
| --- | --- |
| `inventory.json` | 完整 package records：名称、稳定 ID、版本依据、功能、官方差异、API/私桥、制品、许可、阻碍与已知修复 |
| `catalog-fragment.json` | **推荐合并入口**。直接追加 `plugins/presentations/releases/releaseStatuses/deliveries/listings`；排除原 14 款已有版本，保留基线历史 |
| `listing-only.json` | 只展示条目的完整研究材料；无真实包/元数据时保持不可安装 |
| `market-index.candidate.json` | 独立材料验证用；**不要拿它替换已有发行历史**，原 14 款在本文件的来源说明是重新生成的 |
| `merged-with-original-skins.validation-candidate.json` | 使用上一批原 14 款冻结记录试合并的验证结果；不是公开发布目录 |
| `artifacts.json` / `SHA256SUMS.txt` | 精确文件名、大小、SHA256、原版/重归档/派生身份，以及是否选为试装候选 |
| `artifacts/` | 本地 tgz；`installCandidate:false` 只能作为证据，不得上传为当前可安装版本 |
| `licenses/` / `metadata/` | 按发行保存的原许可证、署名和实际 package.json 原字节 |
| `recipes/` | 已构建字节重新归档的材料锁与 TeamBuildRecipe；不运行作者构建程序 |
| `extracted/latest-beta/` | 固定 tree 的现有文件原字节，用于核对与未来适配 |
| `official-inventory.json` | 官方源码包表及依赖/默认补丁依据 |
| `missing-blobs.json` / `blob-cache-used.json` | 未取得的 exact SHA 与独立缓存补读来源 |
| `validation.json` / `targeted-validation.json` / `fragment-validation.json` | 包结构、发行绑定、特定修复字节、合并与旧版撤回验证 |

原 14 款继续使用上一批 `local-eac-skins` 已冻结的 ReleaseRecord 和 sequence 2 撤回历史。新片段按 `id@version` 合并插件、按 `releaseId` 合并发行、按 `releaseId+sequence` 合并状态；同一身份不同字节应拒绝，不能重新写 provenance 来绕过 `release-mutated`。旧 miku/trading 1.1.0 的最新状态必须仍是 withdrawn。

主控已新增 `CatalogListing`：缺少真实元数据的项目进入单独 `listings`，含 `requestedVersion` 时也只表示注册要求，不能冒充已发行版本。其余已取得真实 package.json 或公共 Manifest 的项目进入 v2 `plugins`，没有 bundle 就标 `missing-bundle`，有已知硬阻碍则标 `hard-blocked`；不编造 package.json、Manifest、精确版本或运行 Evidence。

## 两种材料路线及派生包

| 路线 | 优点 | 限制 | 本批采用 |
| --- | --- | --- | --- |
| 保留作者原 tgz | 原始版本、压缩字节、署名与摘要均不变 | 不能声称旧程序包含最新修复 | 无实质代码变化的 12 个皮肤体系原包 |
| 对固定最新 built 文件重新归档 | 无需下载依赖、无需执行第三方构建程序，能绑定真实已修代码 | 新字节须有新的制品记录；派生身份和来源须明确 | miku/trading 两个派生包、滚动修复包及被拦截的证据归档 |
| 从授权源码重新编译 | 可以实施未来所需适配 | 需要固定源码、锁文件、精确工具链、隔离构建记录和运行验证 | 本轮不执行；缺材料逐项记入 inventory |

miku/trading 的最终版本是 **`1.1.1-eac.dc22280.2`**。它高于旧 `1.1.0`，可进入正常升级计划；名称中的 `eac` 明确是团队派生，不冒称上游已正式发布 1.1.1。使用的最新客户端 blob 分别是：

- miku：`6dd87158537496e5c073a4f6e6587da870613799`，激活失败时恢复激活前的 body 内联背景样式。
- trading：`0fa2ff0a45a48a5cdf7c72e023652317a3132ee9`，移除第三方行情 JSONP/远程 script 执行路径。官方宿主不提供 EAC 本地行情服务时，部分行情会降级；不是已验证的完整实时交易服务。

两包的执行文件保持最新 beta 原字节。只更改归档内 `package.json.version` 和 `dsh.skin.version`，增加 `UPSTREAM-PACKAGE.json` 保存上游元数据原字节、`EAC-DERIVATION.json` 说明变更。所有原许可、NOTICE 和第三方通知保留。上游实际客户端 SKIN_META.version 也同步为派生版本；否则皮肤中心会因安装与运行身份不一致而拒绝应用。只改变这一处受断言保护的版本字面量，逆转后必须与固定上游执行字节相同。

标准 `ReleaseRecord.provenance.kind:team-build` 在这里表示**本地重新归档**，不是声称执行过作者源码构建或已跑团队 CI。材料锁列出每个 built 文件 SHA256/Git blob，工具链精确到实际 Python 版本，`buildRun` 明示 local repack。重复打包须得到同一 tgz；未来重新编译必须另建记录。

## 阻碍与许可

- EAC 旧 `@deepseek-ai/dsh-plugin-manager`、`@deepseek-ai/dsh-terminal` 与官方包同名，职责和实现不同，禁止当普通插件覆盖安装。
- `window.dshDesktop`、`DSH_EAC_BRIDGE_URL/TOKEN`、`web-desktop` 等依赖单独记录。静态文本命中含注释或回退分支，最终要求由逐包说明解释，不能看到关键字就声称全部功能必然依赖它。
- `dsh-compact` 虽声明 bundle，但 patch 只修改 `id:compact`、不插入该行，官方默认补丁也没有此行；Agent 压缩引擎还需要独立装配，故暂不安装。
- 旧 unified-market 有 EAC profile/私桥假设。旧 pack-installer 内嵌旧 miku/trading 1.1.0 快照，不能用另一个安装器绕过已知问题拦截。
- 注册表的 `license.expected:MIT` 和 package.json 的 `license` 都不是完整许可材料。缺原许可全文/明确授权的项目保留条目、不可安装，不借根仓库 MIT 为外部作者作品统一授权。
- `deep-whale-day-night` 是 `CC-BY-NC-SA-4.0`，`maid-atelier` 是 `MIT AND CC-BY-NC-SA-4.0`；非商业、署名、相同方式共享条件必须展示，不得整组改成 MIT。其他作品的图片权利链未被本轮重新法律认证。

所有候选均为 `unverified`，仅完成材料与静态检查。`bundle-installable` 表示有可供既有安装链处理的结构，不表示已安装、已激活、已完成 Desktop 功能验证。Gitee 地址由主控登记并逐一实际核验；本脚本不访问镜像、不猜下载 URL，不把“主控已上传”写成本 worker 已验证可达。

## 复现命令

这些命令只读取本地源码和对象，输出必须是新的目录，或已有完全相同字节的目录。Python 只使用标准库。Node 使用工程已有的元数据、Release 和 tgz 校验器，不执行包内代码，也不触发根 build。

```powershell
python scripts/catalog/eac-inventory.py --output D:/eac-market-verify/distribution-20260928/inventory-v2 --blob-cache D:/eac-market-verify/distribution-20260928/source-blobs --write-source
node --experimental-transform-types scripts/catalog/eac-inventory.verify.ts D:/eac-market-verify/distribution-20260928/inventory-v2
python scripts/catalog/eac-inventory.targeted.py D:/eac-market-verify/distribution-20260928/inventory-v2
node --experimental-transform-types scripts/catalog/eac-inventory.fragment.ts D:/eac-market-verify/distribution-20260928/inventory-v2
```

`--blob-cache` 接受独立目录内以 SHA 命名的原字节文件（亦支持 `.blob/.bin/.raw`），或者 `<sha>.json` 的 GitHub base64 blob 响应；使用前重算 Git blob SHA1，并记录实际文件位置。不向组织仓执行 `hash-object -w`，也不执行 fetch。错误摘要直接失败，不静默回退旧包。

生成器中 `save()` 拒绝覆盖不同字节，因此改变源配置、blob 输入或生成器后，应另选 `inventory-v2/<新批次>`。第一轮证据及生成器原件保留，不能通过清空旧现场制造一次成功。正式发行仍需主控完成来源与授权审阅、目标宿主验证、固定下载地址核验和最终发布序号分配。
