# 发行、镜像和升级对接

本工程分三个对象：源码供协作，目录供浏览和预检，tgz 是交给官方安装器的制品。介绍文字、GitHub 仓库地址、安装包不能互相替代。

## 镜像布局

公开仓：`flowing-shadows-like-scenes/deep-seek-harness-unity-mirror`（Gitee）。私人源码仓继续是 GitHub `look-back-lysj/deep-seek-harness-Unity`，不改公开。

```text
README.md                         用户安装入口及支持边界
catalog/index.json                可移动的目录入口
artifacts/sha256/<digest>/*.tgz    不覆盖的内容寻址制品
releases/<version>/release.json   市场版本、文件、摘要、固定提交
SHA256SUMS.txt                    已发布文件摘要
licenses/<package>/...            原许可和第三方署名
provenance/...                    构建配方、固定源码及派生记录
inventory/...                    EAC与官方对照及缺项原因
```

目录入口随审查后的发布更新；每个制品下载 URL 必须固定到真实 Gitee commit，不能用 master/main/latest。包字节仍需再次计算 SHA256，服务商 HTTP 200 不算校验成功。Gitee 原始文件可能跳转到 `raw.giteeusercontent.com`；目录只允许相同 owner/repo/ref/path 的这一个官方内容域，每一跳仍检查 HTTPS、凭据和网络地址。

原始皮肤可使用相同字节的固定 GitHub URL 作备用源。团队重新打包的制品不能宣称与作者原版同摘要；尚无第二个真实镜像时只登记一个。

## 收录到安装的真实边界

1. 固定源码完整 commit，检查真实包及 LICENSE/NOTICE，辨认原版发行还是团队构建。
2. 从真实 tgz 读取 package.json 原字节、完整文件表、bundle patch。保留官方扩展元数据，不伪造 Mojobox Manifest。
3. 登记 `ReleaseRecord`：包名、精确版本、元数据/制品摘要、大小、来源、工具链及许可依据。
4. 上传白名单制品及许可，匿名重新下载并核验。市场用户不需要发布令牌。
5. `Delivery` 只引用同一个制品，带精确大小和优先级。多个来源不同字节就不是镜像。
6. 组装目录后运行 `node scripts/catalog/validate.ts catalog <index.json>`。
7. 实际启动官方宿主，用最终市场包验证：随包目录 → 详情 → 预检 → 明确试装选择 → 任务 → 官方管理器 → 库存/加载声明。新版本至少验证一项真实功能。
8. 最后更新公开目录入口。失败或部分成功如实记录，不替未验证插件填写 verified。

作者材料入口见 [AUTHOR-ONBOARDING](AUTHOR-ONBOARDING.md)。普通升级、启停、卸载也必须通过已有任务协调器；新 UI 不直接改 profile 或调用独立 pnpm 安装流程。

## 当前目录与旧用户迁移

默认来源在 `src/catalog/defaults.ts`。随包 `data/index.json` 非空，第一次启动无须预热本机缓存。

逻辑 `catalogId/sourceId` 继续保留历史值 **local-eac-skins**：这是为了衔接此前用户已经接受的序号2记录，不表示新版还使用本机文件。公开发行序号3保留已有14条冻结 release 和已撤回事件，再增补新内容。不能清空 acceptances 绕开安全历史。旧客户端升级后可以点击刷新获得新增功能条目；网络失败仍保留旧目录。

后续发布：序号递增、revision 新建、已有 release 不变。修包用新版本和新摘要。撤回增加该 release 的状态序号，不能删除历史或偷偷修改原事件。旧镜像及同序号不同内容会被拒绝。

只有注册记录、没有真实元数据的内容使用 `CatalogSnapshot.listings`：名称、说明、来源、缺项及可选“申请版本”。它不是 CatalogPlugin，不能生成安装计划。取得资料后先移出 listings，再加入真正插件/发行记录，防止同ID混用。

皮肤分类只由原 package.json 的 `dsh.skin` 协议及稳定ID生成 `kind:'skin' / skinId`，不能凭包名前缀猜。市场通过可选 Cordis 依赖观察 `uiSkinLoader`，不把它设为必需依赖，也不执行目录里的 JavaScript。

## 可复现材料及命令

`scripts/catalog/eac-inventory.py` 清点固定树与官方归档，原始输入及运行命令见 [EAC-PLUGIN-INVENTORY](EAC-PLUGIN-INVENTORY.md)。它只读，不运行第三方脚本；缺失材料明确列出。

`scripts/catalog/prepare-distribution.ts` 合并已审查材料、旧冻结历史和实际上传回执，生成公开目录：

```text
node scripts/catalog/prepare-distribution.ts <旧目录> <清点目录> <待补清单> <上传回执> <新目录>
node scripts/catalog/validate.ts catalog <新目录>
```

准备脚本从已验证的前一目录递增 sequence，保留 sourceId，以固定材料时间生成新 revision，并用累计发行历史再次校验。下一批必须传入真正最新的已发布目录，不能把旧输入反复作为线上基线。目录及上传回执保存在 `catalog-source/distribution/`。制品大文件放公开镜像，开发者构建市场不需要下载全部皮肤。

## 凭据和维护职责

发布用令牌仅通过维护者本机进程内存或秘密管理服务传入，不能进入 URL、Git、日志、README 或客户端。发布工具必须核对账号/目标仓库，并且只上传发行白名单；不要把私人源码树整体镜像公开。

维护者改内容与镜像；适配维护者改官方管理器边界；UI维护者用扩展槽位和现有预检接口。多智能体独占文件，冻结写入后主控串行构建、打包、真实宿主验收。

可以选择源码编译（便于开发和审核，但需工具链）或下载固定tgz（适合新手）。只有兼容版本、可达下载源、有效发行包和官方安装器共同满足，才能完成安装；遇到权限、网络或官方依赖失败，必须给真实错误和重试入口。
