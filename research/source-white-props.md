# Dust2 白化物体身份与 R3 原贴花恢复

本轮按真实 CT/T 截图机位，将屏幕像素射线与未修改的原 `props.glb` 三角形求交。结果在 `research/source-white-props.json`，脚本为 `scripts/identify-source-white-props.ts`。没有按最近点猜材质；射线只查 prop 几何，未把纹理 alpha 或世界遮挡误称为已验证。

| 截图目标 | 实例与原材质末段 | 当前差异原因 / 处理 |
|---|---|---|
| T 大箱下层 | `static_prop_2554` / `dust_shipping_crate_02_wood_decals` | 原 base+bump+decal mode1；R2 因未支持 decal 保留 PBR。R3 已接原 VHV、原贴花、原 UV2。 |
| T 大箱上层 | `static_prop_1220` / `dust_shipping_crate_02_painted_decals` | 还含 tintmask，继续保留；不能把下层通过描述成整组箱子都已修复。 |
| CT 左侧覆盖物 | `static_prop_2785` / `dust_kasbah_tarp_04` | base+bump+tintmask，待 tint 原参数消费链。 |
| CT 左侧箱体 | `static_prop_2784` / `dust_shipping_crate_02_painted_color` | base+bump+tintmask，待独立分支。 |
| T 右白窗框 | `static_prop_2372` / `dust_window_frame_wood_01` | base+bump+tintmask；前方镂空铁栏的 alpha 几何不能误认为窗框材质。 |
| T 白线缆 | `static_prop_1982` / `dust_wires_01` | 精确像素 `(800,186)` 命中；原 tintmask 分支待解。其他偏离细线的射线只命中背景或无命中，未用于结论。 |
| CT 吊灯 | `static_prop_2650` / `dust_hanging_light_02_on` | 原 selfillum、selfillumtint `[4 4 3]`、tintmask/envmap 等复合分支；不能将灯统一当作应变黑的普通 diffuse。 |

完整路径以 JSON 中 `material` 与 `sourceMaterial.parameters` 为准。上表均为 `models/props/de_dust/hr_dust/…` 原材质，不补假贴图或手调色。CT 同屏线缆尚未独立命中，不把 T 线缆身份推广到它。

## R3 只开启有证据的乘法贴花

`game/source-prop-decal.ts` / `source-prop-decal-uv.ts` / `source-prop-decal-loader.ts` 为独立候选模块。`loadSourcePropLighting` 新参数 `enableDecalMultiply:true` 默认关闭，调用时仍保留 `enablePlainUnbumped:true`。其余 tint/envmap/phong/detail/selfillum 等分支继续保留原材质。

当前已安装官方库与 VCS 的逐字节断言由 `scripts/inspect-source-prop-decal.py` 复现，证据为 `.reference-assets/source-exports/dust2-vhv/encoding/decal-tint/decal-evidence.json`：

- 原 bump PS mode1 静态别名 `196612 -> 199428`、dynamic80 程序 SHA256 `ecea342bc032a7da74893d53cbc8457da2e850f0a2b9c45d76cb9aab568ae24c`。其 sampler12 读取 `v0.zw`，乘 RGB 与 `c3.w`，不取 decal alpha。CPU 令原 mode1/2 共用此 shader，`c3.w` 分别为 1 / 2。
- 原 VS `v6 TEXCOORD1 -> o1.zw`，所以这里必须用第二套 UV，不能沿用 base UV。
- 当前 Linux 的 shadow `EnableSRGBRead` 是空函数。实际命令按 `$DETAILBLENDMODE` 默认 0 为 sampler12 置 bit31；command10 通过原 vtable 的绑定函数将它写到 sampler state11。state11 为 `D3DSAMP_SRGBTEXTURE`，其用途由 [Microsoft 原文](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dsamplerstatetype)确认。候选使用原 PNG 字节与 WebGL sRGB 读取，没有按空 shadow 开关关掉颜色解码。

本轮明确纠正了最初“沿用 base UV / mode1 一定线性采样”的错误候选；它从未启用生产。最终 GPU 构建含真实 UV2 与实际动态 sRGB 消费语义。只恢复这条已证 diffuse×decal 乘法项，不宣称完整 Source 渲染器、动态光或同曝光最终画面。

## 原 UV2 缺失的实际原因与严格映射

原 VVD 末尾 extra header 的 `totalBytes` 包含其 8 字节 header；固定 SourceIO 在读取 header 后，用 `totalBytes <= remaining` 检查，因差 8 字节跳过合法 type1 float2 数据。因此现有 GLB 缺少 TEXCOORD_1。原 SourceIO、原 OBJ/GLB 与场景几何均未修改。

`scripts/extract-source-prop-decal-uv.py` 直接读取原 VVD：以 POSITION+UV0 的**定向三角形**精确匹配，每个重复候选必须有完全一致 UV2；一个旧 GLTF 顶点被多个面引用时也必须只需要同一 UV2。不把之前“VHV 字节相同”当作 UV2 相同。

26 个候选 primitive 中 25 个通过，共核对 171,801 个有效三角角点；`original-decal-uv.f32` 为 630,624 字节，SHA256 `af2c664b28b03cbd4ead6e25293bd66373c7542b043484fe63d5edd7877ef3e4`。`autocombine_dust_crate_style_02_478` 的原 VVD 部分被引用 UV2 非有限，该 primitive 保留原材质，并未填补、近邻匹配或平均坐标。

运行时使用一个有界 RG32F lookup：`gl_VertexID + primitiveOffset` 精确读取原 UV2，不复制/插入 geometry attribute。3 张原贴花原像素逐字节 PNG 解码回读通过；纹理含 mip 预算 32MiB，UV lookup 独立 4MiB 上限，本数据实际 640KiB。所有文件和每条 UV 映射均检查 SHA；HTTP LAN 无 WebCrypto 仍经共享 SHA fallback 验证。所有 fetch 请求 `cache:'no-cache'` 条件重验证。退出释放自己创建的纹理与 ImageBitmap，先还原 VHV 材质，不销毁借用的原资产。

## 数值与实际 GPU 证据

真实 GLTFLoader 整图回读得到 R3 总计 **2008 mesh / 2,823,484 triangles / 111 原材质**，比 R2 增加 **40 mesh / 84,509 triangles / 6 材质**；785 个唯一几何 SHA 回读、63,941,808 几何字节验证。原几何、节点 TRS、索引、UV0 的对象引用不变。26 项专项测试与 `tsc --noEmit` 通过，错误 base-UV 实现先红后绿；这与 GPU 证据分开记录。

`output/playwright/source-vhv-r3-gpu.json` 来自独立 headless session `csgo-vhv-r3`，会话现已关闭。四张 1440×900 同机位截图均已亲自读取：

- `source-vhv-r3-t-r2.png` / `source-vhv-r3-t-r3.png`：下层大箱恢复原深色木纹、喷字与标签；上层白箱、白窗框、线缆保持未支持状态。
- `source-vhv-r3-ct-r2.png` / `source-vhv-r3-ct-r3.png`：远处木箱恢复较暗烘焙项，前方 tint 箱与复合灯仍待解。
- CT 每帧 319 calls / 657,631 triangles；T 每帧 975 calls / 1,795,402 triangles。两模式一致，无几何/机位替换。
- `errors:[]`。退出后 geometry1 / texture2 / program1，与空基线完全一致。

父任务也已亲自审阅 T 对照并接受本受限分支。尚无原游戏同机位曝光对照，不能据本次验收称最终原作外观已完成。

独立资源已 stage 至 `public/source/csgo-12426148/dust2/vhv/decal/`；`stage-receipt.json` 列所有文件完整 SHA。stage receipt SHA256 `8a401acda550ee8ef5fa18cb26fec3d619e1250a2289e7673ab9e70426d20c3f`，GPU receipt SHA256 `fa6ba863e55ca65fd4806dba86ff3b51ef995232c0069261e530cedcd1908b12`。生产开关由父任务接入，本模块没有修改主 `assets/scene/runtime`。
