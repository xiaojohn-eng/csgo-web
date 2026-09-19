# 资源准备

公开仓库不包含本机 `public/`、`.reference-assets/`、`release/` 或 `output/`。源代码公开不代表原游戏素材获准再分发。

在有相应使用权的前提下，开发者可将自行准备的兼容资源放入本机 `public/`；R4 加载器使用 `public/source/csgo-12426148/` 下的 manifest 与配套文件。版本、目录和校验值必须匹配，不能用任意模型替换后宣称兼容。

转换工具在 `scripts/`，历史工具链记录见 `research/source1-to-glb-toolchain.md` 和 `research/source1-map-pipeline.md`。这些是开发工具与研究笔记，不是经验证的一键资源安装器；部分工具需要本地 Blender、SourceIO、Steam 安装或二进制分析环境。研究数据中的反汇编数组、原始 shader tokens、完整物品目录和复制网页未公开。

不要将未获再分发授权的模型、皮肤图、纹理、字体、音效、安装包或转换后的同类文件提交到公共仓库。
