# 作者资料与两条发行路线

本指南描述市场私有接收工具；不新增官方 DSH 或 Mojobox 公共协议。目录、README/截图资料 ZIP、可安装 tgz 是三个不同对象。工具不会联网发布、安装插件或在用户设备执行作者构建命令。

## 选择路线

| 路线 | 适用情况 | 作者交什么 | 团队承担什么 |
| --- | --- | --- | --- |
| author-release（优先） | 作者已有官方标准发行包 | 原始 tgz、完整 commit、固定发行链接、许可/再分发依据、说明和图片 | 校验原字节、实际安装与使用验证、发布同摘要镜像 |
| team-build | 作者只提供已授权源码 | 完整 commit、源码子目录、锁文件、精确工具链、许可/明确授权、构建配方 | 在隔离且限时限资源的 CI 构建，记录实际 buildRun、工具链和目标平台；成品独立审核 |

两条路线都有可执行校验器和无害样例。团队构建不能把 README 命令直接交给市场 Host 执行；配方校验只确认结构和输入绑定，不证明命令安全，也不自动开 CI。实际 CI 环境需由团队配置，未获真实源码授权/发行权限时仅完成本地材料验证。

## 模板与本地命令

复制 `catalog-source/templates/author-submission.json`、`release.json`、`presentation.json`；团队路线再使用 `build-recipe.json`。`null` 是故意留下的缺项，不能当正式数据提交；校验器会拒绝。完整输入可参考生成的两套明确测试样例。

在工程根目录，用已有 Node 24 运行。输出目录必须是新的自选目录：

```powershell
node scripts/catalog/create-sample.ts D:/eac-market-verify/my-content-batch/samples
node scripts/catalog/validate.ts submission D:/eac-market-verify/my-content-batch/samples/author-release/submission.json --allow-test-fixture
node scripts/catalog/validate.ts submission D:/eac-market-verify/my-content-batch/samples/team-build/submission.json --allow-test-fixture
node D:/eac-market-verify/my-content-batch/samples/team-build/build-fixture.mjs
```

最后一行只执行本项目生成的已知空 bundle 样例，生成 `rebuilt-fixture.tgz`，不执行第三方源码。原包和复建包应有相同 SHA256。样例的 `example.invalid` 地址、全零 commit、合成审核人仅为测试输入；工具不会请求这些地址。移除 `--allow-test-fixture` 后，样例必须被拒绝。正式接收命令不要加这个参数。

成功结果是 `validated-local-materials`、`publication:not-published`、`runtimeVerification:not-tested`。它明确表示原 tgz、包身份、官方 patch 文件存在、元数据原字节、许可证材料和团队配方关联已经在本地检查；不代表已上架、已验证作者身份、取得法律授权或官方宿主运行成功。

`releaseId` 由 `releaseIdFor({pluginId,packageName,version,artifactDigest})` 确定。`metadataDigest` 对官方包是实际 `package.json` 原字节摘要，对 dsh-std 是真实 Manifest 原字节摘要。改 JSON 排版也会改变原字节摘要。

## 草稿、README、图片与资料 ZIP

1. 新建和首次保存沿用原流程。重开使用草稿列表/读取接口。后续保存必须带看到的 `expectedRevision`；其他保存已经改变 revision 时拒绝覆盖。相同时钟下保存相同正文也会推进 revision。
2. README 先解析到完整 commit，相对图片也来自该 commit。两步接口 `previewReadme` 生成候选与旧稿，`applyReadmePreview` 在确认后保存相同候选；确认时再校验 revision，不重新下载浮动分支。预览 15 分钟有效，服务重启后需重新预览。
3. GitHub 的许可证字段只是线索，不等于转载授权。保留原作者、原链接与许可通知；跨来源替换正文应重新审查新增内容的使用条件。
4. 图片仅允许有界 PNG/JPEG/GIF/WebP。通过分块通道上传并绑定草稿 revision，服务端确认后才能加入草稿。读取须确认媒体 ID 属于该草稿，返回 base64/MIME/摘要，不返回本机路径。
5. `.eac-market-presentation.zip` 内包含 `presentation.json`、`README.md`、`provenance.json`、`media/*.bin` 和 `checksums.json`。导入核对路径、大小、摘要和媒体集合，仅写本地草稿。它不是插件 tgz，不执行脚本。
6. 空导出参数不会抹掉 provenance；部分参数合并保留未提及的署名许可。新导入的正文与 provenance 通过同一个原子文件提交，旧单独 provenance 文件继续可读。
7. 分块导入开始前持久标记；若导入回执未知，不自动再导入一次。先重开草稿核对结果，再决定重新上传，不能把网络重试当作再次创建草稿的授权。

README 网络失败、预览过期、revision 冲突与 ZIP 校验失败都保留原稿。图片下载完成但最终导入失败时可能保留未引用的有界媒体缓存，不会假装已附加到草稿。图片类型检查不等于完整图像解码器的安全认证。

## 团队管理操作证据

`CatalogPlugin.managementEvidence` 是市场私有的**团队审核报告索引**，不是官方 `removable`、作者声明或通用运行兼容证明。可选字段缺失时保持缺失；只阻止需要这些事实的 AI 卸载/降级风险操作，手动官方入口仍可用。

记录必须包含 `reviewId, artifactDigest, reviewedBy, reviewedAt, stateless, removePreservesExternalData, downgradeFrom, explanation`。摘要必须等于对应插件制品；时间必须真实、不能未来；两个布尔结论不可由字段名字推断；`downgradeFrom` 每项是明确测试过的精确来源版本，不能写 `latest`、版本范围或“所有版本”。

团队应保留对应报告，记载实际宿主/系统/架构、起始版本、安装包摘要、测试前后文件/配置、反向依赖和原始回执。只有已复核的报告才能进入受控目录。作者提交的“无状态”“卸载保留数据”只放在候选说明，不能自动复制成团队已验证证据。管理执行器还须核对当前安装字节与完整反向依赖；目录字段自身不授权执行。

生成样例中的 `management-evidence.test.json` 明确是合成测试数据，`downgradeFrom` 不表示真实宿主已经降级过；该文件不会被样例目录组装器自动收录，更不能进入生产推荐。

## 接收与发布边界

资料接收 → 本地校验 → 授权审查 → 隔离官方宿主安装/使用 → 团队内容审阅 → 固定制品发布 → 逐个镜像重新获取并核对字节 → 生成不可变目录 → 最后更新 latest。失败不上传半成品；重建得到不同字节须生成新的制品记录。私人源码仓不是生产下载源。

本轮本地样例与公共协议固定对象测试已执行；正式作者、可达真实双源、真实授权团队 CI 构建和官方 Desktop 体验仍需对应证据，不用本地成功替代。
