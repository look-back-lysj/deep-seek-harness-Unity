# 首次使用链路复检（2026-09-28）

结论：在官方 Desktop 0.1.7-rc.2 / Windows x64 范围，源码构建、发行包取得、随包目录及插件下载可用；**在线目录刷新当前受 Gitee 451 拦截，不判定全链路稳定。** 本轮修复一处会影响无 D 盘电脑的测试路径；没有扩展审查到其他功能，也没有改产品运行包。

## 查通的链路

| 环节 | 本轮证据与结果 |
|---|---|
| 源码权限与身份 | GitHub main=f4cd896，仓库仍private。取得真实远端Git tree，349个原始文件逐个Git blob摘要一致；协作者必须先有源码仓访问权 |
| 新目录依赖 | 在带中文和空格的新目录重建，不带旧lib/node_modules/shim；屏蔽个人npm配置，按冻结锁文件从共享pnpm store离线安装144个依赖 |
| 构建检查 | 修正测试路径后，README的pnpm check通过：343项通过，2项外部源码测试跳过；包清单174文件、30个Remote描述符通过 |
| 打包 | 按README命令打包成功；Host、Client、Typert入口、package.json、bundle patch和随包目录8项全部与公开发行包原字节一致 |
| 普通用户下载 | Gitee市场tgz通过Motrix匿名下载，569779字节，SHA256=6fdbbe072d403fc4cff98092a131041fa59c910d1ea9c1d9efe852a394515b2f，与已实测安装包相同 |
| 读取目录 | 空目录缓存启动即有55项插件＋27项待补资料；当前在线刷新失败时仍保留82项，并标记过期，不清空、不报成功 |
| 插件下载 | 15个登记制品地址HEAD均200；用市场真实ArtifactCache在空缓存下载dsh-settings-scroll-fix@2.0.2，摘要、包名、版本及官方bundle结构全部通过 |
| 官方安装与运行 | 复用上一轮同摘要发行包的真实Desktop安装证据：管理器和Miku安装后任务completed、官方applied、库存active，应用皮肤和恢复默认成功。本轮没有重复打断用户的日常DSH |
| 关键依赖公开性 | 抽查Typert生成器、官方管理器、Cordis、Typert协议、zod的固定版本，匿名npm元数据接口均200；不是全套空缓存在线依赖安装验收 |

## 确认的问题

**P2，已修：测试对D盘的硬编码。** `tests/catalog/embedded-lifecycle.test.ts` 在Windows上向固定D盘目录写测试数据，没有D盘或目录不可写时，README的check命令会失败。改成操作系统临时目录，可由EAC_TEST_OUTPUT覆盖。定向7项通过，新目录完整检查也通过。改动仅测试，不影响mvp.4运行包，无需重发安装包。

**P1，未解除：在线目录HTTP451。** 默认地址 `https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/master/catalog/index.json` 当前返回 `The content may contain violation information`。仓库元信息仍public，市场包及15个制品地址仍可访问；问题集中在目录原始文件入口。

用产品真实CatalogSourceRegistry和CatalogRepository复测：refresh返回failed，原因保留HTTP451，before/after均为eac-distribution-20260928-3、55＋27项，stale=true。既有随包内容仍可用，但用户无法保证取得后续目录更新。公开API返回200不能证明当前市场刷新链路恢复；当前市场未配置该API解码或第二个有效目录源。

后续可选处理（本轮不扩建基础设施）：

| 方案 | 优点 | 代价 |
|---|---|---|
| 由维护者向Gitee处理内容拦截，恢复原入口 | 代码和地址改动少 | 依赖平台处理，仍是单目录源 |
| 增加独立公开GitHub分发镜像并登记故障切换 | 降低单个平台故障影响；私人源码仓可继续私有 | 需要额外公开发行仓、双源同步和验收；下一步更推荐此方案 |

## 两点验收边界

1. 本机Motrix对GitHub没有Content-Length的源码归档响应失败，未声称完成这条压缩包网络传输。采用真实远端tree＋349文件摘要核对，再由完全一致的Git对象构建新目录。不是把未核实工作目录当远端源码。
2. Git原始LF文件重建的tgz整体摘要为cff23e9fead88f1545af89ace9a5cb6222a0a8125aab3c223ebdfbb9b5036332，与Windows工作目录发行包不同。逐文件比较，仅README和lib/types/client/marketStyles.js的CRLF/LF不同，文件集合及上述8项正式入口完全一致。这不是安装缺陷，但源码自编包不能直接套用发行包校验值。

本轮只运行一次新目录全套检查、一次必要的测试定向检查和一次小插件实际下载，不重测全部皮肤、AI、跨平台、长稳和所有故障组合。未更改日常profile、组织仓或公共协议。只读子智能体审安装说明与本机依赖，完成后已释放；下载器临时并发已恢复。

## 可追溯证据

批次在 `D:/eac-market-verify/recheck-20260928-1905`：

- baseline.json、remote-tree.json、source-proof.json：远端身份和349文件证明。
- install.txt、check.txt、pack.txt：新目录构建、测试与打包。
- rebuild-comparison.json、official-entry-comparison.json：归档差异只限换行及正式入口相同。
- catalog-network.json：真实451与保留目录的结果。
- artifact-availability.json、registry-availability.json：有界联网检查。
- package-verification.json：市场包及真实下载器抽样校验。
- 真实Desktop安装证据沿用前批 `distribution-20260928/desktop/evidence/installation.json`、miku-active.txt、restored-default.txt。
