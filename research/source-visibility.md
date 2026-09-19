# Dust2 原始 PVS 与保守浏览器查询契约

2026-09-09。本阶段已经完成原始 BSP 提取、纯 TypeScript 查询及 CPU 独立核验；尚未在游戏或私有预览器接入，不能据此声称 GPU 性能或原引擎渲染一致性通过。

## 交付与复现

- `scripts/extract-source-visibility.py`：标准库读取已安装 App 740 的原 BSP，校验 lump 范围，输出原始数据及可追溯的派生关联。
- `game/source-visibility.ts`：不依赖 Three、网络或场景的准备、寻叶、可见性查询及保守判断函数。
- `tests/source-visibility.test.ts`：14 项测试通过，包含有效查询、未知/损坏数据、边界、自环、输入不变、原 30 出生点及诊断视点。
- `scripts/validate-source-visibility.ts`：另一实现直接读取原 VIS header offsets/RLE，对 1,795 行逐字节核验，并对 60 次查询逐 ID 比较。
- 私有输出 `.reference-assets/source-exports/dust2/visibility/`：`visibility.json`、`original-visibility-lump.bin`、`manifest.json`、`spawn-fixtures.json`、`displacement-membership.json`、`verification.json`。

```sh
python3 scripts/extract-source-visibility.py
npx tsx scripts/validate-source-visibility.ts
npx vitest run tests/source-visibility.test.ts
npx tsc --noEmit
```

以上命令已实际完成。原 BSP 来自匿名安装且已 validate 的 App 740 public build 12426148，未修改原包。

| 原始内容 | 实际读回 |
|---|---:|
| BSP SHA-256 | `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc` |
| VIS lump SHA-256 | `86caaebf081f84d27025ac57ac141d5357bd6d6fcef25ea95fbf6c94970edf5d` |
| VIS 字节 | 638,374 |
| planes / nodes / leaves | 20,946 / 3,434 / 3,478 |
| clusters / 独立核验 PVS 行 | 1,795 / 1,795 |
| 全部 faces / model 0 faces | 9,852 / 9,715 |
| model 0 原 face ID | 0–9,714 |
| sprp version / record size / 实例 | 11 / 80 bytes / 3,158 |
| 导出 visibility.json | 2,211,775 bytes |
| visibility.json SHA-256 | `75b812f49a56ce4db0b1afe3cde56ab138b6be497827c83b581412d24c91d343` |

## 原始事实与派生关联

`planes/nodes/leaves/leafFaces`、PVS/PAS bit offsets 和静态道具 `first_leaf/leaf_count` 均取自原 BSP；sprp 每个实例的关联叶子保持原索引，不以道具原点、距离或模型包围盒替代。PVS 非零 byte 直接复制，零 byte 后的计数表示连续零，目标行长为 `ceil(clusterCount/8)`。当前文件无缺失行；越界或不完整行在提取阶段失败，不伪造可见集。

必须区分 world face 关联：当前地图的 `leafFaces` 仅 2,158 条、1,528 个独立非位移面，而 8,324 个位移面全部未出现在该表。仅按 leafFaces 筛选会删掉大部分实际墙地表面。

本实现采用三个保守来源：原叶子面表；原节点面范围对应其后代叶子 clusters；位移面使用原 base quad、DISPINFO、DISP_VERTS 重建全部原顶点，取 AABB 并穿过原 BSP 平面枚举相交叶子。最后一种是**派生的保守包围盒关联，不是文件内的原 leafFace 表或复刻的 CSGO render list**。AABB 只额外扩张 0.01 Source unit（约 0.254 mm），用于 float32 边界容差。逐面来源和包围盒在 `displacement-membership.json`，9,715 个 world face 都得到非空 cluster 关联。

原 `sky_camera` 在 Source `[-27.1673,-478.122,-8231]`，leaf 2497、cluster 0、area 1。当前预览没有原 3D sky 独立 pass，所以与 sky camera area 相交的 205 个 world faces 和 75 个 props 固定常显，防止把现有 sky 几何错误剔除。这是明确的保守多画。

## 接口及接入规则

```ts
const index = prepareSourceVisibility(json); // 加载时一次；复制和校验输入
const result = querySourceVisibility(index, cameraPositionInBrowserMetres);
isSourceFaceVisible(result, originalFaceId);
isSourcePropVisible(result, originalSprpIndex);
```

相机输入必须是世界坐标下的实际 eye/camera 位置，不是脚底 player root。原坐标转换为 `Source(x,y,z) → browser(.0254*x,.0254*z,-.0254*y)`，逆变换由模块提供。不要重复 GLB 外层比例，也不要混用第一人称武器的额外朝向变换。

`result` 给出 `leaf/cluster/boundary/reason/allVisible/worldFaceIds/staticPropIds/worldFaceMask/staticPropMask/worldFirstFace`。`worldFaceMask[faceId-worldFirstFace]` 对应原 face；prop mask 对应原 sprp record index。正常结果可按 cluster 缓存；边界或失败结果不能借用上一个 cluster。`findSourceLeaf` 可先廉价判断 cluster 变化，再决定完整查询。

调用方必须尊重 **allVisible**，或始终使用两个可见性 helper。完全损坏数据的索引没有可枚举的全部 ID，返回空数组但 `allVisible=true`，不能把空集合解释成全隐藏。未知 face/prop ID、动态 brush、缺关联均常显；无 cluster、坏相机、原 world 范围外、坏索引、坏 PVS、自环都保守常显。点恰好位于划分平面时，寻叶确定地取前侧，但最终全显；这是显式数值边界策略，不宣称原闭源引擎 tie 规则。

父任务新增的 `dust2-lightmapped/world.glb` 在 `TEXCOORD_2.x` 保存每角点的原 face ID；Three 中是 `geometry.attributes.uv2`。只有同一三角形三角点都为同一个有效整数 ID，才能按其 face 过滤。缺属性、不一致或未知 ID 的三角形常显。`props.glb` 原 anchor 名 `static_prop_<原sprp index>` 且含 `sourceModel/sourceSkin/sourceSolid` extras，过滤 anchor 时保留其全部 mesh parts 和变换。

## 已完成验证及边界

独立 TS 解码器不调用 Python 函数，也不使用提取器的 offset receipt，而从保留的原 VIS bytes 重新读取每行偏移。1,795 行与 JSON base64 完全相等。原 30 个出生点 origin 与 Source Z+64 诊断 eye 共 60 次，Python/TS leaf、cluster、完整 face IDs、prop IDs 逐项相等。14/14 tests 与全项目 tsc 通过。

当前 eye64 采样：15 个 T 点分布在 clusters 1526/1537/1555/1564/1695/1696，可见 world faces 4,526–5,905，props 882–1,478；15 个 CT 点为 clusters 449/450，faces 1,586–2,110，props 560–891。一次记录准备耗时 26.02 ms、60 次平均查询 0.191 ms（CPU 单次记录，非帧率或稳定 benchmark）。准确逐点值见 `verification.json`。

本模块只计算保守 PVS。没有实现 frustum、动态 areaportal 状态、occluder、逐三角遮挡或原 3D sky pass，不会按距离删道具。派生位移包围盒可能增加过度绘制。可见 face 候选不是最终渲染面数，很多原 tools/sky portal 已由原导出流程排除；新 HDR GLB 几何和原 face ID 的独立回读由父任务负责。本阶段也不把 CPU 可见集合通过等同于移动视角的浏览器视觉验收。

## 私有 Three 预览适配层

新增 `scripts/preview-source-visibility.ts`、`scripts/build-source-visibility-preview.mjs`、`scripts/validate-preview-source-visibility.ts`、`tests/preview-source-visibility.test.ts`。没有修改预览 HTML、原 GLB、游戏 scene/runtime/public。构建输出位于私有 `visibility/preview-source-visibility.js`，16,592 bytes，SHA-256 `676d2870196b018cceef24be395d3aaff1e00658ee04047ca26ff9d19d8cc3c9`。`three` 保持 external，直接复用当前预览器的 import map，不载入第二份 Three。

```js
import { createSourceVisibilityPreview } from
  '/assets/source-exports/dust2/visibility/preview-source-visibility.js';
const pvs = createSourceVisibilityPreview({
  world: worldGltf.scene,
  props: propsGltf.scene,
  data: await fetch('/assets/source-exports/dust2/visibility/visibility.json').then(r => r.json()),
});
// 在完成材质适配和原始 visibility 设置后创建；每次 render 之前：
camera.getWorldPosition(cameraWorldPosition);
const stats = pvs.update(cameraWorldPosition); // 第二参数 false 临时关闭 PVS
// 切换模型/清理场景之前：
pvs.dispose();
```

有效 cluster 未变化时只进行寻叶，不重新扫描 30 万三角形或 3,158 道具。跨 cluster 才把保留的原三角形逐个复制到独立动态 index buffer，保留原索引值、绕序、重复/反向三角形、原材质分组顺序与 drawRange。全部顶点 attributes（包括 normal/base UV/lightmap UV/face ID）、材质对象、extras 和完整原 bounds 共享原对象，不做 remap、合并、重算法线、贴图处理或距离规则。零三角 primitive 隐藏，其余保持原材质 draw；props 仅改变准确原 anchor 的 visible，不改变子 mesh 或变换。关闭 PVS、无效位置或释放时恢复原 geometry 引用与原 visible 值。

未知 face 的单个三角形常显；没有 face 属性、非索引/不支持 topology 的整 mesh 保留；缺 sourceModel 的 prop anchor、重复或越界 ID 都不隐藏。原先隐藏的对象不会被开启。`stats.worldTriangles/worldVisibleTriangles` 只统计已绑定可过滤的 mesh，`worldAlwaysMeshes` 另报不支持的常显 mesh，避免把其未计数三角形误称为消失。当前真实 world 85 个 primitive 全部可绑定，无常显未知 mesh，3,158 prop anchors 全部精确且唯一。

```sh
node scripts/build-source-visibility-preview.mjs
npx tsx scripts/validate-preview-source-visibility.ts
npx vitest run tests/preview-source-visibility.test.ts tests/source-visibility.test.ts
npx tsc --noEmit
```

以上实际执行通过：20/20 tests，全项目 tsc 通过。CPU 独立读回采用父任务修正后的 HDR world SHA `91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8`，以及原 props SHA `55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232`。共 60 次切换，检查 18,138,420 个原三角形；每个保留角点共 18,292,392 个 index 值与原 GLB accessor 逐项相等。所有 world 原 attributes 保持同一对象，所有 prop accessor bytes、材料 JSON、extras、节点矩阵在查询和恢复后保持不变。每个原 prop anchor 的显示状态逐个与独立 Python fixtures 比较，不以适配层自身输出自证。证据为 `preview-verification.json`。

原 world 302,307 triangles；30 个 eye64 样本下 CT 保留 42,520–59,192 triangles，T 保留 123,810–164,557 triangles。props 候选仍为 CT 560–891、T 882–1,478。一次 CPU 记录准备 41.58 ms，11 次改变 cluster 时 apply 平均 1.52 ms、最大 4.58 ms，49 次同 cluster 寻叶平均 0.024 ms。这不包含 WebGL 提交、纹理解码、frustum 后 draw calls 或 GPU 帧成本，实际浏览器验证由父任务接续。

父任务同时发现旧 SourceIO 位移起始角 `np.isclose` 的相对容差误命中，已修 575 faces；本次适配验证使用上面的修正后 world。此前旧 world meshopt 输出仍只是对其旧输入 bytes 的无损压缩证明，不能称旧输入的原几何全部正确。

### T 出生点画面差异的有限定位

父任务实际 GPU 开关记录 `output/playwright/dust2-pvs-gpu.json`：CT draw 610→377、triangles 1,275,996→758,458，截图 bytes 一致；T draw 2,333→1,006、triangles 4,133,301→1,867,987，6,206 个像素差异集中在远处悬空几何区域。此处另以 `scripts/trace-source-pvs-pixels.ts` 对原 GLB 做 CPU 射线定位，未操作浏览器或更改预览器。

准确使用 T 首出生点、Source Z+64、fov75、1280/720、原 forward。相机 leaf2478/cluster1555；按左上坐标像素中心射线：(100,145) 命中 sprp85、原 clusters1766/1765；(70,155) 命中 sprp635、cluster1770；(145,152) 命中 worldspawn face8660、clusters1764/1767；(320,201) 命中 worldspawn face8391、cluster1756。以上原关联 cluster 在相机 PVS 行均为 bit0，距离 296–345 m，开启 PVS 后均无几何命中。原 BSP `arena2-script` 使用 `warmup/warmup_arena.nut`，其相关 `arena2-ctspawn/tspawn` 与前 3 个命中位置相邻；最后一个邻 `arena1-tspawn` 和 `arena1-warmup.arena_trigger.t`。因此这些样本有原 PVS bit 与原暖身实体的空间证据，不仅是看图判断。

中央 (640,360) 两次均命中 face6437/cluster1555，点位完全相等。(290,200) 两次均无几何命中，不构成差异定位证据。世界面实体归属仍为 worldspawn model0；sprp 是独立原记录，不重指派为某个暖身 entity。射线使用原 glTF doubleSided，但不采样 alpha-test 贴图，且未覆盖全部 6,206 像素，不能据此声称全视角或全差异像素验收。详细 source coordinates、模型、最近原命名实体和 bit 值见私有 `visibility/pixel-raycast.json`。

## 原始参考

[Valve Source SDK 固定版本 bspfile.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/bspfile.h) 提供 nodes/leaves、dvis、face 和 displacement 布局参考；[bsplib.cpp 的 DecompressVis](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/utils/common/bsplib.cpp) 提供 RLE 语义；[gamebspfile.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/gamebspfile.h) 提供 static prop leaf list 结构参考。SDK 2013 与 CS:GO BSP 21 并非同一完整实现；实际 CSGO sprp v11/80-byte 布局同时核对固定本地 SourceIO `cfc2591d096628a35f570aa830ab75cc8665108b` 的 `static_prop_lump.py`，并对原 byte 长度、索引、实例表交叉检查。原包是本次数据事实的直接依据。
