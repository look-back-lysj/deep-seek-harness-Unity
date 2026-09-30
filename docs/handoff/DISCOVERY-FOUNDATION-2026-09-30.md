# 发现页与全部插件基础接力

日期：2026-09-30。目标是为发现页和全部插件页提供稳定雏形；本轮优先完成桌面前端体验，内核只增加可解释、可选的目录投影。

## 已确定的页面结构

- 发现页顺序：首推海报 → 皮肤推荐 → 高分插件 → 高分 skill → 规则发现/套餐。
- 首推在多个版本绑定的推荐插件之间轮换。图片来自目录已登记的截图或 Presentation 媒体；没有图片、图片为空或加载失败时，显示插件名和一句话简介的固定尺寸文字海报。
- 轮播支持上一项、下一项、暂停/继续、鼠标悬停暂停和键盘焦点暂停；用户设置减少动态效果时不自动轮换。
- 皮肤推荐、高分插件和高分 skill 没有有效目录数据时整块隐藏，不显示空卡片。
- 全部插件继续使用同一 CatalogSnapshot 网格、搜索、用途、安装状态和验证状态筛选；不可安装条目显示原因并禁用安装。

## Core / Adapter 合同

CatalogSnapshot.discovery 是可选投影：

- featured
- recommendedSkins
- highScorePlugins（无有效评分时省略）
- highScoreSkills（无有效评分时省略）

卡片绑定 pluginId + version，包含标题、简介、推荐理由、排序、来源和可选评分/海报。Core 只接受明确的推荐来源、有效时间、精确版本和 0–5 的有来源维护者评分；没有评分不能用 0 代替。高分区不是用户评论或登录评分系统。撤回、硬阻断或版本失配的卡片在 core 投影阶段过滤。

旧目录没有 discovery 时，Desktop adapter 只兼容旧的 featured 推荐；不会从插件对象猜评分或皮肤推荐。

## 文件与验证

- 合同：packages/market-core/src/contracts/types.ts
- 投影：packages/market-core/src/catalog/discovery.ts
- 解析/生命周期：packages/market-core/src/catalog/recommendations.ts、validate.ts、lifecycle.ts
- 页面：packages/market/src/client/MarketPage.tsx
- 主题样式：packages/market/src/client/marketStyles.ts
- 回归：tests/catalog/discovery.test.ts、tests/client/ui-audit.test.tsx、tests/client/visual-polish.test.tsx

本轮定向测试 37 项通过；完整 pnpm check 为 539 项通过、2 项固定外部协议测试跳过，构建、lint、类型和双包边界检查通过。未做正式 Desktop 新双包安装、公网 core 下载或图片 CDN 可达性验收。

## 后续实现顺序

1. 目录维护者先为真实插件补 Presentation.media 和推荐记录，图片必须有许可与固定来源。
2. 再补维护者评分来源和 skill 的稳定分类；没有事实就不开放对应分区。
3. 重新构建双包，在隔离 Desktop 验证发现页、全部插件筛选、图片失败降级、窄屏和重启。
4. 完成公网 core 来源和 mvp.9 升级验收后，才替换 Gitee 正式安装入口。
