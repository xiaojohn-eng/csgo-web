# Dust2 原 IDF 第一人称手臂：CT AK 视角

原 App 740 / build 12426148 的 `ct_arms_idf.mdl` 已导出、逐帧数值验证并暂存。生产加载器使用原 AK 四段动画，CT 袖口和完整手套保留独立 48 骨 skin/原 inverse bind；主任务接蓝队选择与实际 GPU 验收。本报告不把 CPU 通过当作原客户端视觉等价。

## 来源与不可混用的身份

- 原 `gamemodes.txt` SHA `664a20160282f1c19a18528d790017898cec7e407205fac3834c3023d5db46a4`，`maps.de_dust2.ct_arms = models/weapons/ct_arms_idf.mdl`。
- 原 CT arms MDL：22,448 bytes，SHA `19713824281591f37718a379ec6aeee481fd591b9f02282c898a7683c5fa7877`。
- AK 58 骨 + CT arms 48 骨，47 同名骨、34 加权骨全部有对应；独有不加权 `Bip01` 保原 local rest。不能把两个 skin 换成同一 inverse-bind 表：原 rest 矩阵差最大 35.263557 Source units。
- CT arm mesh 11,134 顶点 / 19,734 三角形；实际可见两材质 `ct_arms_idf`、`models/weapons/v_models/arms/ct_base_glove`。MDL 材质表另含未选中的 `ct_arms`，原 VMT/PNG 仍私有保留。
- SourceIO 固定 commit `cfc2591d096628a35f570aa830ab75cc8665108b`；Blender 5.2.1 LTS arm64 / `--background --factory-startup`。仅项目内流程；没有修改 SourceIO checkout、T 原输出或 Blender 偏好。

## 原动作与绑定验证

|动作|精确 clip 名|原 FPS|原帧数|时长秒|
|---|---|---:|---:|---:|
|idle|`idle__ak47_idle`|30|2|0.033333333|
|fire|`fire__ak47_fire1`|20|16|0.750000000|
|reload|`reload__ak47_reload`|30|74|2.433333333|
|inspect|`inspect__lookat01`|30|138|4.566666667|

- 与已冻结 T+AK GLB 对照：AK 8 个 geometry/index/IBM accessor bytes、464 个原动画通道的输入时间与输出 bytes 全部严格相等，triangle winding 未改，原 muzzle/ejection local metadata 与每时刻 world matrix 差均为 0。
- CT 48 个 GLB inverse-bind 逐 float32 等于 `rawSourceIBM * inverse(C)`；C 只对模型顶点做 `(x,z,-y)`。不是 `C*M*inverse(C)`。只恢复 CT 的 48 矩阵，AK 的所有 bytes 保持。
- 原 CT rest 重建在 Blender 中最大差 0.0000400543 Source units；恢复原 IBM 后，独立 Three 的每个原帧 + 各片段 2 个内部时间，共 238 时刻、11,186 骨对、156,128 顶点样本检查。烘焙 local-key 分支仍有已测骨差 0.002090885 / 顶点差 0.003551450 Source units（约 0.09 mm），因此生产没有把烘焙 CT keys 当成精确骨合并。
- 生产 `bind` hook 每次在原 AK mixer 后，按确切 source 骨名复制 47 个 AK world matrix，换算 CT parent-local，保留原 CT 独立 skin/IBM 与不匹配 Bip01 rest。避免再次 TRS 重组损失，手动 local matrix 后显式标记 `matrixWorldNeedsUpdate`；复制根后先刷新中间 Bip01。
- 生产严格回读：238 时刻，11,186 骨对最大误差 `4.44089e-16` m；71,876 实际蒙皮顶点对原 source IBM 加权公式最大 `5.66785e-16` m；48 原 IBM 不变。平均完整 sample/hook `0.089513` ms（本机 CPU 单次测量，不是 GPU FPS）。

## CT 原 VMT 的材质合同

|字段|IDF 袖口|CT 完整手套|
|---|---|---|
|base|ct_arms_idf|ct_base_glove_color|
|normal|ct_arms_normal|ct_base_glove_normal|
|Phong exponent|固定 12，无指数纹理|原 ct_base_glove_exp R，经 `1+149R`|
|boost / tint|1 / [1,1,1]|0.8 / [0.7,0.8,1]|
|Fresnel ranges|[0.2,0.2,1]|[1,1,3]|
|Half-Lambert|原 `phongdisablehalflambert=1`，关闭|SDK skin 默认分支，开启|
|Phong mask|原 normal alpha|原 normal alpha|
|rim exponent / mask|15 / 1（无 rimmask）|4 / 原指数纹理 A（rimmask=1）|
|尚未实现原字段|ambient rim boost 0.2|ambient rim boost 1、env_cubemap/tint[.01,.01,.02]、phongalbedoboost15|

原 VTF native 解码 RGBA8 后无损 PNG，base 使用 sRGB，其余通道 NoColorSpace；原 tangent normal 的 Y 方向在渲染 normalScale(1,-1) 转换。未把指数 RGB 当彩色高光，也未套用 T 裸臂 lightwarp。所有可见三材质（AK+两臂）必须精确替换，材质名不符会拒绝。

Phong 固定指数优先/指数纹理 R 与 rim A 分支依据固定 Valve SDK2013 [skin_ps20b.fxc](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/skin_ps20b.fxc) 及 [skin_dx9_helper.cpp](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/materialsystem/stdshaders/skin_dx9_helper.cpp)。这是当前原 VMT + 公开 SDK 的受限直接光实现，不冒充 CS:GO 私有完整 shader/环境光。

### 原 CT 输入纹理清单

|原 VTF|尺寸|RGBA bytes SHA256|PNG SHA256|
|---|---:|---|---|
|`materials/models/weapons/v_models/arms/ct_base_glove_color.vtf`|1024×1024|`6c8d5b6f8b9d15fc409efa45d0a0cafca7a455053d0b5796a581a931c7b98879`|`025c4f541318670cec61aa2739a5832769d6aa99562eaad6290060330ff23727`|
|`materials/models/weapons/v_models/arms/ct_base_glove_normal.vtf`|1024×1024|`aef830e1e5e93a7eeab9f4c7ac06d89d9060f57955e23d0aa7b02788d9ad4725`|`c3760a0df0eb6d9e479a096845d3e7371e60cfd65a74aca1d87d4ea50363d636`|
|`materials/models/weapons/v_models/arms/ct_base_glove_exp.vtf`|1024×1024|`179ee8a493e6af71879ff683bde7e03b37fb64fae7e71a377ea3f1d32fde6358`|`335b519b92c9bddef787e5ddafd5a50babf4ca781cadec2349120881c802e34c`|
|`materials/models/weapons/v_models/arms/ct_arms_idf.vtf`|1024×2048|`f1c934405aa9b5ccb1021ff57dc86b10266face6d27e229a16f8d25babc91fe8`|`931fe8bdc5fc7879a66430a786ec706bc7a119e5868eb315104ae6398369dc14`|
|`materials/models/weapons/v_models/arms/ct_arms_normal.vtf`|1024×2048|`7d20564748a9425ef9a481f0c36b2f769e4aed9b4e72100fbdc1729550300eff`|`da3967e612b1eef5e602fb2de2c90775c0fd3adb985edeff385471ca4bfa25f1`|
|`materials/models/weapons/v_models/arms/ct_arms.vtf`|1024×2048|`697a4cc7b31baf7cbad8edc9b7899c62f97aeb24faf5dc5483467c8eca77183e`|`8079c96383ce0b6437d256037c4ea375b3eb77c7d5df766879a23ce99d180f5b`|

完整原 VMT、原 VTF CRC/长度/SHA、骨名和 48 raw inverse matrices 见 `ct-metadata.json`。AK 的原纹理记录在 `audit.json.raw_texture_exports`。

## 可直接接主游戏的 API

```ts
import {loadSourceCTViewmodel} from '@/game/source-ct-viewmodel';
const owner = await loadSourceCTViewmodel({signal});
const root = owner.createViewmodel();
// root 兼容现有 updateSourceViewmodel / startSourceInspection /
// cancelSourceInspection / sourceAttachment / inspectSourceViewmodel。
owner.disposeViewmodel(root); // 换队只释放本实例
owner.dispose(); // 最后统一释放共享 GLTF、原 textures、所有剩余实例
```

- 默认 baseUrl `/source/csgo-12426148/ak47-ct`。owner 含 `gltf, manifest, hashVerified:true, profile:ct_arms_idf`。`inspectSourceViewmodel(root).armsProfile` 可诊断实际身份。
- 生产 GLB SHA：`09e4bbc5a0efe7ee880452e906d19ee902f9f9bc9491415378fb76998d99b687`，24,426,012 bytes；暂存 10 文件共 43,797,685 bytes（不含 manifest）：GLB + 7 张必需原 PNG + 原 metadata + 私有导出数值报告。没有复制 T 音效，AK 枪声沿用同原武器声音合同。
- 每个实际加载 GLB 与 PNG 在 parse/decode 前验证长度/SHA；HTTP LAN 缺 WebCrypto 时也走 shared `sourceSha256` 的 noble fallback，不降级跳验证。
- `Promise.allSettled` 收齐失败/成功分支后回收已返回的 geometry、materials、textures、skeletons；abort 在下载/hash/解码后均检查，Blob URL 在 finally 回收。新实例骨架独立，资源归 owner；不改变 T 默认四参入口。
- 坐标仍原 source-unit GLB，唯一外层 `.0254` 和 yaw `π/2`，Source(x,y,z)→camera(-.0254y,.0254z,-.0254x)。不对每根骨骼单独猜尺度。

## 重现与证据

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/import-source-ct-viewmodel.py
node scripts/validate-source-ct-viewmodel.mjs
python3 scripts/stage-source-ct-viewmodel.py
npx vitest run tests/source-ct-viewmodel.test.ts tests/source-viewmodel-owner.test.ts
npx tsc --noEmit
```

- `scripts/import-source-ct-viewmodel.py` 复用已验 `import-source-weapon.py`，增加原 gamemodes/VMT/PNG 提取与 CT raw IBM 恢复；`-- --metadata-only` 仅重做新目录 metadata/IBM，不重新导出。
- `.reference-assets/source-exports/ak47-ct-arms/{audit,ct-metadata,three-readback,ct-readback,runtime-readback}.json`。
- `output/source-ct-viewmodel-import.log`、`output/source-ct-viewmodel-metadata.log`、`output/source-ct-viewmodel-strong-readback.log`、`output/source-viewmodel-owner-tests.log`。
- 当前两组数值/材质/owner 合同专项合计 10/10 通过；实际 LAN 蓝队长袖/手套、回 T 裸臂、完整换弹、F 检视、Esc/重新锁鼠标由主任务验收，GPU 结果单独记录。无原客户端并排对照，未恢复 CSGO 完整 ambientcube/envmap/phongalbedoboost，不宣称最终材质完全等价。

最终检查：2026-09-09 03:46 本机两组专项 10/10、全仓 `tsc --noEmit` 通过；CT staged 10 文件逐字节长度/SHA 回读通过。
