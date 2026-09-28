# Desktop 聚合包成员恢复材料（2026-09-28，只读静态核查）

**结论：14 个成员均能原样提取，但没有一个能凭嵌套目录现有 package.json 直接独立加载。** 所有成员的 `dsh.bundle` 都被移除，只有聚合包保留加载声明。它不是“14 个组件已经完成官方接口迁移”的证据。`ACCEPTANCE.md` 明写 Windows GUI 验收仍待完成；表格中的动作是验收目标。

当前可以原字节交付的独立安装候选只有 **2 个已有发行**：`dsh-settings-scroll-fix@2.0.2` 和 `@dsh-eac/ui-skin-loader@1.1.0`。它们已在 inventory-v3 中，不应再次记为本轮新增恢复包。视口锁定、语言兼容另外 **2 个原研组件**有明确的下一步：补独立加载声明和聚合包已存在的插入行；本轮“不改 manifest”约束下不实施。

这里的“安装候选”只表示包结构可交既有安装链处理，并且没有本轮发现的私桥阻碍；没有启动、安装或运行这些插件。公开下载地址、镜像上传、目录接线均由主控负责，本材料不编造可达 URL。

## 固定输入与交付

- 聚合包：`D:/eac-market-verify/distribution-20260928/inventory-v3/artifacts/dsh-eac-desktop-pack-1.0.0.tgz`。
- 聚合包 SHA256：`7a328030e4ba8472bc5f53e439bd969f8212f6affe73f339865cc9c95023d187`。
- 最新 beta 原文件：同一 inventory-v3 下 `extracted/latest-beta/dsh-desktop/assets/plugins/`。来源 commit 为冻结清单记录的 `dc22280beb9d0a6338d1e02d99f5e5346f72f4f0`；本轮离线，不声称重新验证远端。
- 官方接口参照：本地 `D:/deepseek-harness-source/deepseek-harness-master`，版本 `0.1.7-rc.2`，没有 Git commit 证明。
- 生成器：`scripts/catalog/recover-desktop-components.py`，Python 标准库，无网络、无第三方代码执行、无构建。
- 输出：`D:/eac-market-verify/pullability-20260928/components/`。

| 输出 | 用途 |
| --- | --- |
| `ready/` | 两个已有冻结包的完全相同副本；可供主控核对及后续试装 |
| `raw-components/` | 14 个嵌套成员的逐文件原字节证据 tgz；**不可用作安装/公开发行入口** |
| `components.json` | 14 项接口、来源、许可范围、阻碍、原文件 SHA256/Git blob、与 latest-beta 差异 |
| `artifacts.json`、`SHA256SUMS.txt` | 输出包的身份、大小、摘要、用途、既有发行引用；没有下载地址 |
| `parent-evidence/`、`licenses/` | 聚合包与成员原许可、原 package/manifest/patch、上游验收目标和降级说明 |
| `built-diffs/` | latest-beta 与聚合成员的执行文件文本差异；原代码均未改动 |
| `validation.json` | 一次材料级定向检查结果；不得替代真实 Desktop 验收 |

## 逐成员结论

`bundle` 是官方插件管理器识别“安装后应加载什么”的声明；`patch` 是实际插入插件行的配置。缺少声明时，官方安装器可以把包放进依赖目录，但不会把它登记为 profile 加载层。依据：官方 `packages/boot/plugin-manager/src/operations.ts:74`、`:101`。

| 聚合成员 | 代码实际使用的接口与证据（成员内路径） | 原样独立重打包的限制 / 后续 |
| --- | --- | --- |
| `@dsh-eac/terminal@0.1.0` | `lib/index.js:465` 使用官方 `webServer.register/registerUpgrade`；客户端 `:111`、`:185` 另请求 file-changes 的工作目录和端口路由 | 无独立声明/patch；伴侣依赖未声明；外来版权通知待追溯。改名身份已保留，不能替换官方 `@deepseek-ai/dsh-terminal` |
| `dsh-viewport-lock@1.0.1` | 标准客户端模块加载，DOM/CSS 修复，host 空入口；未发现旧私桥 | 原研许可有聚合上下文依据；只差独立声明及已有 `viewport-lock` 插入行。本轮只提取 |
| `dsh-eac-locale-compat@1.0.0` | `lib/client.js:606` 使用 `locale.getLocale/subscribe`，`:633` 使用 `ctx.effect` | 原研许可有聚合上下文依据；只差独立声明及已有 `eac-locale-compat` 插入行。本轮只提取 |
| `dsh-compact@1.0.0` | `lib/index.js:129` 检查 `service.dshCompact`；`lib/agent.js:17` 才装配压缩引擎 | 自带 patch 仅修改 `compact` 行；官方默认层无此行；聚合包虽插入 host 行，也没装配 agent.js。单补声明不能完成压缩能力 |
| `dsh-eac-core-bridge@1.0.0` | `index.js:30` 取 `DSH_EAC_BRIDGE_URL/TOKEN`，`:142` 无端点直接返回 | 依赖旧扩展宿主，空转不等于可用；不得开放安装 |
| `@dsh-eac/easy-setup@0.1.0` | `lib/index.js:4`、`:104` 为官方 Typert 接口，客户端 `:599` 为 `remote.$mount` | 通信接口有依据，但 `lib/index.js:70` 固定读 `profiles/web/cordis.patch.yml`；未绑定 Desktop 当前 profile。还缺独立声明/patch |
| `@dsh-eac/file-changes@0.1.0` | `lib/index.js:505` 注入 `sessionProjections/webServer`，`:508` 注册投影和文件路由 | 没有发现私桥；缺独立声明/patch；外来版权通知待追溯。不能用根许可消掉原作者归属 |
| `dsh-settings-scroll-fix@2.0.2` | 标准客户端模块和 DOM/CSS，host 空入口；已有插入 patch | 嵌套版本缺声明；**另有完全可复用的冻结独立包** |
| `dsh-unified-market@0.4.0` | `lib/host.js:149` 在 `DSH_DESKTOP=1` 时仍取 `web-desktop`；`lib/client.js:519` 取得旧桌面桥 | 自带插入 patch 也不能修复错误 profile/旧功能包桥；有成员 MIT 全文仍不得开放安装 |
| `@dsh-eac/plugin-manager@0.1.0` | `lib/client.js:50` 需要 `window.dshDesktop.pluginManager.list`；host 为占位 | 官方没有此子对象；改名仅避免 npm 包名冲突，没有完成管理接口迁移；另缺外来版权通知 |
| `dsh-plugin-shield@0.1.0` | `lib/client.js:142` 读取 `dshDesktop.guard`，`:158` 无桥返回 `no-bridge` | 检查/备份也依赖旧桥，不能只声称“完整恢复降级” |
| `dsh-file-drop-eac@0.1.2` | `lib/client.js:160` 用旧 `getPathForFile`；`:557` 用旧 `fileDrop.save` | FileReader 可读部分文本，但普通文件保存/路径链未迁移；官方另有 `__DSH_HOST_PATHS__.pathFor`，该代码未接入；不得开放安装 |
| `@dsh-eac/client-file-changes@0.1.0` | 官方 slots 展示；`lib/client.js:620`、`:629` 还原走旧 `revertFiles`，也依赖 file-changes 路由 | 只读显示不等于还原成功；无独立声明/patch；外来版权通知待追溯 |
| `@dsh-eac/ui-skin-loader@1.1.0` | `lib/index.js:30` 官方 settings；客户端 slots、React、`ctx.provide/effect`，自建 `uiSkinLoader` 公约服务 | 嵌套版本缺声明；**另有完全可复用的冻结独立作者包**，不是官方自带服务 |

注意：官方确实也暴露名为 `dshDesktop` 的对象，不能以关键词命中就判定不兼容。官方 `apps/desktop/src/preload-app.ts:13` 定义的实际对象包含 `protocolVersion/browser/keyboard/shortcuts/updates`，没有旧 EAC 的 `pluginManager/guard/revertFiles/fileDrop/getPathForFile/getInfo/openPath`。上述阻碍来自具体方法调用。标准服务存在的依据包括官方 `packages/host/webserver/src/index.ts:166`、`:181`、`packages/client/locale/src/client/index.ts:204`、`:238`、`packages/settings/settings/src/index.ts:266`。

## 许可和署名覆盖范围

聚合根 `LICENSE` 是完整 MIT 文本，版权行为 `Copyright (c) 2026 zouyuxuan122`。它不能为所有嵌套外来实现重新授权，也不能替代原作者署名。

| 类别 | 组件 | 判读 |
| --- | --- | --- |
| 自带完整许可全文，共 5 项 | loader、compact、file-drop、scroll-fix、unified-market | 分别保留 DSH EAC · 揽尽万象、Deepseek Harness EAC contributors、Deepseek Harness EAC、原无姓名版权行、Sanqi-normal 的通知。不能统一改写成根版权人 |
| 缺成员 LICENSE，但同包有明确原研归属，共 5 项 | viewport-lock、locale-compat、core-bridge、easy-setup、plugin-shield | 原 manifest 的 source 指向 zouyuxuan122/DSH-Desktop-EAC，x-eac 明记原研。结合聚合包完整 MIT，是可继续使用的范围性许可材料；**不因子目录少一个文件就宣称无权**。将来独立分发须随包保留这段授权全文和来源说明 |
| 外来伴侣实现，共 4 项 | terminal、file-changes、plugin-manager、client-file-changes | 原 manifest 明指 myYangyunfan/dsh_desktop，package 只声明 MIT，聚合包未带这些组件对应的原版权通知。结论是“本批材料的原通知完整性未解决”，不是“无权使用”。主控可从其正在查的上游材料补证；本 worker 不重复联网 |

只有 loader 内附 `NOTICE` 和 `THIRD-PARTY-NOTICES.md`，其声明不含捆绑第三方运行时代码/图片，外部依赖不在包内重分发。本聚合包没有 14 款皮肤的图片素材，不把 loader 的通知推广成其他插件或皮肤素材的授权。原许可证行尾存在与 latest-beta 不同的字节，摘要各自保留，未做换行“清洗”。

## 可安装包清单（已有发行复用）

| 包 | `ready/` 文件 | SHA256 |
| --- | --- | --- |
| `@dsh-eac/ui-skin-loader@1.1.0` | `dsh-eac-ui-skin-loader-1.1.0.tgz` | `b926aad7d312c9573226414867049a48b6825e2bb15d8ba76a3d707095ef1ba6` |
| `dsh-settings-scroll-fix@2.0.2` | `dsh-settings-scroll-fix-2.0.2.tgz` | `e160298f49cc9064212fcedb6eea808a436bbaf585f38872dbcc20fb06b23204` |

保留原冻结 releaseId、版本和压缩字节。不能用本轮 raw-components 的同名同版本归档覆盖已有发行，也不能把 `installCandidate:true` 写成已实装、已验功能或已公开下载。

## 路线取舍和复现

| 路线 | 优点 | 局限 | 本轮处理 |
| --- | --- | --- | --- |
| 原样提取 + 复用已有独立发行 | 不改身份/代码/manifest，摘要可核验，省构建 | 拆出的 14 项本身仍不能加载；仅两份既有独立包可试装 | 已选择，符合本轮边界 |
| 用现有聚合插入行补独立 bundle 声明 | viewport/locale 可形成新增独立候选 | 会改变安装元数据，需要明确派生版本、许可随包与后续验收；不能同版本替换旧字节 | 交主控选择，不在本轮改 manifest |
| 实施私桥/profile/Agent 适配 | 可恢复其余实际功能 | 需要改源码与功能验证，单纯重压缩无法完成 | 超出本 worker 范围 |

```powershell
python scripts/catalog/recover-desktop-components.py --verify
```

输出默认写到上述 components 目录；不同字节的已有文件一律拒绝覆盖。输入聚合包和两个既有候选的 SHA256 固定在脚本中，输入发生变化会拒绝沿用当前判读。gzip 时间、tar 顺序/权限/归属固定；工具链版本记入报告，同一工具链重跑可复现。

一次定向检查包含：14 个成员全部文件（包括原 manifest）与父包逐字节相等、再次在内存打包得到相同 tgz；两个候选与冻结归档完全相同、存在独立插入 patch、执行文件和现成 patch 与聚合成员相同、原许可保全；未解决私桥和压缩装配问题的组件未进入安装候选。具体结果以输出 `validation.json` 为准。

工程只新增本说明和上述生成器。没有修改 src、共享 catalog/data、任何源 manifest 或根 README，没有操作 profile/组织仓，没有 Git 提交/推送，没有网络/第三方脚本/全局 build，没有启动 Desktop。主控只应接入 `ready/` 的原发行；其他成员应按表中具体缺项修复，而不是笼统标“缺许可”或直接开放聚合包。
