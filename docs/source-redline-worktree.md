# 原 AK Redline 合成执行链（候选）

2026-09-09 后续校正：原成功 clone 先将 intensity `10 / AK boost 2` 截断为 `5`，再格式化为 `0.019608`；运行时输出已改为颜色 1024、指数 256。原 shader 写色状态、物理 RT / 最终 VTF 分配及压缩格式另见 [输出契约增量](source-redline-render-contract-worktree.md)，clone / 后续 Phong 依据见 [Phong 增量](source-redline-phong-worktree.md)。下文早期 2048 图像与显式整数 10 探针是历史候选，不再代表当前参数。

本轮从 `1c21fffeb5189c3dcda484c552aa9696675e9b17` 开始，只新增独立模块、探针、测试和本文档。主 UI、skins、assets、场景、服务与原 Redline 输入均未改动。

原报告缺少的可执行 shader 已从 **platform/platform_pak01_dir.vpk** 找到；它不在之前检过的 csgo/pak01 中。当前已运行原 style7 的颜色和指数两路程序，实际消费 AO、磨损、底色、脏污、pattern 与原指数图，输出可重复的完整候选。没有把 pattern 直接当成最终贴图。

## 原程序与原生边界

原安装 App740 build12426148，所有 ELF / VCS / DX9 SHA 在 `.reference-assets/source-exports/ak47-redline-programs/evidence.json` 和 `client-parameters.json`。

| 程序 | static / dynamic | 字节数 | SHA256 |
| --- | --- | --- | --- |
| customweapon_ps30 颜色 | 7 / 0 | 1644 | fbd03afa4cc074434791bc3cd8078fea0c7d1933d7b7aa995cd7d7e538ee1ba3 |
| customweapon_ps30 指数 | 17 / 0 | 972 | 9fcf95e92c2694fdb89b80d3b5b6a64896b92bfd274b9df3f8d439e4a6fdeb21 |
| customweapon_vs30 UV | 0 / 0 | 660 | a7a1292388e6ed94c36c86f90358b4422815f0ebeefe4bcccd2f301452891a28 |

独立原始 x64 指令通过 Unicorn 有界执行，不调用引擎或操作系统：

- stdshader `0x65c3e…0x65cb1`：216 组实际 selector。非预览 style7 选 7，指数模式选 17；phong albedo factor 分支的 167/177 是原 VCS 对 7/17 的别名。
- stdshader `0x666d7…0x667d6`，含原 `0x678f0` 分支：48 组实际 c3 上传命令，内容为 `[1, materialPhongExponent, materialPhongIntensity, materialWear]`。
- 原 6 个纹理 bind command writer 实际输出 sampler 和 bit31。颜色空间不是按纹理文件名推断。s0 AO、s3 底色、s5 脏污、s8 pattern 使用 sRGB 读取；s1 磨损、s2 指数线性读取。
- client `0xf52458…0xf5248a`、`0xf524a1…0xf524d2`：512 组显式整数参数浮点换算，乘原 `0x1936e9c` 的 float32(1/255)，原格式字面量是 `%f`。早期探针输入 150 / 10 对应 `0.588235` / `0.039216`；真实 clone 上游先把 10 改为 5，当前真实材料值改用 `0.019608`。
- client `0xf52260…0xf5226c`：8 组显式磨损参数浮点传递；这不是库存 wear remap 的证明。
- client `0xf522b1…0xf5240a` 的三个格式化前片段：54 组 UV 参数值。原格式是 `scale %.2f %.2f translate %.2f %.2f rotate %.2f`；捕获了 ignore_weapon_size_scale 的实际分支。尚未执行其上游 seed RNG 初始化及下游材料字符串到矩阵解析。

色彩路径原 CTAB 只声明 s0/1/3/5/8，指数只声明 s0/1/2/8。style7 的这两个所选程序不消费 masks、surface 或 position 图；具体通道选择来自原 token。

## 可运行模块

- `game/source-redline-program-data.ts`：原始 token 与 SHA，脚本生成。
- `game/source-redline-program.ts`：保留原 swizzle、mask、saturate、常量原浮点位的 GLSL 转译；未知指令拒绝。没有手写另一套美术调色公式。
- `game/source-redline-parameters.ts`：原 client 的 Phong 换算及显式材料 wear 文本精度。
- `game/source-redline-compositor.ts`：独立 WebGL2 所有权。固定原输入 receipt SHA；6 个 PNG SHA、解码后 GPU RGBA SHA 均检查；输出颜色和指数 RGBA、SHA。完成后调用 `dispose()`，拒绝销毁后调用及并发 compose。

调用示例（显式单位矩阵只是候选参数，不代表某个 seed）：

```ts
const owner = await createSourceRedlineCompositor({
  inputBaseURL: '/assets/source-exports/ak47-redline-inputs/',
});
const identity = [[1, 0, 0, 0], [0, 1, 0, 0]] as const;
try {
  const maps = await owner.compose({
    ...SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS,
    wear: sourceRedlineWearMaterialValue(0.4),
    pattern: identity,
    wearTransform: identity,
    grunge: identity,
  }, 1024);
  // maps.color.rgba / maps.exponent.rgba 含原 shader 全部四通道。
} finally {
  owner.dispose();
}
```

颜色 alpha 是原反光数据，不能直接当透明度，也不能用普通 Canvas PNG 导出造成 RGB 预乘精度损失。`scripts/export-source-redline-candidate.py` 从 GPU 原始 RGBA8 下载结果无损写 PNG 并逐字节回读核对。

## 实际验证与产物

- 原字节码由独立 Python 寄存器解释器求值，与浏览器 WebGL2 float target 对照 **192 组 × 2 路**。两路实际最大绝对误差均 **0**，glError **0**。合成器的 GLSL 与 Python 各自解析原 token；探针给显式采样值，不能替代原 D3D 纹理过滤验证。
- 6 个原 PNG 共 19,943,897 字节，GPU 上传后解码 RGBA 全部和原提取 receipt 相等。
- 1024²、显式单位矩阵、wear 0.1/0.4/0.7，各重复两次，两路 SHA 分别相同；三个 wear 对两路均产生不同结果。销毁后的 draw 被拒绝。
- `tests/source-redline-program.test.ts`：4 项通过；检查原程序 SHA / 全部指令保真、512 个原参数对照、原 CTAB / bind、非法标量。
- `npm run typecheck` 通过。
- `output/redline/gpu.json`、`composite.json` 是本轮实际浏览器结果；`composite-preview.png` 是亲自查看过的原 AK 几何预览。显示原合成颜色 RGB 与指数 RGB，枪体用无光照材质作贴图诊断。
- `.reference-assets/source-exports/ak47-redline-candidate/candidate.json` 加 6 个无损 PNG，manifest SHA **8fc6c9f87e2ecba6b6f9e96a21467719c0114a219e5c3c9a8c8cdd59ff5092fc**。

输入目录 `.reference-assets/source-exports/ak47-redline-inputs/` 是既有原始提取，本轮未改。集成时另复制 `ak47-redline-programs/`（原始程序和 native/oracle receipts，目标测试需要）与可选 `ak47-redline-candidate/`。不必复制完整游戏、旧工作树或 shared 文件。

## 复现

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-redline-programs.py
.tools/source-binary-venv/bin/python scripts/probe-source-redline-client-parameters.py
python3 scripts/export-source-redline-program-data.py
.tools/source-binary-venv/bin/python scripts/probe-source-redline-token-oracle.py
npx vitest run tests/source-redline-program.test.ts
npm run typecheck
```

将 `scripts/probe-source-redline-gpu.ts` 与 `scripts/probe-source-redline-composite.ts` 分别用现有 esbuild bundle 到浏览器可访问位置，然后调用导出的 `probeSourceRedlineGPU(oracleJSON)` 与 `probeSourceRedlineComposite('/assets/source-exports/')`。现存私有 27023 仅服务本工作树。本轮自动化记录在 `output/redline/*.pw.js`，浏览器 session 为 `redline-program`。`export-source-redline-candidate.py` 使用已有含 Pillow 的 Python runtime，无需安装依赖。

## 尚未关闭的真实边界

1. **原 seed → wear/grunge 变换**及原字符串 → 2×4 矩阵未独立执行。示例和候选 manifest 明示单位矩阵。原 client builder 已定位在 `0xf52040`，输入对象 `+0xa08..+0xa14` 为 pattern 的 scale/offsetX/offsetY/rotation，`+0xa18..+0xa24` wear，`+0xa28..+0xa34` grunge，可从这些字段上游继续查初始化。
2. **输出颜色格式**当前 color=WebGL SRGB8_ALPHA8，exponent=RGBA8。原 shadow `0x65d3a…0x65d55` 向 vtable+0x98 传 `(!exponentMode)||preview`，但本轮未独立绑定该虚函数的原类型身份；全链原客户端输出仍未对照。
3. 明确选 **mip0 双线性**；原 D3D mip/filter、量化/融合精度、最终分辨率尚未逐项对照。当前同参数重现是当前 WebGL 实现的实测，未承诺所有 GPU 位级一致。
4. 原库存 wear remap、完整 VertexLitGeneric 的原 AK 光照/反光及最终 UI/LAN 装备同步不属于本独立模块验证。预览 MeshBasicMaterial 不能当成最终光照验收。

因此状态仍是 **可执行原 style7 合成候选**。本轮已跨过“没有可执行合成公式”的旧阻碍，但不能标成“原 Redline 已完整一致”。

## 后续增量：固定 seed 输入（基线 e510d4e）

`game/source-redline-seed.ts` 新增明确的主 UI 输入接口：

```ts
const parameters = sourceRedlineSkinParameters({
  paintKitId: 282,
  seed: 422, // 当前验证的 UI 范围是整数 0..1000。
  wear: 0.4, // 已经是 Redline .1.. .7 内的实际磨损值，不是归一化滑块比例。
});
const maps = await compositor.compose(parameters, 1024);
```

拒绝其它 paint kit、非法 seed 或 wear；不静默裁剪或第二次 remap。UI 如使用 0..1 滑块，应在自己的控件中明确映射为 .1.. .7，传入这里的值就是库存实际 wear。`parameters.sourceInput`、`sourceUVFields`、`parameterEvidence` 可保留用于重放；底层 compositor 仍接受显式矩阵，因此其原有 `seedMappingVerified:false` 不自动升级，全链严格边界不变。

原生证据新增 `.reference-assets/source-exports/ak47-redline-programs/seed-uv.json`：

- client 原 schema 字段名 xref `0xd1411d…0xd141db` 及字段写入 `0xec…0x104` 已逐项核对；fixture 直接取既有原 paint kit 282 记录。
- client `0xf53365…0xf53391` 的 9 组原 descriptor 拷贝，paint kit / seed / wear 原样进入材质实例。`0xf52d5c/0xf52d7e` 把实际 wear 送入后续 shader 材料值；没有这里再做 wear_remap。
- client `0xf52dad…0xf52f38` 原调用序列，连接原 64 位 `libvstdlib_client.so` 的完整构造、SetSeed、GenerateRandomNumber、RandomFloat。仅隔离线程 ID 为显式 1；RNG 算术及原 mutex 无竞争路径均执行原代码。
- 必须先消费 **3 次** pattern 随机数，即使 Redline 三个区间都是 0。随后 wear、grunge 各消费 4 次：scale 原范围 **float32(1.6)..float32(1.8)**、offsetX/Y 0..1、rotation 0..360。不是 VMT 预览的固定 2.1，也不使用步枪散布的 seed+1。原行为中 seed 0 与 1 等价。
- 固定 seed 各自接着执行原 client 的三个格式化前片段，校验原实参，与原 `%.2f` 五项格式对应。
- materialsystem **五项格式专用分支** `0x327aa…0x3291a` 连同原矩阵构造/乘法函数实际执行。不能替换为通用 Three UV pivot 算法；原第二个平移分量依赖已经更新的第一个分量，代码保留了这个顺序。
- stdshader 从实际矩阵前两行提取并发出 c48/c50/c52 的原 3 条常量命令，1004 × 3 组通过，另有 3 组非对称矩阵作为行列顺序诊断。
- **1004 组 seed**（全部 0..1000，另含 -1、INT32_MAX、INT32_MIN）原 RNG 序列通过。全部 1001 个 UI seed 的字段、两位文本结果所对应矩阵与便携实现比较，最大误差 **0**。UI 范围是我们的经过完整测试的输入契约，不声称原引擎只接受该范围。

仍需明确：`sscanf`/格式化与 `sincosf` 是宿主 ABI 边界；原 glibc 没有随本安装提供，未声称执行原 Linux libm。原 64 位函数与便携实现两侧都公开该边界。当前 seed 算法与矩阵计算已独立执行对照；原客户端最终像素、D3D 过滤/量化、最终武器光照仍未验收，也没有调颜色补差。

真实浏览器已用 **seed 0 / 422 / 1000、wear 0.4** 各合成两次。原六张输入 SHA 与 GPU RGBA 再验证，两路输出均稳定重现、三个 seed 的结果不同；预览实际读取 `sourceRedlineSkinParameters`。证据 `output/redline/seed-composite.json`、`seed-composite-preview.png`，原 RGBA 下载后无损 PNG 在 `ak47-redline-seed-candidate/`，旧单位矩阵候选目录保留。

复现增加：

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-redline-seeds.py
npx vitest run tests/source-redline-program.test.ts tests/source-redline-seed.test.ts
```

浏览器入口沿用 `probeSourceRedlineComposite(baseURL, [{paintKitId:282,seed:0,wear:.4}, ...])`。无第二参数仍保留旧单位矩阵诊断。导出使用已有 `scripts/export-source-redline-candidate.py --seed`，从 `output/redline/seed-composite.json` 与下载 RGBA8 生成独立新目录。

本增量最终目标检查：2 个测试文件 **8 项通过**，类型检查通过。`seed-uv.json` SHA256 为 `456c5b2b6917838c214ea094520aeb78a6c1541715ac3b75fdab7e590594dfa0`（7,031,703 字节）；固定 seed 候选 `candidate.json` SHA256 为 `98f714e6b7ea5b923952b510df884ceab4d2f809a47fef6731ad5cb844ea13fc`。

## 后续增量：FP / world 材质所有者（基线 1cd6063）

新增 `game/source-redline-finish.ts`，主入口接线如下：

```ts
const redline = await createSourceRedlineFinishOwner({
  inputBaseURL: '/source/csgo-12426148/redline-inputs/', // 保留末尾斜线。
  signal: assetLoadAbort.signal,
});
await redline.apply(firstPersonAK, { weapon: 'vandal', paintKitId: 282, seed: 422, wear: .4 });
await redline.apply(worldAK, { weapon: 'vandal', paintKitId: 282, seed: 422, wear: .4 });
await redline.apply(firstPersonAK, null); // 立即恢复该 root 的原默认材质。
redline.releaseRoot(worldAK); // 先还原，再调用原人物/世界枪 owner 的销毁方法。
redline.dispose(); // 还原其余 roots；释放自有 compositor、纹理、材质，幂等。
```

`SourceWeaponFinish` 类型由主任务 `game/source-weapon-finish.ts` 所有，本工作树只导入，不提交该类型文件。本次只交付 owner、新独立测试、新 GPU probe 和本文档四个文件；UI、网络、asset staging 仍由主任务接线。

行为契约：

- 每个 owner 一份经过原输入 SHA 验证的 WebGL2 compositor，生成队列串行。`sourceRedlineSkinParameters` 把原 seed/wear 转成原矩阵和材质参数，固定生成 **2048²** color + exponent。
- 输出直接用 `readPixels` RGBA 创建 `DataTexture`，颜色 SRGB、指数 NoColorSpace，`flipY=false` / `premultiplyAlpha=false`。颜色 alpha 保留为原反光通道，不经 Canvas PNG 或伪透明。沿用现有 AK runtime 的 RepeatWrapping、anisotropy=8，使用 WebGL 生成 mipmaps 和线性 mip 插值。**该输出采样配置是当前运行契约，原 D3D 最终采样仍未对照。**
- 只替换精确名 `Source_AK47_VertexLitGeneric` 的 mesh 材质/数组槽；源材质对象与源数组借用并保留原引用。未发现 AK 槽的 root 不生成资源；其它枪械、手臂、人物槽不改。
- FP 与 world 的相同规范化 seed/wear 共享同一个 `createSourceAKMaterial` 与两张 DataTexture。当前活跃 root/pending 请求持有 lease；已完成但没有使用者的条目立即销毁，不保存所有历史皮肤。快速往返同一个仍在合成的参数可以复用；已排队但无人需要的任务跳过。
- 每个 root 有独立版本及状态身份。旧 promise 完成或失败均不能覆盖新选择；切换中的旧可见材质继续显示，当前生成失败则保留旧材质并 reject。`apply(null)` / `releaseRoot` 不等旧 GPU promise，立即恢复与取消；`dispose` 或 signal abort 后新 apply 被拒绝。
- root 不应重叠，发现已被此 owner 所有的 mesh 会明确拒绝。若外部系统替换了 mesh.material，恢复操作尊重该外部赋值，不强行覆盖。
- `material.userData.sourceFinish` 提供已合成的参数；`sourceFinishEvidence` 含两张 RGBA SHA、尺寸、seed 参数依据和 `originalClientOutputCompared:false`。沿用 `createSourceAKMaterial` 的现有有界 Source Phong，不改 `source-materials.ts`。

实际验证：

- `tests/source-redline-finish.test.ts` **15 项通过**：原 AK 精确槽、直 RGBA 通道、真实 Phong exponent clone、FP/world 引用计数、A→B→A、旧结果/旧错误抑制、null/release/dispose/abort、失败恢复、历史资源释放、release 后同 root 同参数重新获取、其它枪和重叠 root、外部赋值保护。
- 加原 seed / shader / viewmodel owner 回归共 **4 文件 28 项通过**；`npm run typecheck` 通过。
- 独立审查未发现生命周期阻断问题；已落实采样参数和 release 后重新获取用例建议。
- `scripts/probe-source-redline-finish.ts` 在真实浏览器使用 **实际 `loadSourceTViewmodel`（原手臂/枪动画及材质）** 和原 world AK GLB。中性光下实际编译 `createSourceAKMaterial`，亲自看过默认、Redline、恢复默认五张预览。
- seed 422 / wear .4 的 2048² 输出：color SHA `084d761bc2193e28c0674026af31e01cc721038e36c322373e661a605778a49b`，exponent SHA `f663aee2c59ce16e9aa2f506c6430d8989f4dff3ff83b23bdad828094c3cd144`。FP/world 材质对象相同，**5 个非 AK 材质未变**。真实 renderer 纹理数 **17 → 19 → 17**，每 root 恢复和 stale request 抑制通过。合成/申请此例耗时 **37.5ms**，不含 compositor 输入加载初始化，不能当完整场景帧耗时。
- 证据在本工作树 `output/redline/finish-owner.json`、`finish-owner-preview.png`；浏览器 session `redline-program` 留在私有 27023 页面。当前页面无 shader 错误；此前不同 probe bundle 连续 import 出现的 Three multiple instances 提示通过重新加载隔离。

复现：将新 probe 用现有 esbuild bundle 为 `.reference-assets/source-exports/ak47-redline-programs/finish.js`，在同一私有服务器页面调用 `probeSourceRedlineFinish('/assets/source-exports/ak47-redline-inputs/', '/source/csgo-12426148/')`。它只使用工作树资产副本，主服务未启停，未修改主目录 public。可直接用 `output/redline/finish-owner.pw.js` 重放。

本次关闭的是“原参数合成结果 → 可取消、可共享、可恢复的真实 FP/world 材质 owner”。全链原客户端最终像素、D3D 过滤/量化和原场景最终光照仍属候选边界；主 UI / LAN 装备同步验收仍由主任务完成。
