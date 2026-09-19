# App740 静态道具三路 VHV 解码与原几何接线

已确认当前安装的 CS:GO App740 三路 bumped diffuse 载荷为 **三组原 D3DCOLOR，逐顶点转线性 RGB 后再插值**。第四字节没有参与本次受验 pixel shader 的漫反射；它不是这条路径的共享 RGB 指数。这个结论来自当前官方安装二进制的字节搬运、顶点声明和实际编译 shader 三段证据，不由通道统计推断。

新模块只接通 56 个受限原材质、1,300 个 mesh 实例、2,060,386 个三角形。其余 2,449 个 mesh 实例保留原材质。原 `props.glb`、模型几何对象、POSITION/NORMAL/UV/index 缓冲、节点变换全部保持不变。主任务已完成 CT/T 两机位的 GPU off/on 与卸载验收；完整 Source 光照、原实例调色及其余材质分支仍需分开验收。

## 当前安装包的硬证据

取证脚本：`scripts/inspect-source-vhv-encoding.py`。可复验文件位于 `.reference-assets/source-exports/dust2-vhv/encoding/`，包括原 VCS、选中程序的原 DX9 token、带地址反汇编、256 项 LUT 和 `evidence.json`。

| 段落 | 当前安装实物证据 |
| --- | --- |
| 原 VHV 搬运 | `engine_client.so` 的 `sp_hdr_%d%s.vhv` 路径，检查 `vertexSize == 4 * streams`；从原文件组偏移直接复制到 color buffer。`0x33c1c2` / `0x33c594` 调到 `0x65f500`，后者直接跳 `memcpy@plt`，没有 CPU exponent 转换 |
| GPU 声明 | `shaderapidx9_client.so`，`r_staticlight_streams` 关联代码 `0x683e8`：Stream 1、Offset 0/4/8、Type 4、Usage COLOR、Index 1/2/3 |
| VS 选中程序 | `vertexlit_and_unlit_generic_bump_vs30.vcs`，static 0 / dynamic 4，3,228 字节，SHA `5929685df85aaffd415e7967c2589abe36b9b74254618ecfcc393f9be31de927` |
| PS 选中程序 | `vertexlit_and_unlit_generic_bump_ps30.vcs`，static 4 / dynamic 80，1,316 字节，SHA `0d7db1f68e63dee495a453646d1cc18fd33e82896e4e7195bad354de51683702` |

Type 4 对应 D3DCOLOR，unsigned bytes 归一化到 0–1，按 RGBA 暴露给 shader。D3DCOLOR 的 packed ARGB 在当前 little-endian 文件里是 B,G,R,A；不能直接把前三个文件字节当 RGB。[Microsoft D3DDECLTYPE](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3ddecltype)，[D3DVERTEXELEMENT9](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dvertexelement9)，[D3DCOLOR_ARGB](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dcolor-argb)

VCS 位于 `platform/platform_pak01`，不是地图 `csgo/pak01`。两个原 VCS SHA 分别为 `dd6d6a0dd6c718af0facf0df1db881892849df7e7dafaeb036e968d2f29a3967` 和 `93a9a7ffb12acb3fca32873aed4aa79a64d8a9b389d73ebe006b82d31d6da855`。脚本仅读指定 static span，验证 Source LZMA 头的明确解压长度及程序边界；没有把无 EOS 记号的流交给无限制解压。VCS 6 的外层结构参考固定官方 SDK，实际压缩分支以本次实物为准。[Valve shader_vcs_version.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/materialsystem/shader_vcs_version.h)

原 VS 的运算顺序是 `add rgb,rgb` → `log2` → 乘 FLOAT32 `2.200000047683716` → `exp2`。等价公式及原 PS 运算：

```text
linear_i = pow(2 * normalizedD3DColor_i.rgb, 2.200000047683716)
n = sourceNormalTexture.rgb * 2 - 1
b0 = ( 0.8164966106414795,  0,                  0.5773502588272095)
b1 = (-0.40824833512306213, 0.7071067690849304, 0.5773502588272095)
b2 = (-0.4082482159137726, -0.7071068286895752, 0.5773502588272095)
w_i = saturate(dot(n, b_i)) ^ 2
diffuse = sum(w_i * interpolatedLinear_i) / sum(w_i)
```

基向量从实际 PS `DEF` 的 FLOAT32 token 读取。PS 接收 TEXCOORD6/7/8 的 xyz，未接收其 alpha。实际 Source normal 没有在这条路径显式归一化；权重和作分母。新 GLSL 只为畸形零 normal 加 `1e-8` 分母保护，使其输出有限黑色。纹理绿通道按原导出 manifest 的“green inversion”反转回原数据，未手工调整颜色或曝光。

256 个输入 byte 的逐 token CPU 结果和等价 LUT 最大差 `8.88e-16`。17,711,685 个原 32-bit word 的 float 重解释出现 subnormal、负数、非有限数；这些统计只用于排除“无条件三个普通线性 FLOAT32”的说法，不是颜色格式的正向证明。

`r_staticlight_streams` 构造器观察到的默认字符串为 `1`，不能声称运行时默认就是 `3`。当前地图 12B 记录与读取校验相容的三流路径已确认，但没有启动原客户端观察 cvar 的运行时覆盖。原 CPU 另有 alpha 聚合路径，其意义未赋予；不向其他 shader 变体泛化本次“不读 alpha”的结论。

## 精确映射及不唯一部分

`scripts/map-source-prop-vhv.py` 使用原材质 ID 和有向三角形的逐角 **精确 POSITION+UV** 键，只允许三个循环起点，不允许反向或容差。完整有向三角形/材质 multiset 也必须相等。Blender 导出的 custom normal 有量化差，因此没有把“几乎相同的 normal”作为近邻筛选条件。

其中 2,908 个完全重合面候选，仅在对应源硬件顶点的 **全部原实例 12B 光照逐字节相等** 时接收。另有 8 个 mesh、12 个 primitive 的重合面拥有不同原光照，保持 `verified=false`；没有任意选一个、平均颜色或改几何来掩盖歧义。这些 primitive 实例化为 14 个 mesh、22,115 个三角形。完整模型路径见 `remap/manifest.json.failures`。

`scripts/validate-source-prop-remap.py` 不读取新 source-index 候选 GLB，也不使用 SourceIO/Blender，直接把原 GLTF 映射回 raw VVD file index：1,418 个 primitive、3,593,611 个实际被绘制顶点、11,790,051 个三角形角点通过精确位置/UV 回读；3,158 个实例的 3,749 组 VHV 载荷逐字节相等。原 `props.glb` SHA 仍为 `55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232`。

此前生成的 `geometry/props-source-index.glb` 只作为经过验证的 raw VVD/VTX 审计参考，不替换当前地图几何。GPU 使用既有原 `props.glb` 的索引。

## 模块、预算与清理

- `game/source-prop-lighting.ts`：`applySourcePropLighting(root, data)`，返回 `{audit, dispose}`。
- `game/source-prop-lighting-loader.ts`：`loadSourcePropLighting(gltf, {baseURL, maxTextureSize, signal?, maxBytes?, enablePlainUnbumped?})`；严格关联原 GLTF primitive、`static_prop_i`、sourceModel/skin、材质 `extras.full_path`，核对二进制 SHA，并逐唯一 geometry 校验 POSITION/NORMAL/UV/index SHA。R2 的 `enablePlainUnbumped` 显式开启，默认仍为 R1。
- 私有预览 `scripts/preview-source-prop-lighting.ts` 是薄 reexport；构建的 JS 位于 `dust2-vhv/remap/preview-source-prop-lighting.js`。
- `scripts/stage-source-prop-lighting.py` 只 stage 3 个原校验文件及独立 receipt。正式 baseURL 为 `/source/csgo-12426148/dust2/vhv/remap/`，未改地图总 manifest 或 scene。

WebGL2 `gl_VertexID` 查询共享 R32UI 映射纹理，再按独立实例 offset 查询三路 RGBA8。gamma decode 在 vertex shader，插值后再在 fragment shader做方向权重。没有 frame 更新分配，也没有修改或复制 geometry。

GPU lookup 两张纹理合计 **85,639,168 字节（81.67 MiB）**，尺寸 `4096×902` 与 `4096×4325`；默认总上限 `96 MiB`。调用方传 renderer 的实际最大纹理边长，超限直接拒绝。1,300 个材质实例各持独立 offset，编译程序可共享。源 base/normal texture 仅借用；`dispose` 恢复原材质并只释放新材质和两张 lookup 纹理，必须先于 GLTF 资源释放调用。

新 11 项专项测试覆盖实例隔离、原几何身份、原短名/full_path、坏 binary/vertex/index、预算、重复持有、清理复位及 shader 结构。`scripts/validate-source-prop-lighting.ts` 用真实 GLTFLoader 回读原 3,749 个 mesh，48,408,354 字节 eligible geometry 摘要、1,300 个 shader uniform 配对、全部 geometry/index/attribute 引用与复位通过；此次材质应用约 42 ms，CPU 全流程约 732 ms。测试没有解码图片或创建 WebGL context，所以这些数值不等于 GPU 性能或视觉验收。

其余原材质按互斥主分支与完整原 VMT 参数列在 `research/source-prop-material-branches.json`。该清单保持 R1 基线；R2 仅新增下文单独取证的 plain-unbumped。tintmask、envmap、decal、detail、phong、treesway 等仍不直接开启。原作的动态光、环境光、完整曝光和材质管线仍有差距。

## 真实 GPU 及 HTTP LAN 后续验收

主任务的 `output/playwright/source-vhv-gpu.json` 记录 CT/T 两个固定机位 off/on，`errors=[]`；CT 为 377 calls / 758,458 tri，T 为 1,006 calls / 1,867,987 tri，开关前后不改变绘制三角数。开启后仅增加两张 lookup 纹理，程序数 12→17；卸载后回到初始 geometry=1、texture=2、program=1。截图为 `source-vhv-{ct,t}-{off,on}.png`。主任务实际看图确认 CT 顶梁、屋顶和木板的白洗改善；金属、植被等未支持分支仍亮。没有原游戏同机曝光对照，因此只验收本次受限 diffuse 和生命周期，不称最终外观一致。

原 sprp 数据后续检查发现：3,158 个实例中仅 1,770 个 `diffuse_modulation` 为全白，当前 plain-bump 范围也有 442 个非白原实例。该字段是原实例调色层，现模块尚未接入。VHV 字节/三路解码的证明仍成立，但不能把目前输出当成含原调色的完整材质色彩；门框 tintmask 研究需同时核对这个字段和原 shader 消费链。

普通 HTTP LAN 属于 insecure context，不能依赖 `crypto.subtle`。新增 `game/source-sha256.ts`：优先 native WebCrypto，否则用固定 `@noble/hashes@2.4.0` 的纯 JS SHA-256，绝不跳过验证。官方 npm 元数据为 MIT、无运行依赖，安装在本项目真实 `node_modules`，未写旧工程；package/lock 仅增加该固定依赖。库上游公开源码、测试与审计入口可查，未将历史审计泛称为此版本所有代码的新审计。[noble-hashes 官方仓库](https://github.com/paulmillr/noble-hashes)

回退按 4 MiB 增量处理并让出事件循环，取消信号贯穿 fetch、binary 与 geometry 哈希。17 项专项测试包括空/abc/百万 a 的已知 SHA-256、padding 边界、非零 byteOffset、大分块、取消、缺 crypto/缺 subtle、错误二进制和错误几何均拒绝。`three-verification-http.json` 在 `secureCryptoAvailable=false` 下重新完成原整图校验：1,300 bindings、48,408,354 geometry bytes、两个 lookup 与复位通过，CPU 全流程约 932 ms。此项是确定性 insecure-API 缺失 fixture，实际 HTTP LAN GPU 由主任务另验。

主任务随后记录 `output/playwright/source-r4-teams-lan-gpu.json`：两端实际 HTTP LAN 缺少 WebCrypto，地图、T/CT 角色的全部校验均为 true，R1 道具覆盖 1,300、`errors=[]`。这与前述 API 缺失 fixture 是两份不同证据。

## R2：原非 bump 的首路烘焙项

`scripts/inspect-source-prop-branches.py` 从当前已安装平台 VPK 读取 shader，输出 `dust2-vhv/encoding/non-bump/evidence.json`。`vertexlit_and_unlit_generic_vs30` static0/dynamic0 的 1,484B 原程序只声明 COLOR1；它先解码 `pow(2*rgb,2.200000047683716)`，再写入 TEXCOORD6.xyz。该输出受原 c50.x 非零门控制；没有把此寄存器猜成已确认的公开 SDK 默认参数。`vertexlit_and_unlit_generic_ps30` static8/dynamic16 的 1,424B 原程序 SHA 为 `4c7b5559c11ebf85d06f2bdfdee7328d761518f8fd602b373ebd627d00274c4c`，读取这项并与另一原光照输入相加，再乘材质系数与 albedo。本模块只提取已经存在的 VHV 首路烘焙 diffuse，未重建整个原 shader 的常量设置、动态/环境项、decal、fog。

R2 无 bump 时直接使用该首路插值颜色，不伪造 normal，也不把 bump 三方向权重公式套入。仍必须通过其余所有 VMT 白名单；有 treesway、tintmask、phong 等特征的材质继续保留原材质。原 COLOR1 alpha 在该选定 PS 的烘焙项中未读取，不据此推断其他分支的 alpha。

实际 Three 回读 `three-verification-unbumped-http.json`：**1,968 个 mesh / 2,738,975 个三角形 / 105 个原材质**，比 R1 新增 **668 个 mesh / 678,589 个三角形 / 49 个原材质**。760 份独立 geometry 摘要共 61,570,778 字节通过 SHA；1,968 份实例 uniform 与原光照 offset 配对，原 geometry/index/attribute 身份保持，仍只用同样两张 lookup 纹理。该次 CPU 全流程约 1,064 ms，材质应用约 59 ms，不作为 GPU 帧性能。当前三套专项测试 **20/20 通过**，含 R2 默认关闭、首路 shader 结构、额外 VMT 特征拒绝和原资源复位；TypeScript 检查通过。

独立 headless Playwright 会话 `csgo-vhv-r2` 在私有 `127.0.0.1:27018` 做了 off/R1/R2 × CT/T 六图，保存 `output/playwright/source-vhv-r2-gpu.json`。三种模式均使用原始首个对应阵营 spawn、原 forward、眼高 64 Source units、FOV 75、1440×900 viewport、相同 ACES exposure=1；本轮视口不同于上轮，跨轮绘制数不直接比较。本轮 CT 三次均为 **319 calls / 657,631 tri**，T 三次均为 **975 calls / 1,795,402 tri**，`errors=[]`。纹理数为 330→332→332，program 数为 12→17→21。部分 geometry 首次访问 T 机位才上传，1219→1241 不代表 R2 复制几何。卸载后 geometry=1、texture=2、program=1，与加载前空场景相等。

本代理已逐一 `view_image` 查看 `source-vhv-r2-{ct,t}-{off,r1,r2}.png`：CT 地面草簇和轮胎盆栽白洗消失、烘焙暗部保留；T 草簇、路牌和棕榈树干出现原烘焙光照变化。箱体、窗框和部分树叶仍明显白亮，属于未支持特征或尚缺的材质/光照层，不能把六图通过称为完整原作外观验收。没有修改颜色、曝光、几何或相机来掩盖差距。原 sprp `diffuse_modulation` 仍待独立消费链取证；R2 没有启用这项。父任务负责正式生产开启 R2，本脚本只交付受限分支及上述私有 GPU 证据。

复验命令：

```sh
python3 scripts/inspect-source-vhv-encoding.py
python3 scripts/map-source-prop-vhv.py
python3 scripts/validate-source-prop-remap.py
npx tsx scripts/validate-source-prop-lighting.ts
npx tsx scripts/inventory-source-prop-branches.ts
npx vitest run tests/source-prop-lighting.test.ts tests/source-prop-lighting-preview.test.ts
node scripts/build-source-prop-lighting-preview.mjs
python3 scripts/stage-source-prop-lighting.py
```

R2 复验：`npx tsx scripts/validate-source-prop-lighting.ts --unbumped --insecure`；GPU 使用 `scripts/browser-source-vhv-r2.pw.js`，经 Playwright CLI `run-code --filename` 在独立 `csgo-vhv-r2` headless 会话执行。
