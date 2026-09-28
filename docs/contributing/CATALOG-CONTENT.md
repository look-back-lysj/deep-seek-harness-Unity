# 内容目录 v2、组合与撤回

固定公共依据：`DSH-EAC/DSH-Desktop-EAC@44178ab1360dcb8221a666e782391a11f5716074` 的 mojobox；dsh-std Manifest `0.15` 对应 `3df054302468d2091859db4b3bd079042d33f100`。公共 Pack/Lock/Evidence/schema 原始字节不改。测试会只读该提交的正反 fixture；可用 `EAC_PROTOCOL_READONLY_REPO` 指向已有同对象的本地仓库。

## 私有资料分层

| 层 | 私有实现与约束 |
| --- | --- |
| 插件元数据 | v2 必须声明 `metadata.kind:official-bundle` 或 `dsh-std`。前者保存实际 package.json 原字节和文件表，后者保存真实公共 Manifest 原字节；不为官方-only 作者造 Manifest |
| ReleaseRecord | `releaseId` 绑定插件 ID、实际包名、版本和制品摘要；记录元数据摘要、大小、已确认发布时间、author-release/team-build provenance |
| Delivery | 插件/版本/包名/摘要与发行关联，来源有精确大小；执行器冻结整份来源描述。新地址必须重新预检，不悄悄换旧版 |
| Presentation | 介绍单独修订；改介绍不改程序的 publishedAt，不改证据或制品摘要 |
| Recommendation | v2 有 id、精确 version、curator、effectiveAt、可选 expiresAt、withdrawn 和理由；distribution=recommended 不等于精选 |
| ReleaseStatusRecord | releaseId + 单调 sequence + active/withdrawn + reason + effectiveAt。状态追加，不改写同序号；未来生效记录到实际生效时再发布 |
| Catalog publication | `publication:{sourceId,sequence}`；发布序号必须递增，同序号不同字节拒绝，revision 文件本身不可覆盖 |

没有可靠的发布时间就省略，不从介绍更新时间、文件修改时间或当前时间补一个。v2 的显示 `releasedAt` 来自发行记录，并核对输入声明的一致性。旧 v1 继续读取，但新正式生成器只输出 v2。

公共 Evidence 的 Parsed/pass 只说明解析检查成功。v2 的 verified 由当前 Host 的 `id/dshVersion/runtime` 和有效、未撤回的运行 Evidence 决定；别的宿主或过期证据投影为 unverified，原始证据保留。官方-only 包不能使用需要真实 Manifest 摘要的公共 Evidence 冒充验证；缺运行证据时如实 unverified。v1 仍沿用原先严格验证行为。

## 公共 Pack 与私有 MarketCollection

| 对象 | 可引用内容 | 不允许 |
| --- | --- | --- |
| 公共 Pack / PackLock | 固定公共格式、精确 npm source、真实 Manifest/artifact 摘要 | 把 GitHub tgz 捏造成 npm 坐标、改公共 source schema |
| `kind:MarketCollection` | 明确的 releaseId、精确制品摘要、必选/可选、enabled 意图与完整执行依赖 | 导出成“公共 Pack”、省略依赖关系却声称可以安全独立执行 |

`CatalogRepository.collections()` 返回经过引用与无环校验的私有组合。主控须接入同一预检/确认/执行器；未接线时不得显示虚假可安装按钮。公共 Pack 仍在 snapshot.packs，私有组合不混入其中。

## 目录来源与缓存

来源只能由维护者配置 `CatalogSourceRegistry`。UI 输入任意 HTTPS URL 不会被登记为可信。主源/镜像可共享 `catalogId`，缺省时整条回退链沿用起点 sourceId。每次重定向仍做 DNS/IP/协议检查，目录额外要求落在登记的确切 indexUrl；循环回退配置拒绝。

刷新顺序是完整读取与校验 → 保存不可变 revision → 原子创建不可覆盖的接受记录 → 更新快捷 current 指针。接受记录保存最高发布序号、冻结发行摘要和累计生命周期；它是 v2 的提交点。current 写入失败会返回已提交但指针待恢复的真实说明。未到提交点的失败保留上一份快照与 Lock，不启动安装。

旧镜像序号、v1 回退和相同 revision 的不同字节不能覆盖已接受的 v2。读取 previous/embedded 时也应用已知撤回；最高接受记录损坏会阻断安装，不默默忘记撤回。程序重新打开会将在线缓存标 stale：离线无法知道服务器是否发布了新的撤回。清空本地历史也会清空防回退依据；这里没有签名机制或跨外部工具的全局事务保证。

安装生成方案时看当前 installability；**真正写入前还须调用 `assertReleaseActive(pluginId,version,artifactDigest)`**。冻结来源只冻结下载对象，不授予绕过后续撤回的权限。已安装用户不自动卸载。

## 分层组装与校验命令

`catalog-source/templates/catalog-assembly.json` 列出各层 JSON 文件的包内相对路径。组装器逐一读取并完整校验后，使用不覆盖写入创建输出；不抓网络、不执行构建、不改公共文档原字节。生产入口拒绝测试标记、占位 URL、fixture 名称、本机路径和浮动来源。

```powershell
node scripts/catalog/assemble.ts D:/content-candidate/catalog-assembly.json D:/catalog-output/revision-1.json
node scripts/catalog/validate.ts catalog D:/catalog-output/revision-1.json
```

自建样例有 `catalog-assembly.json`，只在显式带 `--allow-test-fixture` 时可组装，输出仍保留 testOnly：

```powershell
node scripts/catalog/assemble.ts D:/eac-market-verify/my-content-batch/samples/author-release/catalog-assembly.json D:/eac-market-verify/my-content-batch/index.fixture.json --allow-test-fixture
```

将测试输出重新交给正式 `validate.ts catalog` 必须失败。不能因为 schema 或本地字节校验通过就宣布线上双源已通过；真实 GitHub/Gitee 文件、维护者、正式目录地址和作者授权缺失只标相应外部验收 partial。

下载取消传到 `ArtifactCache.download(...,{signal})`，覆盖 DNS、重定向、正文流和 tgz 校验；取消后不转下一镜像、不登记缓存引用。正常源失败可尝试冻结清单内的同摘要镜像，保留每次失败原因；大小、摘要、包身份与实际 bundle patch 文件存在都要核对。
