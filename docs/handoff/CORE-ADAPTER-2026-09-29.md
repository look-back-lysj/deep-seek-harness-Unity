# Core / Desktop Adapter 拆包接力

本批任务：用户批准方案 B，建立便于接手维护的两个独立包。基线 GitHub main `348cd5dca4b99f80eaac37675fd0f4f96d7a8451`（2026-09-29 开工时已联网核对）；工作分支 `refactor/market-core-adapter`。

## 已定接口与目录

先读 [底座指南](../CORE-ADAPTER-GUIDE.md)。core `0.1.0`，desktop adapter 保留 `@dsh-eac/market`、候选 `0.1.0-mvp.10`。Core API v1；Remote 协议 v2，旧缓存页面刷新后才能写。数据目录与持久化格式不变。

子智能体 A 负责 core 门面与自保护，B 负责 Client 协议保护，C 负责双包发行准备；主控负责 Host 连接身份、构建/包配置、集成测试和总文档。构建、打包和真实宿主验收由主控串行执行。

## 验证记录

| 检查 | 本批结果 |
| --- | --- |
| pnpm check | PASS：60文件通过、1文件跳过；534测试通过、2跳过；两项跳过因外部固定协议仓未配置 |
| pnpm typecheck | PASS |
| 包检查 | PASS：31个生成Remote描述；core外部Host依赖、旧exports和浏览器边界通过 |
| 官方peer gate | 0.2.0-rc.1真实evaluator对0.1.7/0.2.0/合成未来版本通过；仅门禁，非任意版本运行保证 |
| 实际安装 | 官方0.2.0-rc.1 CLI、全新DSH_HOME和空store；仅显式add桌面包，core自动从本地测试registry取得并成功导入 |
| 图形实测 | 亲自操作官方0.2.0-rc.1 Web：EAC首页、库存、系统折叠、自身mvp.10运行、作者草稿保存；磁盘draft.json内容已核对 |
| 独立审查 | 一名只读Reviewer检查协议/身份、API/资源、自保护和构建发行边界，未发现有证据的实质缺陷 |
| git diff --check | PASS |

证据目录：D:/eac-market-verify/core-adapter-20260929。最终日志 final-check.log；实际安装 install-final/result.json、install.log；UI证据来自install-02，截图已纳入 [author-save.png](../evidence/core-adapter-2026-09-29/author-save.png)。测试Web进程和本工具打开的标签已关闭，未修改日常DSH profile。

最终候选包在 install-final/packages，模式registry-core、published=false（core尚未发布registry，不能将此候选当现成公网安装入口）：

| 包 | 字节数 | SHA256 |
| --- | ---: | --- |
| dsh-eac-market-core-0.1.0.tgz | 124732 | 312b15b0c24e9b8fd672feeba2238561706a593f7bf5105e3f92ebc288cdd2be |
| dsh-eac-market-0.1.0-mvp.10.tgz | 608790 | 0b42af6076f348d75f2c6fbe99ea9ea95d8356b11c471a5cbcc831060ccacf7a |

逐文件比较UI被测包与最终候选：adapter完全相同；core只改变README.md，代码/声明相同。对比在ui-to-final-package-diff.json。实际安装使用本地fixture registry，不代表Gitee/GitHub公网core链已部署。官方pnpm peers check会报告安装树供应的宿主peers未在profile物理树中，实际宿主已成功解析并运行；未放宽依赖或绕过官方gate来消除该提示。

**验收边界：partial。** 本轮没有实际Desktop安装/旧mvp.9整包升级、跨平台、完整第三方插件安装、在线core源失败切换或TUI验收。旧格式读取与失效任务的单测不替代真实升级测试。公开源发布前须安排隔离Desktop新装和升级；不能沿用历史mvp.8截图。

## 实施中的修正

- 官方Typert需要在聚合源码图中同时看到core和adapter，已用独立聚合路径映射和双包选择修复；没有复制合同或修改官方生成器。
- 保留官方DSH peer的workspace:*语义，发行器在隔离staging仅转换本地core依赖，再npm pack；不直接pnpm pack锁死开发机DSH版本。
- 两包旧相对资源路径已消除；core资源由adapter传原字节，公开工厂拒绝测试对象代替。
- 公共30函数不暴露raw host/tasks/files；本次core原数据格式不变。

## 下一位维护者的边界

1. 查询当前 branch/status 和最新远端，再读本文件与底座指南；旧 START-HERE 已归档，不能用其 mvp.4 状态覆盖本批。
2. 修改 UI 只消费 core 公共合同；新增业务不跨包导入内部文件。接口变更先列消费者、失败语义、协议/数据迁移和测试，再并行。
3. 两包发布前明确 core 的真实获取方式。源码 workspace 链接不是普通用户安装证据；test-only URL 不可发布。
4. 继续使用官方安装器、同 profile 任务协调、原数据路径和原作者协议；不要借拆包扩展成重做市场或任意命令安装。
5. TUI 是预留方向，不是本批已交付产品。先验证无桌面环境下的宿主与通信，再做终端 UI。
6. 不触碰官方源、EAC 组织仓及用户日常 profile；安装验收用 `D:/eac-market-verify` 新目录。

当前未上传新双包；README 继续保留已发布 mvp.9 安装入口，不能让普通用户误装未发布候选。
