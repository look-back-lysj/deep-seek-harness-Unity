# 市场内皮肤中心 UI 接线

范围：仅客户端 UI、tests/client、本文。主控负责 activation、Host、catalog、打包及真实 Desktop 验收。

## 已冻结的接线契约

`MarketPageProps.skinService?: SkinServiceBridge | undefined`，类型来自 `packages/market/src/client/skin-service.ts`。

```ts
interface SkinServiceBridge {
  getRuntime(): SkinRuntime | undefined
  subscribe(listener: () => void): () => void
}
interface SkinRuntime {
  list(): readonly SkinRuntimeInfo[]
  current(): string
  switchTo(id: string): Promise<SkinSwitchResult>
  subscribe(listener: () => void): () => void
}
```

桥接的 subscribe 负责真实 `uiSkinLoader` 服务出现、更换、消失；回调前先更新 getRuntime。页面自行订阅 runtime.subscribe，服务替换及页面卸载时释放两个监听。getRuntime 不创建备用服务、不执行目录 JS、不预先导入未安装包。不把 uiSkinLoader 作为整个市场的必需注入依赖。

依据已读取 `D:/DSH-EAC/DSH-Desktop-EAC` 的 `git show afa947215a862a9c3304f6fff7a812efe5a42fdc:packages/loader/src/protocol.ts`、`client/wiring.ts` 与 `client/index.ts`：加载器 provide 服务，经 ctx.effect 管理 runtime 和控制台；卸载逆序释放，停止 runtime 时撤销当前皮肤。原服务默认 ID 为 `default`。注册只进入 discovered，不意味着 active；switchTo 可能失败并附 rolledBackTo/warning，必须重新读取状态。

## 已按任务选定的方案及取舍

| 决策 | 当前方案 | 备选与代价 |
|---|---|---|
| 市场入口 | 三主导航内一个皮肤管理器入口，打开二级页 | 新增第四导航会改变已定结构；全部皮肤混排会挤占功能插件 |
| 服务能力 | 可选桥接真实生命周期，缺失时安装引导 | 必需依赖会让未安装 loader 的市场无法打开；伪造服务不能证明切换 |
| 安装 | 复用核心正式计划和用户确认 | 页面直接写入会绕开制品校验、试装和风险确认 |
| 分类 | 仅 `CatalogPlugin.kind === 'skin'` | 名称前缀不能证明皮肤身份；loader 本身保留功能插件身份 |

沿用现有 Operate 视觉、主题变量、滚动容器和官方组件折叠。工具 context 未发现 docs/PRODUCT.md 属路径识别局限，本文已直接读取该产品约定，不新增或替换根配置。

## 已实现

- 发现和全部插件仅列功能插件，loader 卡合并成一个皮肤管理器入口；不增加主导航。皮肤详情返回时保留皮肤搜索与滚动位置。
- 二级 SkinCenter 浏览和搜索严格消费 kind=skin。没有制品、暂停、unknown 条目不会被归类过滤掉；卡片保留原因及详情，unknown 的可安装包仍由既有正式计划处理明确试装，hard-blocked 不放行。
- 我的插件聚合已安装皮肤，loader 自身仍是功能插件。皮肤中心保留库存版本、启停、重启、更新和卸载确认入口；匹配目录版本/库存版本/运行版本才允许切换。
- 未安装 loader 时先显示引导，可选先看 loader 计划或仅看皮肤计划；两种均复用 InstallPlanDialog/MarketRemote，完整计划确认前零安装，不自动捆绑或启用。
- 切换只调用注入服务。成功回执还需 current+active 状态佐证；登记只表示 discovered。故障重试有单独说明和确认；失败、回退、warning、超时/异常如实展示。
- 服务移除、更换、同一轮移除后重现均撤旧监听、废弃迟到响应。库存资格变化也使旧切换回复失效；无服务时不提供换肤按钮，不执行目录 JavaScript。
- 用户追加的 `CatalogSnapshot.listings` 由 PendingListings 单独消费。全部插件页末尾默认折叠“待适配与待补资料”，沿用主搜索匹配名称、说明、包名；没有安装按钮，不转换成 CatalogPlugin。requestedVersion 仅以“申请版本（未核实）”显示；来源只允许 HTTP(S)。合成验证覆盖 27 条。

## 本角色修改文件

新增客户端 `SkinCenter.tsx`、`skin-service.ts`、`skin-model.ts`、`PendingListings.tsx`；局部修改 `MarketPage.tsx`、`model.ts`、`components.tsx`、`marketStyles.ts`。

新增测试 `tests/client/skin-model.test.ts`、`skin-browser-fixture.tsx`、`pending-listings.test.tsx`；扩展已有 `browser-check.mjs` / `browser-fixture.tsx`，增加 `--skins-only` 和 `--listings-only`，每次输出独立时间戳目录，不覆盖旧证据。

没有修改 activation/index/extensions、Host/contracts/catalog、根配置、生产 profile；未运行 finalbuild、commit 或 push。工作树原先已有大量未提交内容，不能将整个 git diff 归于本角色。

## 定向验证和证据

| 检查 | 结果 | 证据 |
|---|---|---|
| 皮肤/既有模型/版本选择/安装计划/UI审计 | 5文件34项通过 | `D:/eac-market-verify/distribution-20260928/ui/skin-unit-tests-final.json` |
| 登记清单单测 | 1文件3项通过 | `D:/eac-market-verify/distribution-20260928/ui/listing-unit-tests.json` |
| 皮肤浏览器与旧滚动回归 | 12项通过；1280浅色、480深色固定高度/裁切容器 | `D:/eac-market-verify/distribution-20260928/ui/skins-1790589057197/browser-results.json` |
| 27条登记浏览器 | 4项通过；默认折叠、搜索、无安装、展开收起和窄面板 | `D:/eac-market-verify/distribution-20260928/ui/listings-1790589295219/browser-results.json` |
| 样式机械检查 | 主修改目标一次、追加新组件一次，均为空 findings | 初轮皮肤目录 `skins-1790588900008/impeccable-detect.json`；末轮登记目录 `impeccable-listings-detect.json` |
| 客户端类型检查 | **未全绿**：仅主控接线 `activation.ts:27` 的 ctx.effect 回调可能返回 undefined（TS2769）；本角色文件无报错 | 命令 `node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --pretty false`；留主控修复后串行全量确认 |

截图在上述两个最终浏览器目录：皮肤入口/浏览/已安装/旧官方折叠，各1280与480；登记折叠/展开，各1280与480。初轮截图已逐张打开检查；皮肤最终8张与初轮逐文件SHA256一致。登记最终展开图已重开，折叠图与已看初轮SHA256一致。合成浏览器数据没有用于生产，也不证明实际安装或官方Desktop已验收。

## UI复核与交接状态

本会话无可用子智能体工具，按 impeccable 降级流程在本会话完成复核与文档核对。`disposition: ship` 仅适用于上述定向 UI 范围：persistence（现有视觉和三主导航保留）、fidelity（入口、搜索、状态、确认及折叠满足指定范围）、ceiling（Operate 无新增装饰）、material_fixes（深色链接已改用现有 --eac-link；截图定位已修正）、keep（固定高度滚动及官方分组）。未更改 DESIGN.md 和设计系统。

截至本交接，37项定向单测和16项合成浏览器检查通过；服务接线类型检查问题、全量构建与真实Desktop由主控收口。UI角色停止写入，供主控串行build。
