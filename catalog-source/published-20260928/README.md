# 作者发行恢复材料

本目录是本次已取得的真实发布信息，不是继续沿用“本地没有文件所以不能安装”的登记清单。

`registry-original-versions.json`记录原登记版本查询；`registry-discoveries.json`为选定稳定版原始公开元数据；`author-inspection.json`绑定实际tgz摘要、文件表、许可、入口及依赖；`author-source-refs.json`是gitHead或匹配版本标签证据；`author-mirror-uploads.json`是Gitee上传回执；`anonymous-mirror-status.json`区分上传和匿名可用；`runtime-review.json`记录已有代码证据的硬阻断；`recovered-records.json`记录最终24项投影。

原始tgz不提交源码仓，在Gitee镜像及作者npm发布地址取得。取得原版不等于测试全部功能；14项新增安装入口仍是unverified，其余10项已找到包但需适配。

复现需先通过用户指定下载方式取得registry元数据对应的确切归档，并准备固定源码、镜像核验回执，再运行两个Python工具。不要伪造回执，不运行作者README命令，不修改归档内容。
