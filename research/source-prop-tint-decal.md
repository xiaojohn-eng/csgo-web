# App740 R5 原木箱 tint + decal 复合分支

已恢复 T 出生点上层白箱与相同材质集合：两种原 `painted_decals` 材质、68 个 mesh 实例、278,616 个三角。R5 是独立默认关闭的 `enableTintDecal`，R4 的原始数据、private bundle 和默认行为保留。根任务已另行亲自查看 T R4/R5 同机位图；本报告没有原客户端同机位曝光或全引擎画质一致性的声明。

## 原程序与运算顺序

只读已验证完整安装的 App740 build 12426148。`scripts/inspect-source-prop-tint-decal.py` 用既有 ELF/VPK 读取器与本机 Unicorn 执行两个有界原 x64 范围：`0xce1f0…0xca615` 的分支图、`0xca690…0xca766` 的 selector 整数算术，停止在 virtual call 之前。没有启动完整 Source 引擎或运行系统调用。

原 info `+0x1d8` decal type probe 与 `+0x1f8` tint type probe 分别写栈 `-0x4c8/-0x4b6`。两种 crate VMT 均有真实 decal+tint texture，decal mode 为 1；原 `0xce216` 写 decal selector term `0x3c00000`，`0xca73e` 对 tint 标记乘 `0xb400000`。固定之前已验的纯 diffuse 基础 static4 后，8 组无纹理/有纹理/mode0/1/2 的原 selector 回读确定复合模式为 requested static **786436**。VCS 原 alias 将它映射到 **789252**，dynamic **80**，1376 字节 PS SHA256：

`c3a647622cbde3150ba3eafc4f16577251d3ad74e8aa1925a7934f1c4b294cc1`

证据文件：`.reference-assets/source-exports/dust2-vhv/encoding/tint-decal/evidence.json`；原 DX9 bytecode、逐 word 操作数 dump 在同目录。原 PS 285–318 的每条指令都精确断言，运算为：

```text
mask = saturate(sampleSRGB(tintMask, originalUV0).g + c12.x)
tint = 1 + mask * (c1.rgb - 1)
tintedLighting = bakedDiffuse * tint
baseLit = originalBaseRGB * tintedLighting
decal = sampleSRGB(decalTexture, originalVVD_UV2).rgb * c3.w
output = baseLit * decal
```

这两个真实 VMT 的 `c3.w=1`、`c12.x=0`。s13 是 UV0 绿色遮罩，s12 是原 UV2；**本组合没有 decal alpha lerp，也没有读取 tint alpha**。原 sampler sRGB 动态绑定、c1 per-instance float32 gamma 与 `$LINEARWRITE=0/$ALLOWDIFFUSEMODULATION=1` 白材质默认路径复用已固化的 R3/R4 原指令证据，详见 `source-prop-tint.md`。不将公式推广到 decal mode0、mode2、NOTINT、非白 `$color`、envmap 或 selfillum；数值探针中的负 bias 仅作算术边界干扰样本。

独立 generic DX9 token register interpreter 实际读取上述 token 的 register、swizzle、dest mask、saturate 与操作码，生成 64 组 float32 RGB oracle。它同时断言 s13 使用 `[.2,.3]`、s12 使用 `[.7,.8]`，加入不同 tint/decal alpha 干扰。该解释器属于“从原 token 执行的数值模型”，不是原 D3D GPU 或融合 MAD 的逐 bit 执行证明。

## 精确原资产与 UV2

| 原材质（省略共同前缀） | mesh 实例 | 三角 |
| --- | ---: | ---: |
| `dust_shipping_crate_01_painted_decals` | 46 | 152011 |
| `dust_shipping_crate_02_painted_decals` | 22 | 126605 |

完整前缀：`models/props/de_dust/hr_dust/dust_crates/`。两 VMT 全参数严格为 `$basetexture/$bumpmap/$tintmasktexture/$surfaceprop/$decaltexture/$decalblendmode`，mode1。运行时还要求原 material color `(1,1,1)`、opaque、opacity1、alphaTest0。

`scripts/extract-source-prop-tint-decal.py` 从原 BSP pak 优先、loose/VPK 后备读取原纹理，由固定 SourceIO 的 native VTF decoder 解码；无损 RGBA8 PNG 逐像素回读，无翻转、重绘或颜色调整。原 crate01 tint 为 512²、crate02 tint 为 1024²、共享 crate01 decal 为 2048²。

`scripts/extract-source-prop-tint-decal-uv.py` 只复用冻结的 R3 exact-oriented-triangle 算法，将输出定向到独立新目录。直接从原 VVD extra attribute type1/float2 读取 UV2，以原有向 POSITION+UV0 三角与 source VVD vertex ID 对应，不使用最近点、不让相同 VHV 颜色替代 UV2 身份。11/11 record 通过、101,737 原有 glTF vertex 的 UV2 payload 813,896 字节、241,731 个精确三角角；本批没有多候选歧义或非有限 UV2。原 props.glb、source-index GLB、原 geometry/index/UV0/TRS 保持原样。

原 UV2 payload SHA256：`ee98621975928c2dd21b4588ebc12992b1714b98bb75fd30922cb477177d04ff`。

## 实现与生命周期

`game/source-prop-tint-decal.ts` 提供独立候选门控、验证及单一组合片段。VHV 先算出 `sourceBakedDiffuse`，再在唯一 `SOURCE_TINT_DECAL_COMPOSITE` 标记处插入该原顺序片段；不会串联两个各自替换 `map_fragment` 的 tint/decal hook。标记缺失或重复均抛错。

`game/source-prop-tint-decal-loader.ts` 仅允许这两个完整原 materialSource，校验原 BSP、全部新 RGB/PNG/UV2 的字节/SHA、尺寸/路径/预算；HTTP LAN 同样使用 shared SHA256 fallback，所有 fetch 都请求 `cache:'no-cache'`。低层 caller 可以借用已经由 R3/R4 owner 校验的原 texture；运行时核对 source/dimensions/sampling，完整 GPU receipt 另核对两个被借用纹理在 R3/R4/R5 receipt 中的原 VTF SHA 与 decoded-pixel SHA 完全相同。

与 R3/R4 一起加载时，仅新增一张 512² tint 图（含 mip 1,398,100 字节）和 UV2 RG32F lookup（819,200 字节），合计约 2.12 MiB；另外两张原图借用既有 owner。单独开启 R5 也可自建 3 张原图，总 texture mip 29,360,124 字节，受 32 MiB 限制，UV2 另有 4 MiB 限制。原实例 3,158×RGBA 字节仍完整 SHA 校验，只用 RGB。

loader 返回 compound handle；主 lighting handle 先恢复/释放新材质，然后 dispose compound（只释放自己的新图、UV2、ImageBitmap），最后 dispose 原 R3/R4 owners。失败回滚与重复 dispose 都不会销毁借用图。专项 **8 files / 36 tests** 通过，涵盖默认 R4 排除、单次有序片段、实例 RGB 隔离、坏 RGB/UV2 先验、借用生命周期、迟发坏 UV2 回滚、未知材质拒绝及 insecure HTTP SHA。

## 真实 GPU 与交付

`scripts/browser-source-vhv-r5.pw.js` 在独立 headless `csgo-vhv-r5` 会话执行，现已关闭。1440×900、原第一 CT/T 出生点、eye64 Source units、FOV75。四张完整截图都由本代理亲自 `view_image`，R4 基线 CT/T PNG 与上次已审 R4 PNG 的 SHA **逐字节相同**：

- `output/playwright/source-vhv-r5-t-r4.png` / `source-vhv-r5-t-r5.png`：上箱的木纹、数字/运输标签贴花及实例着色恢复；R4 底箱、窗框、线束保持。
- `output/playwright/source-vhv-r5-ct-r4.png` / `source-vhv-r5-ct-r5.png`：门后原同类箱体恢复暗部，其余未审灯具仍保持原状。

覆盖从 2,257 mesh / 3,691,265 tri 增至 **2,325 mesh / 3,969,881 tri**。R4 249 tint mesh、R3 40 decal mesh 不变；新增恰好 68 compound mesh。R5 对 932 个 unique geometry 的 96,342,470 字节 POSITION/NORMAL/UV/index 做 SHA 回读，3,158 原实例身份保持一致。CT 319 calls / 657,631 submitted tri，T 975 calls / 1,795,402 submitted tri；R4/R5 同机位提交数量相同。控制台与 page errors 均为空；unload 回空场 **1 geometry / 2 texture / 1 program**。

另用独立 1px renderer 执行**同一 exported production fragment**，对 64 个原 token oracle 作像素读回。最大线性误差 `0.0019472078657617742`，小于 8 位量化的 `0.5/255`；独立 renderer 释放回 **0/0/0**。此探针输入已经采样的线性 texel，真实地图四图另外覆盖原 PNG/sRGB 与精确 UV2，不能用数值探针单独声称原引擎曝光一致。

完整 GPU receipt：`output/playwright/source-vhv-r5-gpu.json`，包含全部相关 source/bundle/manifest/原指令证据及四图 SHA、64 numeric case、借用 texture 原始身份与个人视觉审阅。SHA256：

`4c2b4e0152651b06c1ed1847ecb6c55d52bbe119c37f53d31a25dd2d56cea5e1`

`python3 scripts/stage-source-prop-tint-decal.py` 已将 7 个精确数据文件逐文件 SHA 回读到 `public/source/csgo-12426148/dust2/vhv/tint-decal/`。stage receipt SHA256：

`7997ee57ed39f1b699587c6da450247b13037c26972f9bad42e805f75d40740d`

生产只需根任务在自己的 loader option 增加并转发 `enableTintDecal?:boolean`，在已审候选中设置 true：

```ts
loadSourcePropLighting(gltf, {
  baseURL: vhvRemapURL,
  maxTextureSize,
  enablePlainUnbumped: true,
  enableDecalMultiply: true,
  enableTintMask: true,
  enableTintDecal: true,
});
```

默认仍为 false，自动从 remap 同级 `tint-decal/` 读取。此任务未修改 root scene/source-dust2/runtime；生产 LAN、可玩状态和候选版本由根任务另外验证。
