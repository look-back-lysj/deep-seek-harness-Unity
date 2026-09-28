# 六项交付：公开发行、完整清点与皮肤中心

当前交付版本 **0.1.0-mvp.4**。以下只写本批已经实际实现/核验的事实。开发过程的mvp.3及皮肤`.1`不作为当前推荐发行。

| 用户要求 | 本批结果 |
|---|---|
| 1. 验证插件收录和安装链 | 最终市场包在全新官方Desktop配置安装/更新成功；在未预热市场制品缓存的情况下，从公开镜像安装皮肤管理器与Miku `.2`，任务completed、官方返回applied、库存active一致 |
| 2. README及升级接口 | 根README重写：用户安装、源码构建、目录接入、双发行路线、五扩展位置、皮肤接线、维护/升级入口；保留真实模块注释及模板 |
| 3. 最新EAC对比官方完整整理 | 最新固定beta/pack/skins与官方0.1.7-rc.2对照；82个包名，55元数据条目＋27待补条目；6个原缺blob已取得并验证，缺失0 |
| 4. 他人下载后可构建、安装、读目录 | 新目录无旧lib/shim/node_modules，冻结依赖离线安装＋check通过；最终重新构建的tgz与发行包SHA256一致；全新profile打开即有目录，不依赖本机预热缓存 |
| 5. Gitee镜像 | 已创建公开仓flowing-shadows-like-scenes/deep-seek-harness-unity-mirror；本体及15插件制品、目录、摘要、许可/来源、清点均已部署；全部15插件与最终市场包经Motrix匿名回下载，摘要一致 |
| 6. 市场融合皮肤管理 | 三主导航保留，13款皮肤集中二级中心；动态接真实uiSkinLoader；已实际安装、登记、应用Miku `.2`并恢复官方默认，界面变化、运行版本和持久化activeSkin一致 |

## 最终包

- 文件：`releases/0.1.0-mvp.4/dsh-eac-market-0.1.0-mvp.4.tgz`
- 大小：569779字节，约556 KiB。
- SHA256：`6fdbbe072d403fc4cff98092a131041fa59c910d1ea9c1d9efe852a394515b2f`
- 固定下载URL与镜像提交：[release.json](../../releases/0.1.0-mvp.4/release.json)。
- 目录：`eac-distribution-20260928-3`，历史sourceId保留`local-eac-skins`，公开入口实际为Gitee HTTPS。

## 验证证据

批次根目录：`D:/eac-market-verify/distribution-20260928`。本地证据路径不是用户安装所需路径。

- 新目录冻结安装：144依赖从既有pnpm store离线恢复，没有复制旧node_modules、lib或忽略的shim。
- 新目录最终核心版check：343项通过，2项需要外部官方源码的测试明确跳过；对应`clean-final-check.txt`。
- 外部固定协议两项在主工程设置真实源码路径后通过。官方Cordis/槽位/独立扩展示例专项48项通过（其中41项与常规测试重叠，不累加宣传）；对应`official-extension-contracts.txt`。
- 最后首页修正的模型/UI定向17项通过；原浏览器皮肤及登记16项通过，含1280/480、滚动、折叠、动态服务与失败状态。浏览器数据为合成，不冒充桌面安装。
- P1随包撤回保护：7项新增场景及既有专项一起25项通过；`catalog-floor/regression.json`。空缓存、旧镜像、遗漏撤回、高序号缓存、损坏记录均不得复活已撤回制品。
- v3材料：22个归档结构/绑定核验，最终15个下载候选。`inventory-v3/FREEZE.json`与各validation文件；`.2`运行版本单点修正可逆核对。
- 下载：`mirror/readback.json`记录15个制品；最终市场包另外匿名回下载并与本地及新目录重建包摘要核对。
- 官方Desktop：`desktop/evidence/installation.json`、`miku-active.txt`、`restored-default.txt`与工具窗口截图。独立DSH_HOME、Electron userData、APPDATA/LOCALAPPDATA；不拷个人会话/账号。官方依赖安装共享现有pnpm store且offline，因此不是全新电脑冷网络依赖下载测试。
- 静态检查、包清单174文件、30个真实Remote描述符、git diff空白检查通过。

## 本轮发现并修复

1. 空随包目录及本机缓存依赖：改为真实目录、公开默认源、固定制品和摘要。
2. Gitee原始文件跳官方内容域：只允许同一owner/repo/ref/path，不放宽到任意HTTPS跳转。
3. 随包seq3撤回未成为基线：统一load/refresh/安装前检查，累计保留冻结发行与撤回历史；Runtime传入真实原始字节。
4. 皮肤ID正则与公约不一致：按加载器正则接受单字符、拒绝大写/下划线/重复分隔。
5. 派生皮肤只有package版本变了：同步唯一SKIN_META版本，不放松UI门禁；`.1`不推荐上架，`.2`实测成功。
6. 固定目录序号：生成器从旧目录递增，保留身份，并用旧历史验证新结果。
7. 普通测试依赖本机D盘/7-Zip绝对路径：改用临时目录、可选环境配置；外部源码专项显式opt-in。
8. 真实首页首屏全是阻断项：发现页只列已有可安装包的功能，完整研究清单仍保留；不伪造精选推荐。

## 准确边界与下一位维护者

- 全量收录不等于全量兼容：47项缺制品、12项阻断、8项缺bundle；15项有下载包但仍保留unverified。官方同名核心不能被旧EAC实现覆盖。
- 已实际检验管理器及Miku安装/换肤；其他皮肤及功能的全部业务、真实AI模型、跨平台、长期压力和真正空依赖缓存网络安装没有统一验收，不能写全部verified。
- 部分皮肤包含CC-BY-NC-SA-4.0素材；原LICENSE/NOTICE和权利链资料保留，不能说所有包MIT或任意商业使用。
- 官方安装可能重载客户端，临时回到会话页面；重新打开EAC→任务看持久结果，不重复点击安装。需要设置的提示目前依据宿主设置能力，个别皮肤的设置实际上可选，后续可细化文案，不影响应用/恢复默认。
- GitHub源仓仍为私人协作仓；普通用户下载公开Gitee tgz，协作者须获源码仓访问权。没有改组织仓、全局DSH源码或替用户开启真实模型调用。
- 目录及生态升级从根README与`docs/contributing/DISTRIBUTION.md`开始。82项清点入口`catalog-source/eac-inventory/CURRENT.json`；公开目录材料在`catalog-source/distribution`。

两名子智能体分别负责清点/派生材料和皮肤UI；后者又独立审查并修复撤回基线。主控负责共享契约、镜像部署、可复现构建和亲自桌面验收。写入冻结后串行构建；两位已释放。

用户给的令牌只存在进程内存，没有进入代码、文件或日志；全部待提交文件扫描无该凭据。Motrix临时增加的下载槽已恢复原值5，未改全局代理或中断其他任务。
收尾复核：再次通过GitHub API读取beta、beta-pack、beta-skins，仍分别为dc22280、44178ab、afa9472，没有在实施期间前进。证据final-remote-baseline.json。公开镜像README匿名200，最终市场tgz及15插件均匿名回下载校验；该仓不要求用户令牌。

日常实例更新：已通过官方安装页将用户实际profile内的市场升级为0.1.0-mvp.4；原deep-whale-day-night、whale-song和ui-skin-loader三项依赖值逐项保持。更新前控制文件备份位于批次user-update-backup（只在仓库外，不上传）。独立测试实例已正常退出，日常实例已恢复。

升级现场补充：日常mvp.2→mvp.4点击立即启用后，确实出现新Client＋旧Host，表现为皮肤计数0/旧目录混排；这是官方保留已加载Host的升级行为。已按应用菜单正常退出再开，需以重启后的目录与页面核验为准。用户及镜像安装说明同步明确完整退出重开。
重启后最终核验通过：日常接受历史同时保留序号2和3，界面为新版功能首页、13款皮肤集中入口；已有两款皮肤及管理器依赖保持。不存在只更新Client未更新Host的收尾状态。
