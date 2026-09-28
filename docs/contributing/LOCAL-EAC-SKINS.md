# 本机 EAC 皮肤管理测试目录

本轮从本地 Git 对象提取上游原版 `1.1.0`：`@dsh-eac/ui-skin-loader` 及13个独立皮肤包。固定源为 `DSH-EAC/dsh-ui-skin-loader@afa947215a862a9c3304f6fff7a812efe5a42fdc`，与组织仓 beta-skins 相同；2026-09-28 已经由 GitHub API 核对独立仓最新 main。

最新整合分支 beta 为 `dc22280beb9d0a6338d1e02d99f5e5346f72f4f0`。管理器原包的 Host/Client、package.json、patch、README、NOTICE 和第三方声明与该分支相应blob一致；没有将旧壳专用 `dsh-skin-switch` 接回官方DSH。管理器调用当前官方服务和槽位，皮肤通过 `uiSkinLoader` 注册，默认外观由控制台明确选择。

## 用户安装顺序

1. 在市场「全部插件」选择 **EAC 皮肤管理器 1.1.0**，查看安装方案并明确勾选未验证试装，再确认。
2. 然后选择一款皮肤安装。皮肤登记后不会自行抢占外观。
3. 打开 DSH 侧栏底部的皮肤入口／皮肤控制台，点击需要的皮肤。要退出外观可在控制台恢复默认。

包均已备到本机，市场安装仍会核验摘要并通过官方安装器执行。皮肤依赖的官方基础包由宿主处理，不声称在所有电脑完全离线可用。原包适配 DSH 0.1.7-rc.2 / Node24；本轮没有替用户安装或启用任何皮肤，实际换肤由用户验收，目录保持 unverified。

## 位置与复现

本机文件在 `D:/eac-market/releases/eac-skins-1.1.0`，其中有原版tgz、SHA256SUMS、目录JSON、精确制品清单和许可副本。总tgz约19MB；与市场代码包分开放置，避免每次修市场UI都重复打包全部皮肤。

比对最新整合分支后，初音未来（miku）和金融终端（trading）的归档代码落后于已完成的修复：前者缺激活失败背景恢复，后者仍含新版已删除的远程脚本取数行为。原文件保留溯源，但本机目录明确暂停这两款的安装，不能仅用“未验证”掩盖已知差异。当前可手动安装的是管理器与其余11款皮肤；这不影响先测试管理器。

```powershell
D:\Python312\python.exe scripts/catalog/extract-eac-skins.py --repo 'D:\DSH-EAC\DSH-Desktop-EAC' --output '<新的绝对输出目录>'
node --experimental-transform-types scripts/catalog/stage-local-catalog.ts '<上述输出目录>' '<明确的目标profile目录>' '<新的备份目录>'
```

提取脚本只读取本地固定Git对象，核对原发行清单，不联网、不执行皮肤代码、不重新编译。导入脚本验证每个tgz的摘要、包名、版本、路径、bundle和package.json原字节，再准备目标profile的内容寻址缓存及原子目录快照；不写profile dependencies/bundles，**准备目录不等于安装**。同名不同字节的输出不允许覆盖。

这是用户指定的本机测试来源，没有公开发布、伪造作者认证或给条目盖运行验证章。皮肤许可证各自独立；例如深海女仆工坊包含 `MIT AND CC-BY-NC-SA-4.0`，原包全部署名和限制均保留，不能统一改成MIT。

修复兼容点：official-bundle元数据读取保留完整 `package.json`，只检查已知官方加载字段；`dsh.skin` 是社区命名空间数据，不能被固定公共Manifest校验器误拒。真正的 dsh-std/Mojobox对象继续按其固定协议严格校验。
