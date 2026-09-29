# Deep Seek Harness Unity · EAC 插件市场

运行在**官方 DeepSeek Harness 内**的社区插件市场。安装后，从侧边栏 **EAC** 浏览和安装插件，不需要自己下载源码或运行命令。

## 新手安装：复制链接，粘贴到「添加插件」

当前市场版本 **0.1.0-mvp.7**；已验证环境：**官方 DeepSeek Harness Desktop 0.1.7-rc.2 / Windows x64**。

**复制下面完整一行链接：**

```text
https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/0bd802b7ef501d9625bdebeb6f7bedc797fa5cc2/artifacts/sha256/204eb66280f6c16979c3eedb88cf7b48498e4c00310167b3cb2578ec562376d4/dsh-eac-market-0.1.0-mvp.7.tgz
```

1. 打开官方 DSH → **插件 → 添加插件**。
2. 把上面的链接粘贴到 **「包名或地址」** 输入框，点击 **安装**。不用提前下载、不用登录 GitHub/Gitee，也不用填写令牌。
3. 安装完成后点击 **立即启用**，在侧边栏打开 **EAC**。需要重启时，先保存任务，再完整退出 DSH 并重新打开。

输入框虽然提示「输入插件的包名、GitHub 仓库地址或本地目录路径」，**也支持上面这种 `.tgz` 安装包链接**。链接固定到已发布版本，不会随源码更新而变动。

### 在线拉取失败？用本地安装包

点击 [下载市场安装包 0.1.0-mvp.7](https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/0bd802b7ef501d9625bdebeb6f7bedc797fa5cc2/artifacts/sha256/204eb66280f6c16979c3eedb88cf7b48498e4c00310167b3cb2578ec562376d4/dsh-eac-market-0.1.0-mvp.7.tgz)，保存后，在同一个 **「包名或地址」** 输入框填写该文件的完整本地路径，例如：

```text
D:\Downloads\dsh-eac-market-0.1.0-mvp.7.tgz
```

把示例改成你实际保存的位置；**不用解压，不要加引号**。此方法只替代安装包下载，首次安装依赖仍可能需要联网。失败时打开官方安装界面的「查看安装详情」查看具体原因。

### 哪些内容不要填进安装框？

| 内容 | 应该怎么用 |
| --- | --- |
| 上面的完整 `.tgz` 链接 | **直接粘贴安装，推荐新手使用** |
| 下载后 `.tgz` 的完整本地路径 | 在线拉取失败时使用 |
| `@dsh-eac/market` | 这是包的名称；目前未发布到 npm，**不能只填这个名字安装** |
| 本项目 GitHub / Gitee 仓库首页、源码 ZIP | 用于浏览源码或发行文件，**不是本市场的直接安装入口** |
| `catalog/index.json` | 市场读取的插件目录，**不是安装包** |

<details>
<summary>安装包校验信息（按需查看）</summary>

大小：832241 字节；SHA256（文件校验值）：

```text
204eb66280f6c16979c3eedb88cf7b48498e4c00310167b3cb2578ec562376d4
```

</details>

## 项目与协作入口

包名 `@dsh-eac/market`。复用官方插件管理器，不另建桌面外壳，不依赖旧 EAC 的 `window.dshDesktop`。

目标宿主：**官方 Desktop 0.1.7-rc.2 / Windows x64 / Node 24**。其他版本或平台不能仅凭编译通过就认为兼容。

- [公开发行镜像（Gitee，无需登录）](https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror)：市场包、插件制品、目录、校验值及原许可。
- [公开源码仓（GitHub）](https://github.com/look-back-lysj/deep-seek-harness-Unity)：任何人都可以下载、克隆或 Fork；向 `main` 合并必须通过 Pull Request 和代码所有者审核。
- [最新交付与实际验证](docs/handoff/PULLABILITY-2026-09-28.md)：当前版本、通过项及未验证项；[此前发行记录](docs/handoff/DISTRIBUTION-2026-09-28.md) 保留历史。
- [下一位维护者从这里开始](docs/handoff/START-HERE.md)。历史审查报告保留，不代表最新实现仍未修复。

> 最新修复：**0.1.0-mvp.7** 已将作者真实发行接入市场，可安装条目由15增至29。Gitee新目录实际读取200；默认展示“可安装”，研究清单在“全部记录”。[本轮交付与真实安装验证](docs/handoff/PULLABILITY-2026-09-28.md)。

## 装好市场后，怎样安装其他插件？

1. 在侧边栏打开 **EAC**，进入「全部插件」。默认显示可安装的功能；「刷新目录」获取新增内容，失败保留上次可用目录并说明原因。
2. 查看插件详情 → 安装预检 → 核对版本及启用意图 → 确认。未验证项需明确选择尝试；硬性不兼容、缺包和官方同名冲突不能绕过。
3. 到「我的插件」查看真实结果。下载完成不等于安装完成；部分完成、等待授权、等待重启、失败分别展示。

**皮肤：**保留「发现 / 全部插件 / 我的插件」三个主导航。从「皮肤中心」进入二级页面，先安装并启用皮肤管理器，再安装皮肤，最后选择应用。切换及恢复默认调用真实 `uiSkinLoader`；缺服务仅提供引导。独立皮肤不再成批占据主目录。含非商业许可素材的皮肤须遵守对应 LICENSE/NOTICE。

**升级已有市场后，请从 DSH「应用 → 退出」完整退出，再重新启动。** 官方可能先更新界面、保留旧后台；仅点击“立即启用”不保证前后台版本同步。

随包的是目录与说明，插件按需下载。当前82个包名中29项有安装入口，其余仍须适配或补齐资料。断网仍可浏览缓存，但不能承诺任意未缓存插件均可离线安装；不会静默安装全家桶。

## 已有能力与边界

| 能力 | 实现方式 |
|---|---|
| 浏览、筛选、详情、我的插件 | 功能插件优先；官方与系统组件默认折叠；资料不全项单独收拢 |
| 安装与管理 | 精确包名/版本/摘要 → 预检 → 确认 → 官方管理器 → 库存和任务结果 |
| 多来源 | Gitee 固定提交制品；原版皮肤保留固定 GitHub 来源；不同构建不冒充同摘要镜像 |
| 皮肤中心 | 目录与运行状态分开；安装不自动换肤；失败显示真实回退结果 |
| 作者工具 | 本地图文、README 预览确认、图片及资料 ZIP；不是在线投稿服务器 |
| 协作扩展 | 内置模块和独立 DSH 插件均可贡献五类位置；不能绕过安装确认 |
| AI 辅助 | DSH 默认模型提供受限提案；校验和确认后执行，卸载/降级另有影响确认 |

源码有实现不等于所有真实业务已经验收。第三方插件业务、真实模型联调、跨平台及长期运行请看实际报告。MVP 不含在线认领/自动发布、支付、任何自动 Star、任意命令或系统修复。

## 合作作者：怎样进入目录

**让你的 Agent 代你投稿：**阅读 [Agent 投稿指南](docs/contributing/AGENT-SUBMISSION.md)，复制其中的启动提示词即可。指南包含允许修改的目录、完整材料清单、真实安装包信息生成、两项校验和 Fork → PR 步骤；没有成品可先提团队构建草稿。作者只交自己的材料，维护者审核并发布目录后才会上架。

优先提供已构建的官方标准 bundle：`package.json` 的 `dsh.bundle.patch` 指向包内真实加载声明。另一条路线是团队取得许可后，从固定源码构建，不让新手电脑运行作者的构建命令。

1. 准备精确版本 `.tgz`、完整源码提交、许可证/署名、README 和可选截图。
2. 按 [作者接入指南](docs/contributing/AUTHOR-ONBOARDING.md) 和 `catalog-source/templates/` 整理材料。
3. 执行 `node scripts/catalog/validate.ts submission <submission.json>` 做离线核验。
4. 在隔离官方宿主实际安装，验证功能入口、业务和停用。静态核验不标成已验证。
5. 按 [镜像与目录维护](docs/contributing/DISTRIBUTION.md) 部署固定制品、摘要及发行记录，再更新目录。缺材料仅列入待补清单。

[EAC 清点说明](docs/contributing/EAC-PLUGIN-INVENTORY.md) 记录最新基线、官方对照、旧私桥、同名冲突及暂缓原因。全部收录不等于全部兼容。

## 开发与从新目录重建

需要 Node.js 24+ 和 pnpm 11.7.0。克隆有权访问的源码仓后：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm --dir packages/market exec npm pack
```

`check` 串行完成构建、静态检查、测试和包清单检查；失败就停止交付。首次安装依赖需要网络，遵守各自环境下载约定。本项目另做不含 node_modules/lib/shim 的新目录重建，结果见交付报告。

不要依赖忽略的 `packages/cordis-shim` 或旧编译物。`src/protocol-ambient.d.ts` 是必要编译声明，不能删掉或充当运行实现。官方源码附加契约测试需要配置其源码位置，不是普通构建前置。

## 代码总目录与升级接口

| 路径 | 职责 / 维护入口 |
|---|---|
| `packages/market/src/contracts` | 可序列化 Host/Client 契约，变更后重新生成 Typert |
| `src/adapters/dsh` | 官方管理器与真实库存，禁止另写私有安装器 |
| `src/core`、`src/persistence` | 预检、确认、任务、锁、事件与恢复 |
| `src/catalog`、`src/delivery` | 元数据、发行/撤回、来源、校验和缓存 |
| `src/client` | 三主页面、任务、作者工具及二级皮肤中心 |
| `src/client/extensions` | 五类槽位，[接入说明](packages/market/src/client/extensions/README.md) |
| `src/authoring`、`src/host` | 作者资料、Host 组合入口及受限 AI |
| `catalog-source`、`scripts/catalog` | 模板、清点、目录组装和离线验证 |
| `examples/market-extension` | 可构建的独立 DSH 扩展示例 |
| `tests`、`docs` | 自动检查、真实验收、协议证据与协作记录 |

上表 `src/` 相对 `packages/market/`。新增首页补充、更多工具、二级页、详情补充、作者工具，优先用扩展契约。外部作者导入 **`@dsh-eac/market/client/extensions`**（仅类型），不要复制安装器。

升级前读 [升级指南](docs/UPGRADE-GUIDE.md)、[生态接口](docs/ECOSYSTEM-INTERFACES.md)、[总目录](docs/index.md) 及 [多智能体分工](docs/handoff/NEXT-AGENT-PLAYBOOK.md)。发行记录不可原地改字节；新构建用新版本/摘要，撤回保留历史。令牌、个人 profile 和真实会话日志不得入库。
