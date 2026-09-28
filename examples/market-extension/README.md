# 五位置独立扩展示例（仅本地测试）

包名 `@dsh-eac/market-extension-example`，版本 `0.1.0-test.1`。这是有实际 Client 组件的标准 DSH bundle，不能作为正式收录、合作作者或已认证插件。

它提供首页补充、更多菜单、二级页、详情补充、作者工具。只调用 `openOwnPage`、`requestInstallReview`、`previewDraftChange`；没有直接安装、确认、保存、读写 profile 或联网代码。图文内容都是测试说明。

`src/client.tsx` 从 `@dsh-eac/market/client/extensions` **仅导入类型**，编译后没有该子路径的 require。`./client/` 前缀遵守官方 Typert 的 Host/Client 导出划分，不能改成 Host face 导出。React 由官方浏览器加载器提供，不打入第二份 React。市场 peer 为 optional：市场尚未安装时不应从 npm 自动补装市场；运行时通过 Cordis `ctx.inject(['eacMarketExtensions'], ...)` 等待。`dsh.client.inject` 是包图，不是服务名列表，因此本包该字段为空。

`src/index.ts` 是无副作用的 Host 入口，让官方加载器获得一条真实 active bundle 成员并发现 `./client`。实际功能全在 `lib/client.js`。`cordis.patch.yml` 只插入本包一次。

独立构建：在工程根运行 `node examples/market-extension/build.mjs`。仅使用已安装 esbuild、系统 tar；不安装依赖，不下载，不构建或打包市场，不写用户 profile。输出固定到 `D:/eac-market-verify/implementation-20260928/E-extension/`。

主控最终在隔离官方 Desktop 添加生成的 tgz，检查先市场后扩展、先扩展后市场、开关、卸载、市场重启与五处功能。安装前后市场 tgz SHA 应不变。E 的源码和浏览器回归不替代真实 Desktop 安装验收。

内置接法见 `builtin.ts` 的 `registerBuiltinExample(host, owner)`，必须由主控选择性装配；不会自动混入生产首页。两种接法使用不同示例 ID，可以并存。

完整合同、兼容表达式、错误处理与升级指南见工程 `packages/market/src/client/extensions/README.md`。
