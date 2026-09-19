# App740 原静态道具 tintmask：有界取证

已闭合所选普通绘制路径中的原实例颜色交接，并交付默认关闭的 R4 候选：4 个原材质、249 个 mesh 实例、867,781 个三角，在独立 headless GPU 的 CT/T 同机位 R3/R4 比较中通过。原白窗框和线束恢复烘焙暗部；T 上箱复合材质与吊灯仍不覆盖。R3 原数据和私有 bundle 保持冻结，production 是否开启由根任务另行集成；这里没有原客户端同机位曝光对照。

复验：`.tools/source-binary-venv/bin/python scripts/inspect-source-prop-tint.py`。结果保存在 `.reference-assets/source-exports/dust2-vhv/encoding/tint/tint-evidence.json`，SHA256 为 `c536b9b83dabd0b29f99ed5a6a9fb4dc7a0421df31f77485e36f68294a7dcbae`。六个原客户端 ELF 的完整 SHA 在 receipt 内；SourceIO、原 BSP/VVD/VTF/GLB 都未修改。使用已安装的 Unicorn，仅执行列明的原始指令范围，每次都断言 RIP 到达预期终点；不启动 Source 引擎、不运行其中的系统调用。

## 已确认的 shader 链

当前客户端 `vertexlit_and_unlit_generic_bump_ps30` 的 requested static `983044` 经原 VCS alias 解析为 `994052`，dynamic `80`。1208 字节 shader 的 SHA256 为 `4a68efdb860eb4f1b083547ef68beea967f85bedb95b260ad1f8fa32f5d51620`。

word 255 在原 UV0 采样 s13；word 259 的源 swizzle 明确为绿色通道，目标带 saturate；word 263/267 形成以下乘项：

```text
mask = saturate(sampleSRGB(originalTintMask, originalUV0).g + c12.x)
diffuseRGB = originalBaseRGB * bakedDiffuse * (1 + mask * (c1.rgb - 1))
```

这条已选分支不读取 tintmask alpha。`stdshader_dx9_client.so:0xcaa2a` 写原 bind command 参数 `0x8000000d`，即 s13 加 sRGB 请求；消费链复用已核实的 R3 command10 → shaderapi → D3D sampler state11。不能据贴图名字把 tintmask 设为 NoColorSpace，也不能把遮罩改为 alpha。

`$BLENDTINTBYBASEALPHA` 和 `$NOTINT` 的参数注册分别经过原全局索引 `0x3741c8/0x374188`，进入 generic info `+0x174/+0x178`。`info+0x1f8` 是否为实际纹理产生 hasTint 标记。原代码 `0xc6e5c…0xc6ec1` 经 8 个布尔组合实执行验证：

```text
c12.x = NOTINT ? -1 : 1 - float(hasTintTexture || BLENDTINTBYBASEALPHA)
```

因此普通存在 tintmask 的材质偏移为 0，不能采用无纹理时的默认偏移 1。设置 NOTINT 时偏移为 -1，与 `saturate` 配合禁用 tint。

## 实例颜色转换：已审消费者和原始字节

这里存在两个不同的命令解释器。实例颜色使用 `shaderapi:0x49e18`、跳转表 `0xdef70`，不能误用 R3 bind command 的另一张表。原 instance command13 在 `0x4a520` 进入，读取 `MeshInstance+0x68` 的 RGBA 和命令内 material RGB，写 PS 常量寄存器（generic 调用传入 1）。

仅执行 `0x4a532…0x4a5b0` 后，524 组原 SIMD 结果与逐步 float32 回读完全一致；包括所有 256 个 byte 值、负值、接近 0/1、HDR 大于 1 和非白 material factor。该分支执行：

```text
x = max(float32(instanceRGB * materialRGB), 0)
outRGB = x >= 1 ? x : ((a*x+b)*x+c)*x+d
outAlpha = instanceAlpha
a = float32(.1731)
b = float32(.8717)
c = float32(-.0452)
d = float32(.0012)
```

每个乘法和加法分别舍入至 float32。不能把它改为精确 `pow(x,2.2)` 或浏览器 sRGB EOTF，然后声称与原命令逐值一致。此处 alpha 指实例颜色 alpha，与 VHV 每路第四字节的用途无关，不推广到其他 shader。

原 `engine_client.so:0x502ffa…0x503070` 另经 256 组 RGBA 实执行，确认从 sprp 记录 byte offset `64/65/66/67` 读取通道，乘原 `float32(1/255)`，存入 `CStaticProp+0x110…0x11c`。原 `CStaticProp` RTTI、vtable `0xd69640+0x148` 和 `0x501320` getter 确认 RGB 为原样复制；无 gamma 转换插在初始化或这个 getter 内。

本轮已闭合以下**普通绘制 mode 0** 路径；报告不推广到特殊 mode 1、调试全亮或所有引擎配置：

- `CModelRenderSystem::DrawModels` 的 client `0x983744 → 0x980ce0`，`0x980d32…0x980d40` 从 renderable 调 virtual `+0x58`。其 CStaticProp secondary vtable getter `0x501340` 先减 this 8，再跳原 `0x501320`，RGB 复制到 render-list 实例 `+0x64`；淡出 alpha 在独立的 `0x980d40…` 路径从 byte `+0x88` 读取，不能拿 sprp alpha 直接代替。
- client `0x98376f → 0x982bd0` 的 mode 0 分支构造 32 字节 draw group，保持原 168 字节 instance 指针，`0x982ed7` 调 `VStudioRender026 +0x190 → CStudioRenderContext::0x1d8f0`。非排队路径 `0x1ddd4 → 0x10080 → 0xd760` 保留 instance 指针；`0xb7e0` 的 `0xb9a5…0xb9d4` 原样复制源 `+0x64/68/6c/70` 到 128 字节 MeshInstance `+0x68/6c/70/74`。已检查排队复制对应通道，但没有启动完整引擎复现任务队列。
- `CMatRenderContext +0x608 → 0x97bc0` 转发到 **IShaderAPI secondary vtable** `0x319030 +0x7f0 → 0x36d50/0x36d20`，经过 `CMeshMgr +0x100 → 0x270d0`，再由 secondary `+0x920 → 0x4b7a0/0x4b500` 保留 MeshInstance 数组。普通路径 `0x4b758…0x4b772 → 0x4a930` 将数组写入 API `+0x33c0`；原 instance interpreter `0x49d91` 按 index×128 读取，最终 command13 使用该 `+0x68` RGB。不能把 primary vtable 同偏移当作相同方法。
- 特殊 mode 1 用 StudioRender `+0x188 → 0x1df10 → 0xca20`，存在写白 RGB 的分支，本候选明确排除，不能将该白值误判为普通静态道具颜色。

256 组三通道 byte 样本串联执行原 engine getter、client render-list 交接、StudioRender copy 和 shaderapi SSE，输出逐 float32 等于浏览器 `sourceInstanceTint`。engine/client 的 ELF 首选虚拟地址重叠，原 getter 指令按原字节复制到独立模拟内存页，this 调整与跳转关系保持；没有用模拟 hook 伪造 getter 结果。这是边界清楚的原指令执行与静态调用链证据，不是完整原客户端已运行的声明。

默认值也已从原 stdshader 注册、info builder 和 selected draw call 核实：`$LINEARWRITE=0`、`$ALLOWDIFFUSEMODULATION=1`，generic info `+0xb8` 保持 -1（本 shader 没有 HDRColorScale 参数索引）。原 `0xc28f4…0xc2df1` builder 经执行回读，再核对 `0xc4d81`、`0xc5231`、`0xc8a00…0xc8a19` 选择 command13 寄存器 c1。候选仅允许没有 `$color/$color2` 覆盖且实际原材质 color 为 (1,1,1) 的 4 个 VMT；无证据的颜色补偿和其他 HDR/linear write 组合仍排除。

`tint-evidence.json` 的 `remaining/runtimeChanged` 字段保留取证阶段快照，随后导出/GPU/运行时交付以本报告和 R4 GPU receipt 为准，不回写冻结证据使旧 SHA 漂移。

官方固定 SDK 仅作为公开接口与一般 Gamma-to-linear 意图的交叉参考，当前客户端的精确多项式和命令布局以安装的 ELF 为证。[Valve BaseVSShader.cpp](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/BaseVSShader.cpp) 第 652 行附近提供一般接口。下载来源、完整 SHA 与本地路径在 `encoding/tint/official-sdk-index.json`；未使用第三方泄漏源码。

## 下一批具体材质

`encoding/tint/material-candidates.json` 从现有原 VMT 全参数 catalog 可复现生成。共 54 个带 tintmask 的材质；34 个材质、949 个网格实例、2,121,754 三角没有其他额外 VMT 功能，其中 3 个材质/105 个实例没有 bump，仍需单独检查原 unbumped shader。其余 31 个 bumped 候选/844 个实例也只是候选清单，尚未重新验收 remap/GPU，不报作新增已覆盖。

| 截图对象对应原材质 | catalog 实例/三角 | 本轮之后仍需处理 |
| --- | ---: | --- |
| `dust_windows/dust_window_frame_wood_01` | 186 / 318293 | R4 精确 remap + GPU 通过 |
| `dust_wires/dust_wires_01` | 55 / 529466 | R4 精确 remap + GPU 通过 |
| `dust_kasbah/dust_kasbah_tarp_04` | 5 / 9751 | R4 精确 remap + GPU 通过 |
| `dust_crates/dust_shipping_crate_02_painted_color` | 3 / 10271 | R4 精确 remap + GPU 通过 |
| `dust_crates/dust_shipping_crate_02_painted_decals` | 22 / 126605 | tint + 原实例颜色 + 扩展的原 UV2 逐角映射 |
| `dust_lights/dust_hanging_light_02_on` | 5 / 6764 | tint、envmap、selfillum 多分支，继续排除 |

完整原路径均以 `models/props/de_dust/hr_dust/` 开头，完整 VMT 路径/参数/SHA 存在清单中。上箱仍需新增独立 UV2 数据版本与 tint+decal 组合的明确 shader 证据，不覆盖 R3 已冻结的数据与 receipt；灯具不能整体乘暗作为修复。


## R4 交付与独立 GPU 验收

`game/source-prop-tint.ts` 仅提供已审绿色遮罩和原 RGB float32 转换；`source-prop-tint-loader.ts` 只拥有 4 张原 tint 图及其 ImageBitmap。源 VTF 使用固定 SourceIO 解码为无损 RGBA8 PNG，独立 zlib/CRC/像素回读校验；没有改原始像素、方向或人为增强颜色。原 sprp 3,158 个 RGBA 共 12,632 字节完整保留并 SHA 校验，本分支仅使用 RGB。PNG/RGBA 共 1,208,368 字节；GPU 含 mip 共 10,136,232 字节，默认 16 MiB/8 texture 硬预算。

`loadSourcePropLighting(gltf,{baseURL:vhvRemapURL,maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true})` 在 remap 的同级 `tint/` 获取资源；默认 `enableTintMask=false`。所有 fetch 为 `cache:'no-cache'`，全部二进制 SHA 保留 insecure HTTP LAN fallback。复用每个原实例的精确 VHV/remap，不改 geometry、index、UV 或 node TRS，不做最近点匹配。非这 4 个 materialSource 的 tint 仍跳过，compound/unbumped tint/envmap/selfillum/$color/transform 不会被这个 option 广泛开启。

`loadSourcePropLighting` 返回 `{audit,dispose}`，dispose 先恢复原材质，再释放自身 lookup、材质、tint/decal 贴图与 ImageBitmap；重复 dispose 安全。晚到的坏身份/坐标/通道在场景修改前失败，加载中断释放已经解码的资源。6 个专项文件 / 31 个测试通过，包括 256 原 SSE oracle、默认关闭、每实例不同 RGB、错误 VTF、预算、SHA、abort 和迟发坏 binding 回滚。

实测脚本为 `scripts/browser-source-vhv-r4.pw.js`，独立 headless session `csgo-vhv-r4`（已关闭）。视口 1440×900，原第一 CT/T 出生点，eye 64 Source units、FOV 75。四图都已亲自 `view_image`：

- `output/playwright/source-vhv-r4-ct-r3.png` / `source-vhv-r4-ct-r4.png`：CT 左侧篷布/箱体恢复原有色暗部；吊灯与其他未审线段仍亮。
- `output/playwright/source-vhv-r4-t-r3.png` / `source-vhv-r4-t-r4.png`：T 两个窗框与上方线束恢复暗部，R3 底箱贴花保留；上箱复合 tint+decal 仍白。

R3 2,008 mesh / 2,823,484 tri → R4 2,257 mesh / 3,691,265 tri；新增恰好 249 mesh / 867,781 tri。R4 逐字节复验 921 份独立 geometry、92,259,144 字节属性/index；所有 3,158 实例身份通过。CT 319 calls / 657,631 submitted tri，T 975 calls / 1,795,402 submitted tri，R3/R4 同机位保持一致。`errors=[]`，unload 回到与空场完全相同的 1 geometry / 2 texture / 1 program。

正式 GPU receipt：`output/playwright/source-vhv-r4-gpu.json`，含 source/bundle/manifest/原指令证据及四图 SHA、个人视觉审阅。SHA256 **30ebb7864f79584268161ec331aa6c9c88adca990dd55ee988d0a7a6e32dc810**。早期仅 GPU 数值 JSON 的 468f… 哈希被完整 provenance receipt 替代，图像与运行结果未变。

`python3 scripts/stage-source-prop-tint.py` 已将 6 个精确数据文件逐文件 SHA 回读到 `public/source/csgo-12426148/dust2/vhv/tint/`，stage receipt SHA256 **fa2c8c90cb39aeae74e7e884e38dca4ca150178f0f6f5813d34f56aafd548442**。stage 不会开启默认 option；生产 loader 最小接入仅在自己的 options 增加 `enableTintMask?:boolean`，将其原值转发到 `loadSourcePropLighting`，由根任务在明确候选构建时设置 true。本任务未改 source-dust2、scene、runtime 或原 props.glb。

这次 GPU 验收仅证明所列分支可渲染、实例对应正确、范围与释放可核验。没有原客户端同机位曝光对照，动态光、完整 Phong/envmap、其他材质及全引擎颜色管线仍保留边界。

补充交付核验：localhost 27018 的 `/source/` 静态映射中，6 个数据文件和 stage receipt 共 7 个文件全部 HTTP 200 且逐文件 SHA256 一致，记录为 `output/playwright/source-vhv-r4-staged-http.json`；生产 HTTP LAN 加载与可玩验收由根任务另行执行。最后全工程 tsc 仍仅报其他并行文件 `game/source-pistol-character-pose.ts:28` 的 states Record 类型，不把全工程类型检查报作通过，本任务所属文件无诊断。
