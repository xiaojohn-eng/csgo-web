# 原 Dust2 叶片与云层：第一轮归因和最小分支

本轮只读 App 740 build `12426148` 原始资产、当前渲染源码和已有生产截图；新增私有清单与取证脚本，没有修改 `game`、`public`、主 HTML、原 GLB、贴图、几何、颜色或姿态，也没有开浏览器。结论不是原游戏同机曝光对照，也不代表完整原作植被效果。

## 已确认的问题边界

根代理指定的生产截图 `output/playwright/source-r4-ak-native-audio-inspect.png` 已亲自查看：天空有淡蓝底色，近棕榈有灰黄/米白叶面，后方有近黑叶片。R4/R5 私有 VHV 对照图的深灰背景不是该生产天空；私有 `loadIntegratedDust2()` 未传 `sky:true` 且只画一个 scene，故不能拿其平黑背景证明 production sky 错误。

最新 `game/scene.ts` 已为原天空 scene 增加主太阳的副本与半球光；这与旧截图的创建时刻必须分开。当前 owner 本身仅为两张确认为 Unlit 的天空材质创建 MeshBasic，其他天空 prop 借用调用方材质。缺 VHV 的叶片仍是 PBR。旧图中的黑叶与天空 pass 的不同光照状态相符，但**没有该截图的灯光快照，不能把当前代码直接当作旧图唯一根因证明**。通用灯也不能替代每个原 prop 的烘焙 VHV。

## 实例、材质和 alpha 证据

`scripts/audit-source-foliage.py` 只随机读取原 `props.glb` 的 JSON/所需 buffer views，逐实例沿完整 GLB 祖先 TRS 变换；15 个 foliage 材质的 mesh/三角数全部与原材质清单相等。每张 PNG 直接按嵌入字节复制到 `.reference-assets/source-exports/dust2-foliage-audit/`，不重新编码或处理颜色。

| 原材质（共同前缀 `models/props/de_dust/hr_dust/foliage/`） | 实例 mesh / 三角形 | 天空实例 | 原参数与当前差距 |
| --- | ---: | ---: | --- |
| `palm_frond_01` | 37 / 100,258 | 0 | alpha test .3、nocull 1、treesway 1；无 bump。风摆参数使其被严格 VHV 分支排除，仍为 PBR。 |
| `sumac_01` | 33 / 69,860 | 0 | 与棕榈相同的 alpha/风摆参数集合；仍为 PBR。 |
| `olive_branch_01` | 64 / 10,016 | 48 | alpha test .3、nocull 1、treesway 1，另有 `vertexcolorpower=.7`；该幂的本构建消费链尚未验证。 |
| `olive_bark_01` | 12 / 6,809 | 0 | 有独立风摆配置；不随叶片候选自动放开。 |

前三者真实 GLB 都是 `alphaMode=MASK`、`alphaCutoff=.3`、`doubleSided=true`、metallic 0、roughness 约 .9；原 alpha/nocull 未丢失。导出脚本 `finalize_glb` 已把 Blender DITHERED 的 BLEND 修成原 MASK。它们不是应该通过打开透明混合才能恢复的材质，也不应改变 .3 阈值、背面色或填补透明区。

原 VMT SHA256：

- palm：`e1ef4d3a4e2461232943da577cec81838cf799d15b11bd9b2ff9ec89e28ecd4d`
- sumac：`c1ed5b2112fc5fc0c835bec21abe84bf8dd02e5452c822c26dda6b9c43dbbf42`
- olive branch：`14f38cc79d5d1b7cc7680c0c526d10a7bc7780c9afa131e62a1f58f4b6032662`

纹理实查也否定了“原叶片底图应统一浓绿”的假设。palm 原嵌入底图有灰绿叶面和米白背面；通过 .3 alpha 阈值的 encoded RGB 中位数 `[128,124,83]`，90% 分位 `[176,173,144]`。olive 的相应中位数 `[112,120,107]`，90% 分位 `[168,175,163]`，有原本浅灰的叶背。这些是 sRGB 编码字节统计，不能当线性亮度、截图曝光、补色系数。PNG 的原透明像素和部分 alpha 像素完整保留；未证明 GPU mip/过滤边缘与原游戏相同。

根据原生产 receipt 里的 `sourceSky.position` 和 `visibilityOrigin`，可还原主相机位置 `[-20.888071,4.604088560391119,20.2093068]`。采用该静止角色早一份 snapshot 朝向和实际 runtime 默认 FOV 78（私有预览是 75，不能混用），原三角 CPU 射线得到：

- 像素 `[78,288]`、`[137,306]` 命中近棕榈 `static_prop_2368`，原模型 `models/props/de_dust/hr_dust/foliage/palm_tree_03.mdl`，原 origin `[-2202,-213,82]`，材质 `palm_frond_01`。
- 三个近黑像素 `[243,204]`、`[218,219]`、`[166,240]` 都命中天空 `static_prop_65`，原模型 `models/props/autocombine/de_dust2/_autocombine_olive_branch_01_17.mdl`，材质 `olive_branch_01`；这三个命中处原 LOD0 双线性 alpha 都通过 .3 阈值，不能解释成应该被 alpha discard 的透明空白。

这是有明确边界的候选身份追溯：原 receipt 未记录 inspect 相机投影矩阵，方向取早一份静止 snapshot；只查询 palm/olive 三角，不执行所有墙面遮挡和 GPU mip/anisotropy。保留了未命中或 LOD0 alpha 未通过的采样，没有把它们强行归类。下一轮 GPU object-ID 或单实例隐藏对照能闭合像素身份。

## 最小且有证据的下一分支

优先只考虑 palm + sumac 两个**精确原材质与参数集合**，最多新增 70 mesh / 170,118 三角。候选为独立默认 false 的静态烘焙光照选项，保持原 alpha、双面、纹理、UV、几何、source vertex remap 和 R5 行为。先从本构建原 TREESWAY VS selector/program 确認其静态颜色读取仍与已验 no-bump COLOR1 路径一致，再允许这两个材质使用原 VHV；风摆保留为明确未实现状态，不通过修改静态几何假装完成动画。

固定官方 SDK `vertexlitgeneric_dx9_helper.cpp:416` 读取 treesway 并选择 `TREESWAY` 顶点 shader combo（806/877）。它说明了应查哪条原顶点分支，但不能单独证明当前 CSGO 程序的颜色语义。因此本轮**没有**将全部 `$treesway*` 加入通用白名单。

olive 的 48 个天空实例对画面影响明显，但额外 `vertexcolorpower=.7` 需要先查本构建 VS/PS 参数消费顺序。不要把 .7 擅自解释成 `pow(baseColor,.7)`、`pow(VHV,.7)` 或曝光调整；也不要复用一份 per-model 光照覆盖不同天空实例。其精确映射已在现有 VHV/remap 中，编码确认后才接原静态颜色。最新天空灯光是已有 fallback，不是本轮新增的修复。

GPU验收应使用现有 `loadSourceDust2({sky:true,...})` 和 `sourceSky` owner，按天空→清深度→主世界的生产路径；同机位比较叶片 alpha silhouette、正反面、主/天空材质和独立释放。不改几何数量，不通过手工压暗、染绿、加强透明度来追图。

## 云层的实际原程序：不能沿用通用 SDK 的 alpha 结论

原 `nuke_clouds_002` VMT 是 `UnlitTwoTexture`，底图 `nuke_clouds_003`，第二张 `nuke_clouds_001`，`$alpha=.35`、`$translucent=1`、`$nofog=1`。原 TextureScroll 两组分别为：

- 第一纹理 transform：rate `.00209`、angle `80`、scale `3.5`。
- 第二纹理 transform：rate `0`、angle `0`、scale `1`。

当前 owner 只有原第一张底图和 .35 opacity，没有第二图或两路 transform。公开固定 SDK 的 `texturescrollmaterialproxy.cpp` 给出 `offset=frac(time*rate*[cos(angle),sin(angle)])`，matrix 对角使用 textureScale；但这不是已经对本 CSGO proxy 的原生验证。

新 `scripts/inspect-source-cloud-alpha.py` 从已安装官方 `platform_pak01` 读取 `shaders/fxc/unlittwotexture_ps20b.vcs`，5000 B，SHA256 `e8a72b447e1ab7be7a5bba2b625c31b79e3ef2803d0789224e14643accf86df9`，明确是 `ps_2_b`。解析真实 VCS 压缩、程序尾与原 token，验证：

| 原 static / dynamic | 字节 | 原最终 alpha |
| --- | ---: | --- |
| 0 / 0 | 752 | words 181/184 从本地 def `c0.x=1` 输出常量 1 |
| 1 / 0 | 716 | words 142/146 两个 sampler、150/154 逐通道乘法、175 输出：`texture0.a * texture1.a * external c1.a` |

因此这个安装包**同时**有 opaque 与原采样 alpha 两条程序。公开 SDK 的 `float alpha=1` 不能被宣称为本 Dust2 的最终公式；也不能看见 VMT .35 就猜应选 static 1。下一步应闭合 `UnlitTwoTexture` 的原材质 static selector、`c1` 上传以及 blend/depth 状态，再准备默认 false 的双纹理候选。两程序完整原 bytes/token/哈希保存到私有 `dust2-foliage-audit/cloud-alpha/`。本轮没有执行原 GPU、原引擎或伪造运行时 oracle。

## 可重跑证据

```sh
/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/audit-source-foliage.py
python3 scripts/inspect-source-cloud-alpha.py
```

第一项使用现有 bundled numpy/Pillow，没有安装依赖；输出 `research/source-foliage-diagnosis.json`，包含原材质、15 张原嵌入 PNG 哈希、真实实例/三角数、7 个保留失败结果的射线样本和当前相关源码快照 SHA。第二项验证两份原程序的精确 alpha token，并输出私有证据。两项已实际执行通过。未改任何共同源，未声称本轮已完成 GPU 视觉修复。
