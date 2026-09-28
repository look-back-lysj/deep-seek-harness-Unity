# 旧验收要求：接力登记表

生成日期：2026-09-28。逐行登记自 [旧验收矩阵](../ACCEPTANCE-MATRIX.md)，保留原场景、断言和层次要求。ACC 前缀与审查 AUD 前缀区分；本表不复制任何历史通过结果。

所有状态均指下一接力批次，初始为 not-run。建议阶段便于派工，不减少原要求；主控可以细化 owner，但不得静默删除门槛。

| 接力编号 | 建议阶段 | 场景与执行动作 | 关键断言 | 原验收层／门槛 | 本批状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| ACC-A01 | S0/S1/S5 | 解包最终tgz，解析每个导出与Typert schema引用 | 有运行时schema模块；不存在只在源码成立的`/types#...`；Client不含Node入口 | P，必须 | not-run | 待记录 |
| ACC-A02 | S0/S1/S5 | 干净官方Desktop安装市场，打开EAC页 | sidebar/main均可见；Host与Client分别激活；无重复注册/整屏失败 | D，必须 | not-run | 待记录 |
| ACC-A03 | S0/S1/S5 | 关闭/打开EAC页50次、启停一次市场 | 无重复slot、timer、事件；界面切走不终止Host任务 | U+D，必须 | not-run | 待记录 |
| ACC-A04 | S0/S1/S5 | 缺管理服务、协议主版本不匹配、配置导航不可用 | 浏览可用的部分仍可用；写操作锁住并给准确原因；不自建私有IPC | U+I，必须 | not-run | 待记录 |
| ACC-A05 | S0/S1/S5 | 当前官方环境与旧EAC同时存在 | 市场始终绑定当前Host；不扫描猜profile，不改旧EAC/全局dsh | I+D，必须 | not-run | 待记录 |
| ACC-A06 | S0/S1/S5 | 两个profile、多浏览器标签 | 历史与草稿不串profile；同profile幂等请求只执行一次 | U+I，必须 | not-run | 待记录 |
| ACC-A06a | S0/S1/S5 | 两标签不同幂等键提交同plan；不同plan提交同目标 | 同plan仅一个task；不同plan出队时按新状态复查并必要时要求重确认 | U+I，必须 | not-run | 待记录 |
| ACC-A07 | S0/S1/S5 | 同profile第二Host尝试市场写任务 | 市场锁拒绝冲突；不嵌套官方锁、不强删活锁 | U+I，必须 | not-run | 待记录 |
| ACC-B01 | S3B/S5 | 从随包目录浏览、搜索、详情、套餐 | 三主导航可用；无假推荐/作者/数据；无制品项不能安装 | U+D，必须 | not-run | 待记录 |
| ACC-B02 | S3B/S5 | 首次离线、有缓存离线、目录返回畸形数据 | 合法旧快照继续可读；错误更新不覆盖；状态/时间明确 | U+I+D，必须 | not-run | 待记录 |
| ACC-B03 | S3B/S5 | 改Presentation、保持Manifest原字节 | 原manifestDigest/Lock不受图文改动影响；内容revision独立 | U，必须 | not-run | 待记录 |
| ACC-B04 | S3B/S5 | 非法Pack/Lock关系、旧schema、重复ID、循环依赖 | 拒绝而不是猜测；合法旧版本按声明迁移/拒绝；不会执行插件 | U，必须 | not-run | 待记录 |
| ACC-B04a | S3B/S5 | PackExecution绑定错误Lock、关系缺失、unknown、明确complete空图 | 不把公共requires当依赖图；未知不冒充独立；只有完整且校验成功的套餐开放一键执行 | U，必须 | not-run | 待记录 |
| ACC-B05 | S3B/S5 | Evidence版本/宿主不匹配或仅fixture | 不显示当前环境验证通过；source/digest无安全背书冒充 | U+D，必须 | not-run | 待记录 |
| ACC-C01 | S2/S3B/S5 | 安装一个真实可分发的标准bundle | 用户点确认→校验→官方manager→inventory→下一步；文件和UI吻合 | I+D，必须 | not-run | 待记录 |
| ACC-C02 | S2/S3B/S5 | 主源不可达，备用源同制品可达 | 自动切已登记来源；安装精确目标，不降版本；显示真实来源 | U+I，必须 | not-run | 待记录 |
| ACC-C03 | S2/S3B/S5 | 下载成功但摘要错误、同版本镜像字节不同 | 不调用安装；隔离错误缓存；不能更新期望摘要自我放行 | U+I，必须 | not-run | 待记录 |
| ACC-C04 | S2/S3B/S5 | 校验后的文件被替换或包内身份不符 | 安装前复核失败；不能“校验URL A、安装URL B” | U+I，必须 | not-run | 待记录 |
| ACC-C05 | S2/S3B/S5 | 官方把依赖记录为本地file路径，用户清缓存 | 被引用tgz保留；未引用缓存可清；重启/重装解析仍成立 | I，必须 | not-run | 待记录 |
| ACC-C06 | S2/S3B/S5 | tgz/作者ZIP含`../`、绝对路径、链接、大小写碰撞、大膨胀 | 无越界写入；明确拒绝；拒绝日志无用户秘密 | U+I，必须 | not-run | 待记录 |
| ACC-C07 | S2/S3B/S5 | 网络超时、下载取消、磁盘不足、权限不足 | 有界失败；进度不假增长；空间失败不报成功；可重试有明确入口 | U+I，必须 | not-run | 待记录 |
| ACC-C08 | S2/S3B/S5 | 未知验证与已知peer硬不兼容各安装一次 | 未知需明确试装；硬不兼容不能突破；脚本权限不被“仍然尝试”涵盖 | U+I+D，必须 | not-run | 待记录 |
| ACC-C09 | S2/S3B/S5 | 包需要构建脚本、授权后清单变化 | 显示精确待授权包；只批准确认清单；变化重新请求；不全局放行 | U+I+D，必须 | not-run | 待记录 |
| ACC-C09a | S2/S3B/S5 | 批准后刷新、重复批准、过期attempt、不同清单摘要 | task.approveBuilds绑定原挑战且幂等；不重新start；不批准过期/越界包 | U+I+D，必须 | not-run | 待记录 |
| ACC-C09b | S2/S3B/S5 | 权限批准持久化后安装失败 | 明确显示“权限已保存、安装失败”，allowBuilds与UI一致；不谎称仅本次或自动撤回 | U+I+D，必须 | not-run | 待记录 |
| ACC-C10 | S2/S3B/S5 | 标准包缺bundle、格式不支持或无artifact | 不显示可执行的一键安装；原因、官方替代入口或作者修包指引明确 | U+I，必须 | not-run | 待记录 |
| ACC-D01 | S2/S3A/S5 | 套餐含新增/保留/升级/降级 | 一次清单准确显示影响；确认之前不写；降级醒目 | U+D，必须 | not-run | 待记录 |
| ACC-D02 | S2/S3A/S5 | 已禁用A升级、同版本A复用 | 保留原disabled；除非清单显式确认，否则不顺手启用 | U+I+D，必须 | not-run | 待记录 |
| ACC-D02a | S2/S3A/S5 | 已启用A明确选择“更新并禁用”；bundle内单行原已关闭 | 不误把installBundle enabled:false当已禁用；独立官方禁用核验；成员行原关闭保留 | U+I，必须 | not-run | 待记录 |
| ACC-D02b | S2/S3A/S5 | 新装免配置、需账号/大资源、启用要求未知各一例 | 默认分级与确认页一致；用户最终启用意图被保存；不偷下大模型、不替用户登录 | U+I+D，必须 | not-run | 待记录 |
| ACC-D03 | S2/S3A/S5 | 确认后目录revision/目标状态/来源变化 | 绑定旧计划或返回stale重确认；不静默安装清单外版本 | U+I，必须 | not-run | 待记录 |
| ACC-D03a | S2/S3A/S5 | 排队等待/长下载/批准等待期间外部改同目标 | 出队和每次官方写前重核；区分自身成功步骤与外部漂移，必要时停止重确认 | U+I，必须 | not-run | 待记录 |
| ACC-D04 | S2/S3A/S5 | A成功、F失败、B依赖F、C独立 | A保留、B暂停、C仅在状态可判定安全时继续；整体partial | U+I+D，必须 | not-run | 待记录 |
| ACC-D05 | S2/S3A/S5 | F失败且共享安装状态不明 | 暂停后续所有可能受影响项，不假定C无关；明确needs-attention | U+I，必须 | not-run | 待记录 |
| ACC-D06 | S2/S3A/S5 | 同名file/link/fork插件已装，套餐要求registry版本 | 标明来源冲突，不自动替换；没有被授权的用户代码丢失 | U+I，必须 | not-run | 待记录 |
| ACC-D06a | S2/S3A/S5 | 市场安装成本地缓存file引用后再更新 | 凭市场任务记录/缓存摘要/当前引用识别归属，允许正常更新；记录或引用被改则保护性拒绝 | U+I，必须 | not-run | 待记录 |
| ACC-D07 | S2/S3A/S5 | 安装后返回restart-required或overridden | UI不是立即可用；保持等待重启/覆盖未生效事实；重启后重核 | U+I+D，必须 | not-run | 待记录 |
| ACC-D07a | S2/S3A/S5 | A升级待重启，B需要新版A运行服务，C独立 | B暂停且不提前写/启用；C仅按无关安全规则继续；重启证实新版加载后用户resume才继续B | U+I+D，必须 | not-run | 待记录 |
| ACC-D08 | S2/S3A/S5 | remove受保护/被依赖/需停止profile，普通卸载 | 服从官方限制，保留可核实的用户数据；错误/部分影响不被笼统ok吞掉 | U+I+D，必须 | not-run | 待记录 |
| ACC-D09 | S2/S3A/S5 | 用户在官方页/CLI同时修改同目标 | 市场检测漂移/核对结果；不死锁、不盲覆写、不宣称完全跨工具互斥 | U+I，必须 | not-run | 待记录 |
| ACC-E01 | S2/S5 | 下载、installing、applying阶段分别取消 | 显示cancelling直到回执；too-late/not-running各正确；成功项不冒称回滚 | U+I+D，必须 | not-run | 待记录 |
| ACC-E02 | S2/S5 | 浏览器刷新或离开市场，Host继续 | 重新打开找回任务与序号，无重装；不丢终态结果 | U+I+D，必须 | not-run | 待记录 |
| ACC-E03 | S2/S5 | 官方安装已结束，waitForInstall返回null | 使用已持久结果或reconcile，不把null当成功/未开始自动重试 | U+I，必须 | not-run | 待记录 |
| ACC-E04 | S2/S5 | 下载中/调用前/调用后结果未存时终止测试Host | 重启能识别interrupted；逐项查事实；不自动重放不明写操作 | U+I，必须 | not-run | 待记录 |
| ACC-E04a | S2/S5 | Windows测试Host退出后仍有包管理子进程 | 不凭市场锁消失开始新写入；官方残留进程处理后再核验；不能确认则needs-attention | I+D，必须 | not-run | 待记录 |
| ACC-E05 | S2/S5 | summary损坏、事件尾行截断、磁盘写失败 | 不静默重置任务；关键状态损坏锁写，诊断可读；不报保存成功 | U+I，必须 | not-run | 待记录 |
| ACC-E06 | S2/S5 | 旧schema仓库升级、迁移途中中止 | 旧数据保留；迁移原子/可重跑；失败有清晰恢复指导 | U+I，必须 | not-run | 待记录 |
| ACC-E07 | S2/S5 | 大量事件/任务、诊断导出 | 分页、有界日志；任务摘要不丢；合成密钥/URL凭据脱敏 | U，必须 | not-run | 待记录 |
| ACC-F01 | S3B/S3A/S5 | 新建/保存/编辑/预览/再次打开作者草稿 | 所见内容稳定；保存失败提示；revision冲突不默默覆盖 | U+D，必须 | not-run | 待记录 |
| ACC-F02 | S3B/S3A/S5 | GitHub README含相对链接、图片、指定分支 | 固定commit、来源/时间记录，渲染/资源正确；无登录要求 | U+I+D，必须 | not-run | 待记录 |
| ACC-F03 | S3B/S3A/S5 | README导入被限速/404、覆盖现有草稿 | 原稿保留；可粘贴备用；覆盖先确认；不是空白假成功 | U+D，必须 | not-run | 待记录 |
| ACC-F04 | S3B/S3A/S5 | Markdown含script、事件、javascript URL、iframe/SVG活动内容 | 不能执行代码/绕过净化；普通合法排版保持可读 | U+D，必须 | not-run | 待记录 |
| ACC-F05 | S3B/S3A/S5 | 介绍ZIP导出后导入，修改后再导出 | 内容/媒体/署名一致；摘要核对；明确“导出”不是“上架” | U+D，必须 | not-run | 待记录 |
| ACC-F05a | S3B/S3A/S5 | 图片/ZIP分块中断、重复/乱序/超限、导出浏览器下载取消 | Host校验前不称保存成功；传输只绑定当前草稿/profile；不接受任意本机路径；浏览器未确认落盘不谎称已保存 | U+I+D，必须 | not-run | 待记录 |
| ACC-F06 | S3B/S3A/S5 | 检查全部导航、设置和产物依赖 | 无Star、GitHub登录、在线投稿/认领/发布功能或假按钮；无多余账号服务 | U+P+D，必须 | not-run | 待记录 |
| ACC-G01 | S3A/S5 | 三窗口尺寸、480px内容区、深浅主题、长文/错误状态 | 不横向撑爆；主操作始终可达；官方页面样式不被污染 | D，必须 | not-run | 待记录 |
| ACC-G02 | S3A/S5 | 仅键盘、焦点恢复、读屏label、120–200%缩放 | 可完成浏览/安装确认/取消/作者保存；颜色不独占状态表达 | U+D，必须 | not-run | 待记录 |
| ACC-G03 | S3A/S5 | 1000条fixture目录、作者编辑按需打开 | 筛选目标≤200ms，新增核心gzip目标≤250KiB；记录真实测量或超预算原因 | U+P+D，性能目标 | not-run | 待记录 |
| ACC-G04 | S3A/S5 | 所有“打开/设置/重启”按钮和无能力情况 | 到实际官方页面或准确指引；不能只改本地状态模拟跳转 | D，必须 | not-run | 待记录 |
| ACC-H01 | S0/S5/S6 | 隔离环境注入市场Host/Client加载失败 | 记录官方恢复路径能否操作，不伤真实profile；不承诺未测恢复能力 | D，必须记录结果 | not-run | 待记录 |
| ACC-H02 | S0/S5/S6 | 新目录接手源码，按README构建/打包 | 命令真实、README总目录/升级指南/注释可用，产物含许可证 | P，必须 | not-run | 待记录 |
| ACC-H03 | S0/S5/S6 | 检查最终目录、日志和tgz内容 | 无测试默认数据、秘密、用户文件、源码绝对路径；第三方署名保留 | P，必须 | not-run | 待记录 |

本表共 62 条原验收要求。AI、新首页和新诊断要求另见 [WORK-QUEUE](WORK-QUEUE.md) 的 N01–N08 及 [AI 守则](../AI-ASSIST-RULES.md) 的专项验收。

原文件 SHA256（登记时）：`EEC744324AA3BB35E842319DBC8738D1EC1FA609ACBAB56B811C84900A52FF78`。源矩阵后来变化时，人工核对差异再更新登记；不得覆盖已经写入的新批次证据。
