# 原 AK-47 Redline 合成输入审计

日期：2026-09-09（北京时间）。**已取得并验证原始合成输入；尚未验证与 CS:GO 原作一致的离线合成器，也没有输出成品 Redline。** 本轮仅写研究脚本、证据和私有原资源目录，没有修改游戏或公开资源。

## 证据和复现

输入来自已完成官方匿名 SteamCMD 下载并 validate 的 App740，build **12426148**；depot731 manifest **1224088799001669801**，depot740 manifest **6998097922547485721**。读取前重新检查 ACF 的 StateFlags4 / UpdateResult0。SourceIO 固定 `cfc2591d096628a35f570aa830ab75cc8665108b`，Blender5.2.1 LTS，未安装全局插件。

- [提取脚本](../scripts/extract-source-redline.py)：复用已审计 VPK 目录解析与原生按路径读取；核对目录 CRC、实际字节数、SHA256，不展开整个包。原 VTF 的 mip 全部保留于 raw；PNG 是最高分辨率、单帧 RGBA8，不进行调色、gamma、缩放或合成。
- [输入回执](../.reference-assets/source-exports/ak47-redline-inputs/inputs.json)：10张纹理的完整 SHA256、PNG SHA256、解码像素 SHA256、尺寸、VTF版本/格式/flags/mips、RGBA逐通道范围，以及原VMT文本、paintkit、逐次读取来源。原VMT/VTF位于同目录 raw，PNG位于 png。
- [PNG独立回读脚本](../scripts/validate-redline-inputs.py) 和 [回读回执](../.reference-assets/source-exports/ak47-redline-inputs/png-readback.json)：Python标准库重建PNG过滤行并校验每个chunk CRC，像素SHA与SourceIO原生解码回执逐张比较。该测试验证PNG存储无损，不证明DXT原生解码器与原客户端逐位相同。
- [Valve网页冻结回执](source-redline-official-sources.json)：6个旧版官方片段的URL、下载时间、HTML SHA；[公开SDK搜索回执](source-redline-official-code-search.json)保留搜索范围。

实际提取进程exit0；独立回读 **10/10纹理、20,512,768像素全部一致**。

在项目根目录执行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/extract-source-redline.py > output/source-redline-inputs.log 2>&1
python3 scripts/validate-redline-inputs.py
```

提取脚本开始即把旧成功状态替换为 running，只有完整提取成功才落 `inputs_extracted_no_composite`；后续若中断，不得沿用旧 PNG 回执，需核对其 `inputReceiptSha256`。

## paintkit282 的原定义

原 `scripts/items/items_game.txt` SHA256 为 `510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623`。读取合并全部38个paint_kits块，未遗漏后续同名段；本次无冲突记录。

| 字段 | 原始值 |
|---|---|
| id / name / style | 282 / `cu_ak47_cobra` / 7 |
| pattern | `workshop/elegantredv1.1` |
| pattern_scale / ignore_weapon_size_scale | 1 / 1 |
| X/Y offset范围、rotation范围 | 全部0 |
| phongexponent / phongintensity | 150 / 10 |
| wear_remap_min / max | 0.1 / 0.7 |
| only_first_material | 0 |

原默认paintkit0也完整留档，但没有把“未出现的字段一定如何继承”当成已经验证的执行语义。AK定制VMT的 `$WEARPROGRESS .2` 是模板预览参数，不能把它当成每一把 Redline 的实际磨损值。

官方旧 [Custom Paint](https://www.counter-strike.net/workshop/wf_custompaint) 页面明确将style7对应到全彩pattern、原武器UV、磨损至底材和可选alpha耐磨/遮罩。它与这份原schema和包内Bullet Rain示例相互印证。[Pattern Application](https://www.counter-strike.net/workshop/wf_patternapplication)区分原UV与三平面投射；Redline属于前者。

`ignore_weapon_size_scale=1` 禁用按武器尺寸自动调整，配合scale1/offset0/rotation0，可支持对齐原模型UV的确定输入路径；它不能单独推出完整磨损合成公式。[Valve Pattern Scale](https://www.counter-strike.net/workshop/wf_patternscale)

## 原纹理清单

表中SHA为前12位便于查找；完整64位及精确源路径均在输入回执。所有PNG保留4通道，不能因为文件名含AO或surface就转灰度或当PBR通道。

| 路径尾部 | 尺寸 | 原格式ID | SHA256前缀 | 用途与证据界限 |
|---|---:|---:|---|---|
| paints/custom/workshop/elegantredv1.1.vtf | 2048² | 13 DXT1 | `d5bdec1a9ff12` | 原pattern RGB；alpha全部255 |
| rif_ak47/rif_ak47_ao.vtf | 1024² | 15 DXT5 | `8d1660ed413a` | `$aotexture`输入；RGBA具体打包规则未取得 |
| rif_ak47/rif_ak47_masks.vtf | 512² | 13 DXT1 | `bb5048f3ce3d` | `$maskstexture`输入；R/G/B分类与权重未取得 |
| rif_ak47/rif_ak47_pos.vtf | 1024² | 12 BGRA8888 | `36a606bc6866` | `$postexture`输入；位置归一化、alpha含义未取得 |
| rif_ak47/rif_ak47_surface.vtf | 256² | 13 DXT1 | `55e459da1aff` | `$surfacetexture`输入；每通道底材属性映射未取得 |
| shared/gun_grunge.vtf | 1024² | 15 DXT5 | `a8a920eec57f` | `paint.vmt`共有脏污输入；A有全部256个值 |
| shared/paint_wear.vtf | 2048² | 13 DXT1 | `8c9928abaafb` | `paint.vmt`共有磨损输入；RGB权重/阈值未取得 |
| uvs/weapon_ak47.vtf | 2048² | 13 DXT1 | `8a8c25112888` | **黑绿UV线框参考图**；已实际查看，不是编码UV的lookup |
| v_models/rif_ak47/ak47.vtf | 2048² | 15 DXT5 | `ea18a4dbd405` | 原默认底色；A在原默认VMT用作Phong mask |
| v_models/rif_ak47/ak47_exponent.vtf | 512² | 13 DXT1 | `b1159d1d8fa4` | 原默认高光控制，同时被定制VMT用作`$exptexture` |

`pos`的A仅16–32，不宜按透明度解释；`ao`的RGB各不相同且A有174个取值，因此“直接乘AO.R”“把A当透明度”等均无本轮证据。统计本身只用于发现误用，不能反推出各通道物理含义。

pattern的alpha255确实意味着不额外改变默认耐磨行为。Valve旧指南说明128和255保持默认行为，低于128增强耐磨，约196可减去可涂装区域；这里不把该说明擅自扩展为线性插值或精确阈值函数。[Valve Durability and Masking](https://www.counter-strike.net/workshop/wf_durabilityb)

原默认`$phongexponenttexture`在已固定公开SDK的相关分支中有R指数/G albedo tint控制语义，可继续作为默认AK着色参考。**它不等同于已经掌握 `$exptexture` 参与 CustomWeapon 离线烘焙的公式。** 旧Valve文档中pattern alpha承载Phong指数的规则特指Anodized Multicolored和Gunsmith的patina部分，不能套在style7 Redline上。[Valve Phong](https://www.counter-strike.net/workshop/wf_phong)

## VMT 链的关键边界

`customization/rif_ak47/rif_ak47.vmt`（SHA `99d7299e0f90586af117536b8c50cb036870c91cf48740f50687791b74ef7273`）指向上述surface/masks/ao/pos/exp；wear、grunge变换均为scale2.1、translate0、rotate0；预览albedo tint/envmap开关均1。

该文件include `paints/master.vmt`，后者包含多种paintstyle开发测试示例，当前未注释include是 **`solid/solid1.vmt`，但此文件在本次包与loose路径均不存在**。脚本明确记录 `missingTemplateIncludes`。不能用该模板链当成Redline实际运行时合成配置，也不应补造solid1来使它“通过”。

另外独立读取的 `paints/paint.vmt` 声明shader **CustomWeapon** 和共有grunge/wear纹理。实际包中 `custom/bullet_rain_m4.vmt` 则提供style7配置实例，确认painttexture、paintstyle、pattern变换等参数名称。它不是Redline的成品材质。

## 是否能精确离线合成

**目前不能声称已验证。** 可取得原输入并明确style7基础规则，但仍缺四项执行证据：packed masks/surface/ao/pos每通道语义；底材恢复与磨损阈值/混合顺序；seed到wear/grunge随机变换的算法；烘焙输出base/Phong通道的颜色空间、尺寸、过滤和量化约定。

官方文档还明确，即使磨损量相同，脏污和划痕纹理也会随机放置。Redline的pattern offset/rotation固定，不代表不同seed生成的最终磨损图相同。[Valve Randomization](https://www.counter-strike.net/workshop/wf_randomization)

本轮检查固定 [Valve source-sdk-2013](https://github.com/ValveSoftware/source-sdk-2013/tree/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474)完整未截断树（7780路径），未发现名含CustomWeapon/weaponpaint/weapon_paint的实现路径；App740的pak01也未发现匹配的`.vcs/.fxc/.hlsl`，本机游戏目录未找到对应可读shader源码。这是**所检范围内未取得**，不能据此声称Valve从未公开过任何相关实现。公开Source2013的VertexLitGeneric/Phong不是CS:GO专有CustomWeapon合成器。

当前总览网页已有CS2粗糙度/PBR/Item Editor内容，所以本报告优先引用保留原CS:GO字段的旧片段。不能用CS2材质规则替代这个Source1 build。

## 下一步可执行验证路径

1. 固定本次source模型、UV和全部输入；按paintkit282读取scale1、offset0、rotation0，检查UV上下翻转与原源网格导出约定。此步骤可做pattern定位诊断，但产物必须继续叫“输入预览”。
2. 取得同版本官方原客户端或原工作台作为输出基准，固定paintkit、seed、wear，保存原生成底色和高光控制纹理及参数；本轮未安装/运行该客户端，未验证能直接导出其合成纹理，也没有代填所谓导出命令。
3. 优先取得公开且来源可确认的CustomWeapon执行语义；否则只能逐项开展有标识的行为重建。每个假设用原工作台同seed/wear对照验证，先测未涂区域、底材、边缘磨损，再测随机纹理与Phong输出，避免用最终照明掩盖合成误差。
4. 验证矩阵建议：wear0.1/0.2/0.7 × seed0/1/固定大整数，重复同参数必须逐字节一致；不同seed不预设相同。检查机匣/弹匣/木件/枪管内侧四类区域，输出通道误差、未涂区域差异、UV边界差异，最后才在同视角光照下比较成枪。
5. 只有合成结果及材质通道通过独立回读和原客户端比较后，才把Redline加入“已装备”列表。当前原AK保持真实default，原始pattern不作为完成品提交。

以上是后续实验方案，不代表已经完成原客户端校准、seed复刻或成品Redline验收。
