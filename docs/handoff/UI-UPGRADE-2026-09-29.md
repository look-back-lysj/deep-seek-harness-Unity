# 2026-09-29 UI 与交互升级记录

本记录对应用户要求的“优化 UI 和交互小细节、使用设计技能、多智能体协作、全自动验收”。它是当前实现与测试事实，不替代 `PRODUCT.md`、`ACCEPTANCE.md` 或官方 Desktop 真实验收。

## 1. 范围与边界

- 工程：`D:\eac-market`
- 起点 HEAD：`088c8cc`
- 当前源码候选包：`@dsh-eac/market`，版本 `0.1.0-mvp.7`（公开发行仍为 mvp.6，本候选仅用于本地验收）
- 只改 Client UI、Client 浏览器验收脚本及对应测试。
- 未改公共 contracts、Host、安装算法、目录格式、profile、官方源码或锁文件。
- 源码改动尚未提交；已生成本地候选 tgz，尚未上传公开发行镜像。

## 2. 多智能体分工

按 `NEXT-AGENT-PLAYBOOK.md` 冻结独占文件后，三名 worker 并行完成：

| Worker | 独占范围 | 主要交付 |
|---|---|---|
| A 交互与导航 | `MarketPage.tsx`、`tests/client/navigation.test.tsx` | 筛选回第一页、主导航回顶、次级页高亮、详情来源高亮、返回焦点、管理入口、页级官方入口 |
| B 视觉与组件 | `components.tsx`、`marketStyles.ts`、`tests/client/visual-polish.test.tsx` | 卡片/状态/禁用解释、截图失败占位、系统组件去重、窄面板触达尺寸 |
| C 任务与弹窗 | `TaskDrawer.tsx`、`InstallPlanDialog.tsx`、`tests/client/dialogs.test.tsx` | 任务状态/真实进度/错误摘要、unsafe 重新预检、弹窗层级与键盘契约 |

主控串行集成，并额外修正 `tests/client/browser-check.mjs` 的异步等待和新标题期望，使其验证新交互而不是旧文案。

## 3. 已实现的交互修复

1. 排序、验证状态、安装状态变化后回到第 1 页。
2. 主导航切换后滚动容器回顶。
3. 设置、帮助、作者工具、扩展页不再错误高亮“发现”。
4. 从发现打开详情保持“发现”高亮；从全部插件打开保持“全部插件”。
5. 详情返回后恢复触发按钮；原节点卸载时回退到列表标题或滚动容器。
6. 已安装插件卡片提供可用“管理”按钮，跳转“我的插件”。
7. “我的插件”页头提供一个全局“打开官方插件页”入口，减少卡片重复按钮。
8. loading/error 状态真实传递更多菜单状态，任务入口保持可用。
9. 系统组件分组顶部只说明一次，卡片不再重复目录缺失文案。
10. 截图失败显示结构化占位、来源和重试，不再像空白块。
11. 任务状态显示语义标签、下一步和真实 `x / y` 逐项进度；无可靠总数不伪造百分比。
12. 预检 unsafe 时明确提示自动重检，并提供真实“重新预检”按钮。

## 4. 验收结果

以下均为本批实际运行结果：

```text
pnpm check
→ PASS：build、lint、380 passed、2 skipped、test:pack

pnpm typecheck
→ PASS

pnpm exec vitest run tests/client
→ 14 files / 86 tests passed

node tests/client/browser-check.mjs
→ 26 checks passed

impeccable detect --json <changed client sources/tests>
→ []

git diff --check
→ PASS（仅换行提示，无空白错误）
```

全量结果：

```text
Test Files  53 passed | 1 skipped (54)
Tests       380 passed | 2 skipped (382)
```

新增测试：

- `tests/client/navigation.test.tsx`：7 项
- `tests/client/visual-polish.test.tsx`：7 项
- `tests/client/dialogs.test.tsx`：7 项

## 5. 浏览器证据

本批 Edge headless 证据位于：

```text
D:\eac-market-verify\post-upgrade-ui-final-20260929-124054
```

包含：

- 1280px 浅色首页
- 480px 深色首页
- 长文本窄屏
- 空目录状态
- 我的插件折叠/展开
- 任务、作者工具、套餐/组合弹窗截图
- `browser-results.json`（26 项全通过）

额外交互探针结果：

- 主导航切换滚动：`441 → 0`
- 排序/高级筛选：均回到第 1 页
- 次级页面：无错误主导航高亮
- 详情来源：保持“发现”
- 已安装卡片：显示可用“管理”
- 返回焦点：原按钮不可用时回退到列表标题

## 6. 未验证项

- 未重新安装最终 tgz 并打开真实官方 Desktop 0.1.7-rc.2。
- 未在真实 DSH 中验证读屏、120–200% 缩放、真实分栏和深浅主题切换。
- 未验证真实网络下的截图重试。
- 未验证真实 AI 模型调用、安装回执和第三方插件安装。
- `browser-check.mjs` 是合成 React/Edge 验收，不是官方 Desktop 证据。

## 7. 升级指南符合性

- 改动仅限 `client` 与 `tests/client`，未改协议、持久化或安装算法。
- 已同步运行构建、类型检查、全量测试、包检查、浏览器检查和机械设计检查。
- 旧截图和旧报告未作为本批验收证据。
- 后续若发布新包，必须重新生成 tgz、摘要和官方 Desktop 证据；本记录不等于发行完成。

## 8. 本地候选包

- 包版本：`0.1.0-mvp.7`
- 文件：`D:\eac-market-verify\ui-upgrade-pack-final-20260929-133945\dsh-eac-market-0.1.0-mvp.7.tgz`
- 大小：`832241` 字节
- SHA256：`204EB66280F6C16979C3EEDB88CF7B48498E4C00310167B3CB2578EC562376D4`
- 构建结果：`pnpm check` 通过；包内容176个文件、30个Remote描述符通过。
- 该包尚未上传 Gitee 发行镜像，也没有覆盖 `0.1.0-mvp.6` 的公开发行记录。

## 9. 真实本地安装

安装前个人 profile 控制文件已备份到：

```text
D:\eac-market-verify\ui-install-backup-20260929-133615
```

待执行并回填：安装结果、重启结果、实际加载的包版本与 Client 摘要。