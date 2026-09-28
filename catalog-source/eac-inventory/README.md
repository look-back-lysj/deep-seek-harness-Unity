# EAC inventory 输入

**最新入口已改为 `inventory-v3/catalog-fragment.json`，见 `CURRENT.json`。** 根目录旧 JSON 和下文 v2 数字保留为历史，不应继续上架。v3 包含 82 个包名：55 条插件记录、27 条 listings；增量片段为 43 plugins、43 presentations、27 listings、6 releases、6 releaseStatuses、3 deliveries。主控提供的 6 个 API blob 全部按 Git SHA1 校验并纳入，缺失数为 0。

两个修订皮肤版本为 **`1.1.1-eac.dc22280.2`**，已同步实际 `SKIN_META.version`；逆转这一处唯一字面量后，客户端与最新 beta 原字节完全相等，许可证完全相等。旧 `.1` 因运行登记版本错误不得上架。最终冻结及制品位于 `D:/eac-market-verify/distribution-20260928/inventory-v3`，不覆盖旧证据。真实 Desktop 验收仍由主控执行。

主控优先消费 `catalog-fragment.json`。它包含 37 个新插件版本记录、27 个不可安装 listings、37 份介绍、6 份发行记录、6 份发行状态和3个 cache Delivery。

完整的 76 个包名和各自阻碍见 `inventory.json`；原 14 款皮肤体系不重复加入片段，沿用上一批冻结 ReleaseRecord 和撤回历史。不能使用这里的 `market-index.candidate.json` 覆盖旧目录，那只是独立结构验证输入。

制品与全部原字节证据在 `D:/eac-market-verify/distribution-20260928/inventory-v2`。该目录的 `FREEZE.json` 绑定最终输入和三个新增可试装 tgz。二者派生版本为 `1.1.1-eac.dc22280.1`，高于旧 `1.1.0`；第三个是 `dsh-settings-scroll-fix@2.0.2`。仍无 Desktop 运行验证，不标 verified。

使用说明、许可分类、复现命令和旧版本历史保留规则见 `docs/contributing/EAC-PLUGIN-INVENTORY.md`。本目录只供维护者生成内容，不是新的公共 DSH/Mojobox 协议，也不直接更改已安装插件。
