# EAC Market Client 交互审查与升级记录

日期：2026-09-30
状态：阶段 1 已完成；后续阶段依次处理筛选、异步动作、Modal、任务和皮肤交互。

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

