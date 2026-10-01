# EAC Market Client 交互审查与升级记录

日期：2026-09-30
状态：阶段 1–5 已落地；当前进入真实 DSH Desktop 兼容性验收。

## 当前问题登记

| 编号 | 区域 | 当前风险 | 升级目标 |
| --- | --- | --- | --- |
| NAV-01 | 次级页面 | 帮助、设置、作者工具缺少统一返回上下文 | 记录来源页面、筛选、滚动和焦点，统一返回 |
| NAV-02 | 详情 | `previousView`、筛选和 scroll key 分散，扩展/作者/皮肤来源容易返回错误 | 使用统一 NavigationSnapshot |
| NAV-03 | 皮肤中心 | 通过 hidden 容器保留页面，来源和内部 tab 状态没有统一历史 | 把皮肤中心视为明确子页面，进入/返回可恢复 |
| NAV-04 | 扩展页 | 扩展打开自己的页面后返回固定发现页，丢失原始来源 | 返回原始 NavigationSnapshot |
| NAV-05 | 快速点击 | 多次点击可能产生迟到的滚动/焦点回调 | 每次导航分配 intent，只有最新 intent 可以提交恢复动作 |
| FILTER-01 | 全部插件 | 搜索、分类、安装状态、验证状态、排序和来源条件分散 | 统一 applied filter snapshot，并显示可关闭来源上下文 |
| ASYNC-01 | 安装/管理 | 不同组件各自处理 loading、错误、unknown 和重读 | 建立统一 action lifecycle，保留真实失败语义 |
| MODAL-01 | Modal | 多个 Modal 的关闭、焦点和二次确认清理不完全一致 | 统一打开、关闭、Escape、遮罩、焦点和脏状态策略 |
| TASK-01 | 任务 | 任务抽屉、AI、待授权、待重启和失败下一步分散 | 统一任务状态到下一步的映射 |
| SKIN-01 | 皮肤 | 皮肤状态、切换、重试和管理器引导分散在多个状态 | 统一 skin action state 和重新核对边界 |
| COPY-01 | 反馈文案 | 不同页面对同一状态使用不同按钮/提示词 | 建立动作状态词典，避免“安装/查看方案/管理”混乱 |

## 导航状态合同

```ts
interface NavigationSnapshot {
  view: MarketView
  source: 'top-nav' | 'discover' | 'all' | 'mine' | 'skins' | 'detail' | 'secondary' | 'extension'
  filters: PluginFilters
  availableOnly: boolean
  sort: BrowseSortMode
  page: number
  scrollTop: number
  focusKey?: string
  section?: string
}
```

阶段 1 只落地 Client 内部状态，不接入 URL、不修改 DSH 私有路由、不修改 Remote。

## 阶段顺序

1. NavigationSnapshot 和返回历史；
2. 筛选 draft/applied/source context；
3. 统一插件 action state；
4. 异步 action lifecycle 和重读策略；
5. Modal / focus / dirty state；
6. 任务、AI、皮肤中心的下一步映射；
7. 最后才补页面动效和细节动画。

## 阶段 1 完成标准

- 从发现、全部插件、我的插件、皮肤中心、详情、设置、帮助、作者和扩展进入任意次级页面，返回都能恢复来源。
- 返回恢复原页面、筛选、分页、滚动位置和可用焦点；原节点消失时回退到标题或内容区。
- 快速连续点击不会执行旧的滚动和焦点回调。
- 目录刷新导致详情版本消失时，给出可解释的回退，不进入空白页面。
- Client 定向导航、状态和 browser-check 通过。


## 阶段 1 实施记录

- Client 已加入 NavigationSnapshot，统一保存来源页面、筛选、安装范围、排序、分页和滚动位置。
- 详情、皮肤中心、设置、帮助、作者工具和扩展页均能保存来源并提供返回入口。
- 旧节点消失时继续使用已有标题/内容区焦点回退；Remote、Core 和安装协议未修改。
- 定向导航、状态、Modal 测试和 browser-check 通过。


## 阶段 2 目录筛选

- 全部插件页显示当前结果数量和当前筛选摘要。
- 搜索、用途、验证、安装状态和可安装范围统一通过 clearBrowseFilters 清理。
- 来源筛选不会无声消失，用户可以明确清除来源条件。
- 筛选变更仍只影响目录结果，不触发 Remote 或页面跳转。

## 阶段 3 插件动作状态

- 已加入 pluginActionState，让首推、普通插件卡、皮肤推荐和详情共用安装/确认/管理/阻断/运行时不可用状态。
- 旧组件测试保留真实文案和 disabled 原因，未改 Remote 或 Core。
- 安装提交中的 Modal 不能通过 Escape 或遮罩关闭，避免用户在官方写入进行时误以为操作已取消。
- 代码复制在 Clipboard API 不可用时尝试安全 fallback，并显示失败提示。
## 阶段 4 异步动作生命周期

- Client 新增 `action-state.ts` 和 `action-feedback.tsx`，只在前端把已有 Remote 返回映射为 `preparing / running / completed / partial / failed / unknown / needs-recheck`。
- 目录刷新、启用/停用、卸载、诊断导出、任务操作、皮肤切换和作者工具统一显示状态、结果和下一步；未知结果不会自动重放写入。
- 插件管理在写入后先重读库存；库存读取失败时显示“需要重新核对”，不把旧库存当成成功。
- 任务 AI 的二次确认取消会清理旧的幂等确认键，避免下一次确认沿用旧挑战。

## 阶段 5 任务、皮肤和作者工具收口

- 任务卡区分已执行、已排队、需要重启、部分完成、失败和结果未知；AI 方案的“已执行”不会误读旧任务对象。
- 皮肤切换在点击前重新核对运行时，失败、回退、疑似残留和结果未确认分别给出恢复动作；重复点击受锁保护，可从提示中重试。
- 作者草稿保存、README 预览、导入、上传和导出沿用 Host revision 作为唯一保存依据；失败可以重试，脏草稿离开作者工具会先提示并保留本次会话中的编辑。
- Modal 继续保留焦点陷阱、Escape 关闭和安装提交保护；脏草稿提示不会修改 Remote 或 Core 合同。

## 当前未完成的宿主验收

- 真实官方 DSH Desktop 中的主题 token、读屏、Windows forced-colors、120%–200% 缩放和嵌入式 Modal 覆盖范围。
- 真实网络图片加载失败、恢复和官方插件管理器状态变化。
- 合成 browser-check 只能证明 Client 逻辑和静态兼容分支，不能代替上述真实宿主验收。
## 2026-10-01 视觉系统实施进度

- Phase 1：页面壳、顶栏、品牌标记、内容轨道、字体层级和 surface 体系已落地。
- Phase 2：首推舞台、推荐皮肤、高分区和规则发现的密度已分离；无图 fallback 改为平面文字海报，避免用明显纹理伪造媒体。
- Phase 3：目录工具栏、结果摘要、draft/applied 高级筛选、详情事实栏和目录卡层级已落地。
- Phase 4：任务、皮肤中心、作者工具共享新的工作台 surface；作者工具在 480px 下切换为单列。
- Phase 5：主视图、结果区、首推舞台、控件和浮层动效预算已收敛，并保留 reduced-motion / forced-colors fallback。
- 当前证据：完整 `pnpm check`、Client 定向测试、browser-check 和 Impeccable detect 均通过。
- 仍待真实 DSH Desktop：主题 token、读屏、120%–200% 缩放、forced-colors、嵌入式 Modal 覆盖和官方 pluginManager 长链路。
## 2026-10-01 真实宿主尝试

- 使用 `D:\eac-market-verify\dsh-home-visual` 作为隔离 `DSH_HOME` 尝试启动本机 `DSHEAC AIO.exe`。
- 进程创建成功但窗口在等待期间持续 `Responding = false`，没有进入可交互的 DSH Desktop 页面。
- 已停止该隔离进程；没有修改日常 profile、凭据或用户数据。
- 因此真实主题 token、读屏、缩放、forced-colors、嵌入式 Modal 和官方 pluginManager 长链路仍为未验收，不能用合成 browser-check 代替。
## 2026-10-01 官方版宿主测试约束

- 真实宿主验收只允许使用官方 DeepSeek Harness Desktop `0.2.0-rc.1` Windows x64。
- `DSHEAC AIO`、Lite、社区壳、合成 browser-check 和本地 fixture 都不能作为官方宿主通过证据。
- 本机当前发现官方 `deepseek-harness-0.2.0-rc.1-win-x64.exe` 位于 updater pending 目录，但没有确认已安装并可交互的官方 Desktop 主程序。
- 后续必须先安装/启动官方版本，并使用独立、明确授权的测试 profile；在此之前只能报告 Client 合成检查通过。
## 2026-10-01 官方包兼容门禁

- 使用官方提取目录中的 `@deepseek-ai/dsh-app-boot@0.2.0-rc.1`：`D:\eac-market-verify\official-0.2.0-rc.1-extracted-20260929-162929\dsh\node_modules\@deepseek-ai\dsh-app-boot`。
- `node scripts/verify-official-compat.mjs --official-app-boot <path>` 已通过 runtime `0.1.7-rc.2`、`0.2.0-rc.1` 和 `0.3.0-unknown` 的官方 peer gate。
- 这只证明官方包合同兼容，不证明未知未来 API、真实 UI 页面或官方 pluginManager 长链路运行兼容。
