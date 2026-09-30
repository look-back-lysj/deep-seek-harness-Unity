# 我的插件滚动修复与本机皮肤目录

用户请求：修复“我的插件”无法下滑、官方已有插件不能折叠；从最新EAC提炼皮肤管理系统到市场目录，用户自行安装测试。

## 已实施

- 市场升级到 `0.1.0-mvp.2`，已经通过官方DSH添加插件页更新并正常退出／重启加载。安装包在 `D:/eac-market/releases/0.1.0-mvp.2/dsh-eac-market-0.1.0-mvp.2.tgz`，SHA256 `c1f5251969387ba152bb0ce140c86a3e74eef664a1a0689c2a03a75775c9e38d`。
- 根因是市场根容器仅有 min-height、内部滚动区的百分比高度未被限制，超出官方 centerCol 后遭 overflow:hidden 裁切。现在使用明确height、flex收缩和min-height:0，内容在面板内滚动，不改变官方壳样式。
- 官方安装树来源 `source:installation`、受保护组件及不可直接寻址内部行进入“官方与系统组件”；默认收起、可展开／再收起。异常和重启数量保留在折叠摘要，不再把全部异常卡放在不可折叠区域。包名前缀不作为来源证明。
- `official-bundle` 目录元数据保留原始package.json；对官方已知加载字段校验，允许包内社区 `dsh.skin` 声明，不将它强行套入固定公共Manifest。公共dsh-std/Mojobox校验仍保持原规则。
- 本机原包清单与缓存准备完成：管理器1.1.0＋13皮肤，原字节总计19,941,278字节，逐个对上游SHA256SUMS校验。没有安装或启用皮肤。归档miku和trading落后于最新beta的实际修复，原字节保留，但目录明确暂停它们；可安装条目为管理器＋其余11款。

## 来源

本轮GitHub核对的独立作者仓main与本地beta-skins均为 `afa947215a862a9c3304f6fff7a812efe5a42fdc`；最新整合beta为 `dc22280beb9d0a6338d1e02d99f5e5346f72f4f0`。管理器可执行文件、包声明、patch及说明与最新beta一致，许可证仅换行形式不同。没有使用旧dsh-skin-switch或历史Tauri skin-manager。

管理器原包SHA256 `b926aad7d312c9573226414867049a48b6825e2bb15d8ba76a3d707095ef1ba6`，22,667字节；无需重新编译。皮肤各自的MIT/BSD/CC-BY-NC-SA及署名均原样保留。该目录为用户指定的本机试用，不是在线发布，不伪造运行Evidence。

原始目录／制品／许可在 `D:/eac-market/releases/eac-skins-1.1.0`，导入流程见 [本机皮肤说明](../contributing/LOCAL-EAC-SKINS.md)。加载后的目录revision为 `local-eac-skins-1.1.0-reviewed-afa947215a86`，14条、12可安装、2暂停。

## 验证

- 全局构建、lint、164文件包结构及30个Remote结果schema通过。
- 全套326项通过，结果在 `D:/eac-market-verify/skin-market-20260928/regression-tests.json`。
- 独立浏览器按官方面板的固定高度／裁切布局测试1280和480宽度，滚轮滚动、End键到底、默认折叠、展开28项、再收起及异常摘要均通过；不是把普通不限高网页测试冒充宿主布局。
- 主控在更新前通过原生电脑操作复现日常DSH列表滚轮不动；更新后实际看到新市场和14条目录，页面滚动条可见，管理器入口正常。用户随后开始操作并最小化窗口，未继续抢占操作；完整的真实展开／收起和皮肤安装效果留给用户验证，不把浏览器结果写成已完成所有真实桌面操作。
- 安装前备份位于 `D:/eac-market-verify/skin-market-20260928/profile-before-market-update`；本机目录准备备份为 `user-catalog-before`。没有改动用户会话或密钥。

本轮业务改动集中在Client滚动／分组及官方元数据兼容；新增两个本地目录准备脚本，不新增在线源，不改变组织仓，不自动安装皮肤。本分支累积改动仍未提交或推送，不能把本机安装成功写成仓库已发布。
