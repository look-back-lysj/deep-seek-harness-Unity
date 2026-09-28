# 离线内容工具

要求工程已有 Node 24；不下载依赖，不启动市场构建，不执行插件，不操作 profile。

| 文件 | 用法与作用 |
| --- | --- |
| `create-sample.ts` | `node scripts/catalog/create-sample.ts <新输出目录>`，生成 author-release/team-build 两套无害 testOnly 文件 |
| `validate.ts` | `node scripts/catalog/validate.ts submission\|recipe\|catalog <文件>`；默认正式模式，fixture 必须显式加 `--allow-test-fixture`，但 `catalog` 正式校验始终拒绝 fixture |
| `assemble.ts` | `node scripts/catalog/assemble.ts <assembly.json> <新输出文件>`，逐层校验后写不可覆盖目录；测试输入需显式开关，仍保留 testOnly |
| `sample-build.mjs` | 被复制到生成的 team-build 样例，只把三个已知无害文件重建成 tgz；不是任意作者构建器 |

校验失败退出码为 1；成功记录仍明确 `not-published`、`not-tested`。实际 CI、真实双镜像和作者授权必须另行验收。说明见 [作者指南](../../docs/contributing/AUTHOR-ONBOARDING.md) 与 [目录指南](../../docs/contributing/CATALOG-CONTENT.md)。
