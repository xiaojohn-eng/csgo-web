# 原版皮肤目录（paint kits）

本工程要复刻的是「皮肤一样」，因此皮肤这一列的**名单本身**也必须来自原作，而不是自造。
本页记录已入库的原版涂料套件目录：它从原装 `items_game.txt` 与两份原装本地化文件读出，
逐字段校验后入库，运行时按 SHA 校验加载。

## 它是什么，不是什么

**是**：6 把已实现武器在原作里**全部**可用涂装的真实名单，含原作自己的中英文名、原作
稀有度（含原作自己的中文标签）、原作 `style`、`pattern`、`seed`、磨损窗口、四色调色板、
凹陷/光泽参数，以及原作给该涂装解析出的 pattern/normal 贴图引用。

**不是**：原作**每张涂装的图案美术**。目前只有 AK 红线的图案（`cu_ak47_cobra`，kit 282）
由原 `style7` 着色器合成，其余涂装的图案绘制仍是未完成项（见下）。这条边界写进
`boundaries` 字段随数据一起交付，也写在 `docs/parity.md` 里。

## 数据来源与可追溯

入库脚本 `scripts/stage-source-paint-kits.py`，读 `research/source-items-catalog.json`
（该文件由 `scripts/inventory-source-items.py` 从原装读出，逐文件记录 SHA-256）。
脚本另外**重新读取**两份原装本地化文件并核对 `source-items-catalog.json` 里记录的
SHA-256 与字节数——稀有度标签因此是原作的，不是这里翻译的。

产物：`public/source/csgo-12426148/skins/paint-kits.json`（约 295 KB），
回执 `game/source-paint-kit-resources.json`（路径 / 字节数 / SHA-256）。
运行：`python3 scripts/stage-source-paint-kits.py`。

```json
PAINT_KITS {"weapons": 6, "finishes": 238, "distinctKits": 235, "ambiguousTextures": 29, "bytes": 301667}
```

## 覆盖

| 武器 | 涂装数 | 原作 style 分布 |
| --- | --- | --- |
| `weapon_ak47` | 45 | 2×6, 3×3, 5×1, **7×24**, 8×2, 9×9 |
| `weapon_m4a1` | 39 | 1×1, 2×6, 3×4, 5×2, **7×18**, 9×8 |
| `weapon_glock` | 45 | 1×4, 2×4, 3×1, 5×11, 6×3, **7×13**, 8×4, 9×5 |
| `weapon_usp_silencer` | 35 | 1×1, 2×5, 3×4, 5×5, **7×16**, 8×1, 9×3 |
| `weapon_deagle` | 35 | 1×1, 2×4, 3×1, 5×10, 6×2, **7×6**, 8×7, 9×4 |
| `weapon_awp` | 39 | 2×7, 3×2, 5×5, 6×1, **7×14**, 8×2, 9×8 |

`style 7` 是「整幅自定图案」那一类——也就是最经典的那批（红线、火神、二西莫夫、
霓虹骑士、野荷、阿努比斯军团……）。AK 有 24 张，这是把红线合成器泛化后能立刻兑现的最大一块。

**工厂状态**是原作的 kit 0（`default`），原作**从不**把它列进某把武器的涂装列表（它就是
「没有涂装」这个状态），因此本目录把它单独放在 `factory` 字段。校验器会把「涂装列表里
混进 kit 0」当成错误拒绝。

## 稀有度标签来自原作

本 build 的原装 `csgo_schinese.txt`（UTF-16LE）里的**武器**档位名与常见译法不同，
因此这里一律按原作读，不按记忆写。运行时可见的正是这一列：

| 档位 | 值 | 中文（原作） | 英文（原作） |
| --- | --- | --- | --- |
| `common` | 1 | 消费级 | Consumer Grade |
| `uncommon` | 2 | 工业级 | Industrial Grade |
| `rare` | 3 | 军规级 | Mil-Spec Grade |
| `mythical` | 4 | 受限 | Restricted |
| `legendary` | 5 | 保密 | Classified |
| `ancient` | 6 | 隐秘 | Covert |
| `immortal` | 7 | 违禁 | Contraband |

## 运行时读取

`game/source-paint-kits.ts`：

- `loadSourcePaintKits(baseUrl)` —— 取回入库字节，与 `game/source-paint-kit-resources.json`
  的**字节数与 SHA-256** 逐项核对，再交给下面的校验器。字节不符、HTTP 失败一律抛错。
- `validateSourcePaintKitCatalogue(document)` —— **纯**结构校验（从取回里分出来，好让结构
  规则能被单独测：取回的摘要闸门让手改过的文档根本走不到这一步，两道闸门都要有）。
- `sourcePaintKitFor(catalogue, weapon, id)` —— 按原作 id 取；id 不存在、不是字符串、
  或那把武器没有该涂装时，**返回工厂状态**，绝不返回别的涂装的资料。
- `sourcePaintKitExists(catalogue, weapon, id)` —— 那把武器是否真的提供该 id。
- `sourcePaintKitsForWeapon(catalogue, weapon)` —— 该武器的全部涂装，按原作顺序。

校验器拒绝的形态（都有单测）：

- 入库字节与回执不符、HTTP 非 200；
- `format` 不符、来自哪份安装的清单摘要不是摘要；
- 某张涂装的 `resolution` 与它的候选数自相矛盾（`unique` 却列了 2 个、
  `ambiguous` 只列 1 个、`unresolved` 却列了候选）；
- 涂装引用了目录里没有的稀有度档位；
- 一把武器的涂装列表里混进工厂状态，或同一个涂装出现两次；
- 调色板不是 3/4 分量、分量超出 0..255；
- 磨损窗口反向（`wearMaximum < wearMinimum`）；
- 工厂状态不是 kit 0、或名字不是 `default`。

## 原图案贴图

目录只解决「有哪些皮肤」；要把图案**画对**，还需要每张皮肤自己的图案贴图。

`scripts/extract-source-ak-patterns.py`（Blender + SourceIO）读取目录里每张涂装
**原作解析出的** pattern/normal 贴图路径，从原装字节里解出并**无损**存成 PNG；
`scripts/stage-source-ak-patterns.py`（纯 stdlib）把 PNG 拷进服务目录并写出
`game/source-ak-pattern-resources.json`。

```
AK_PATTERN_INPUTS {"finishes": 24, "textures": 30, "refused": 0, "bytesRead": 132827232}
AK_PATTERNS      {"textures": 30, "finishes": 24, "bytes": 119359267}
```

- **24 张 pattern + 6 张 normal = 30 张**，覆盖 AK **全部 24 张 style7** 涂装，没有一张被拒。
  尺寸只有 2048² 与 1024² 两档（原 VTF 为 DXT5/DXT1、11–12 级 mip），存成 PNG 后共 114 MB。
- **无损是验证过的，不是声明的**：另用一个独立的 stdlib PNG 解码器（逐扫描线做
  filter 反演）重解 30 张 PNG，与回执里的 `rgba8Sha256`**逐张相同**，PNG 自身的
  `pngSha256` 也相同，`mismatches 0`。
- **两遍独立抽取互相印证**：kit 282 的图案，一遍由 `extract-source-redline.py`
  作为「共享输入」抽出，一遍由本轮的 `extract-source-ak-patterns.py` 作为「图案」抽出，
  两次的 **PNG 摘要与解码后 RGBA 摘要完全相同**（`bdf95c6f…`）——两个脚本、两条路径、
  同一个字节。

抽取脚本读的是一份**已枚举**的清单（先算出 30 条路径、按 VPK 索引统计总字节再读），
因此它声明自己的读取上限（`enumerated + 32 MB`）而不是沿用目录探针的 96 MB 默认值；
`Sources.read_budget` 的默认值未改动。

## 一个由数据本身划出的边界：6 张带 normal 的涂装

原 style7 的两路着色器（`color` / `exponent`）**只声明 5 个采样器**：
`color` 读 `0,1,3,5,8`，`exponent` 读 `0,1,2,8`（见 `source-redline-program.ts` 与
`game/source-redline-program-data.ts` 里从原客户端 token 导出的程序）。**没有 normal 采样器。**

于是：24 张 style7 里 **18 张**（`180 282 300 302 316 340 341 380 422 474 490 506 600 724
801 1004 1141 1221`）可以走这条合成路径；另外 **6 张**（`707 836 941 959 1018 1143`）
在原作里还声明了 normal 贴图，**这条编译路径画不出它们**——它们的 normal 贴图已经抽出并入库，
但需要先导出那条带 normal 采样的程序变体才能合成。这是一个由原数据本身划出的边界，
不是实现取舍。

## 每个涂装真正不同的东西

查过全部 24 张 style7 的 `pattern_scale` / `pattern_offset_*` / `pattern_rotate_*`：
**24 张全部是 scale 1、偏移 0、旋转 0**。因此对这批涂装而言，`pattern` 的 UV 变换不是变量，
`[1,0,0,0]` 对每一张都成立；每张真正不同的是：

| 变量 | 来源 |
| --- | --- |
| pattern 贴图（采样器 8） | 该涂装自己的原图，见上 |
| `phongExponent` | 涂装自己的（如 282 = 150、506 = 255、341 = 4） |
| `phongIntensity` | 涂装自己的**除以武器自身的 phong boost 2 并截断**（282 的 10 → 5） |
| 磨损窗口 | 涂装自己的 `wear_remap_min/max`（282 = 0.1..0.7、506 = 0..0.67） |

武器级的值（`$phongboost 2`、AO/磨损/grunge/武器 albedo 五个采样器）对同一把武器的每张涂装都一样，
来自已验证的那份共享输入。**但武器级的值本身逐武器不同**（AK `phongalbedoboost 35`、M4A1 25），
因此它现在作为**数据**随调用传入（`SourceWeaponPhong`），而不是写死常量，见下节。
涂装若覆盖 `phongalbedoboost`（原作里 `-1` 表示「沿用武器的」），本路径**拒绝**而不是套用——
目录已经把该字段一起入库。

## 运行时

- `game/source-ak-patterns.ts`：`loadSourceAkPatterns(baseUrl)` 取回回执并按回执的
  字节数与 SHA-256 核对，再用 `validateSourceAkPatternReceipt`（**纯**函数，同样单独可测）
  校验其结构（`status` / `weapon` / `style` / 未拒任何涂装 / 有贴图 / 涂装数非零）。
  `sourceAkPatternFor(patterns, kitId)` 返回合成器要的 `SourceRedlinePatternInput`；
  某张涂装没有自己的图案时**抛错**，绝不用别的涂装的图顶上。
- `game/source-redline-compositor.ts`：新增**可选**的 `pattern` 入参。给了就用该涂装自己的
  图（并核对字节数、PNG 摘要、GPU 解码后的 RGBA 摘要、按 `vtfFlags` 定寻址方式）；
  不给就仍然用回执里那张——**因此已验证的红线合成逐字节不变**（既有测试一条未改即通过）。
- `game/source-redline-seed.ts`：`sourceRedlineSkinParameters(input, kit = SOURCE_REDLINE_KIT_282)`
  接受一张涂装的描述，按上表取值并强制该涂装**自己的磨损窗口**；kit 282 的默认路径与
  改动前**完全一致**（`phongExponent`/`phongIntensity`/`phongAlbedoFactor` 等于
  `SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS`）。pattern 变换改成读涂装自己的字段后，
  原先那三次 `randomFloat(0,0)` 仍然保留——它们**确实会消耗随机流**，是既有验证钉住的
  调用顺序，去掉会改变 wear/grunge 的抽取。

## 涂装驱动合成（已落地）

原合成器只认 kit 282；现在整条链路都按**涂装**驱动：

- `game/source-ak-finishes.ts`：`createSourceAkFinishResolver({catalogueBaseURL, patternBaseURL})` 把
  一个涂装 id 解析成它**自己的**数值（`SourceRedlineKit`）与**自己的**图案贴图
  （`SourceRedlinePatternInput`）。拒绝的三种情况各自说清原因：不是 AK 涂装、不是
  style 7（本移植实现的那条合成路径）、带 normal 贴图（现程序没有 normal 采样器）。
  `available()` 给出它接受的 id，与生成表一致。
- `game/source-redline-compositor.ts`：新增 `setPattern(input)`。合成器**一次只持有一张
  pattern**（换绑时释放上一张），因此切涂装不会让 GPU 纹理随涂装数量增长。
- `game/source-redline-finish.ts`：所有者按涂装解析、按 `id:seed:wear` 缓存，并把
  `sourceFinish.paintKitId` 与 `patternSourceMaterial/patternSha256` 写进材质证据。
- `game/source-finish-table.ts`（**生成**，`scripts/stage-source-paint-kits.py` 写出）：
  客户端与服务端共读的传输规则。每把可实现的武器各自可合成涂装的**原版磨损窗口**与原版中英文名
  都在里面，因此两边**不取任何东西**就能拒绝同一批值。测试拿它与目录逐项比对，防止漂移。
  （本页写这段时它只列 AK 的 18 张、文件还叫 `source-ak-finish-table.ts`；把 M4A1 接进来的
  那一轮把它改成按武器列出，见下文。）
- `components/skin-selector.tsx`：菜单列出**手里这把枪**的涂装，名字与稀有度用原作自己的；磨损滑块
  的上下限是**当前涂装自己的原始窗口**；切换涂装时把磨损夹进新涂装的窗口。

### 两个只有真机才会暴露的问题

1. **`patternBaseURL` 曾被回退到共享输入目录**。当合成器创建时没有传 `pattern`，
   `patternBase` 就退回成 `inputBaseURL`，于是 `setPattern` 会去
   `redline-inputs/` 里找涂装的图案贴图并 404。浏览器合成校验第一次跑就抓到了它。
2. **上传后的像素回读在“换绑”路径上不可靠**。合成器上报
   `GPU decoded pixels differ for … rubber_ak47.vtf`，而**同一张**贴图在独立序列里回读
   是完全一致的（30 张里抽查 8 张 pattern + 2 张共享输入全部 `match=true`）。根因是
   framebuffer 的 attachment 在换绑时会让读取看到上一个 attachment 或空内容，与贴图内容
   无关。因此现在的口径是：**加载路径（5 张武器级输入 + 初始 pattern）仍然逐像素回读校验**，
   **换绑路径改为校验字节数与 SHA、尺寸、GL 上传无错误，并用随后的合成结果本身来证明**——
   换绑不做像素回读的原因写在代码注释与这里，而不是悄悄去掉。

### 验收（两层）

- **浏览器合成**（`scripts/serve-source-finishes.mjs` + `scripts/run-playwright-source-finishes.mjs`）：
  真实浏览器里合成 **282 / 302 / 180** 三张涂装，每张都用**自己的**图案贴图（与入库
  回执的 SHA 相同）、自己的 Phong 值，产出**三张互不相同、非空**的 1024² 颜色图
  （不透明像素 777499 / 777499 / 803402）。产物 `output/playwright/source-finishes.png`
  与 `source-finishes-evidence.json`。
- **游戏内**（`scripts/run-playwright-source-finish-ingame.mjs`，真实浏览器 + 局域网服务）：
  在**武器库**里选 **火神**，武器上装备的材质的
  `patternSourceMaterial` 就是 `rubber_ak47.vtf`；再选**红线**得到**不同**的颜色图
  （`407e2f8b…` vs `36ebbec6…`）；在**同一磨损**下再次选回火神，颜色图与第一次**完全相同**
  （说明结果是涂装与参数的函数，而不是选择顺序的函数）。产物
  `output/playwright/source-finish-ingame.png`（画面里 AK 正是火神）与
  `source-finish-ingame-evidence.json`。

这个游戏内校验还抓到第三处问题：所有者创建合成器时**没有把 `patternBaseURL` 透传下去**，
于是任何非默认涂装都会以「需要 pattern base URL」被拒。类型检查发现不了它，只有真机点一遍才会。

## 每把武器自己的合成输入（已抽取入库，合成器已按武器驱动）

AK 那套输入当初是**为红线手写**的。`scripts/extract-source-kit-inputs.py` 把它变成**按武器**抽取，
而且路径**从原作自己的数据里发现**，不再手写：

- **定制目录**由原作 `items_game` 自己列的模型材质定：`weapon_ak47` 的
  `referencedModelMaterialFiles` 里有 `customization/rif_ak47/rif_ak47_decal_a.vmt`，于是根目录是
  `rif_ak47`。这条判据把 `rif_m4a1` 与 `rif_m4a1_s`（名字都含 `m4a1`）分得开——按名字猜是分不开的。
- 根目录还必须符合本 build 里每把武器共有的形状：同时存在 `<dir>/<dir>.vmt` 与 `<dir>/<dir>_ao.vtf`（共 52 个）。
- 五个采样输入、武器自身材质、Phong 值、以及每张 style7 涂装的 pattern/normal 贴图，全部按原作命名在同一根目录下取出。

**AK 的重新抽取本身就是一次交叉验证**：发现出来的角色与当初手写的完全一致
（`rif_ak47_ao` / `ak47` / `ak47_exponent` / `uvs/weapon_ak47`），Phong 也一致（`$phongboost 2`、
`$phongalbedoboost 35`）。武器材质里写的 `$basetexture` / `$phongexponenttexture` 必须与
发现出来的角色相符，否则拒绝——所以"角色"不是猜的。

| 武器 | 角色（采样输入） | `$phongboost` | `$phongalbedoboost` | style7 | 抽出贴图 | 原装未唯一定位 |
| --- | --- | --- | --- | --- | --- | --- |
| `weapon_ak47` | `rif_ak47_ao` / `ak47` / `ak47_exponent` / `weapon_ak47` | 2 | **35** | 24 | 36 | 0 |
| `weapon_m4a1` | `rif_m4a1_ao` / `rif_m4a1` / `rif_m4a1_exponent` / `weapon_m4a1` | 2 | **25** | 18 | 28 | 2（kit 155、993，pattern 引用不唯一） |

**武器级 Phong 值逐武器不同**（AK 35、M4A1 25），因此它是**数据**而不是常量。这一条正是
"合成器必须按武器驱动"的直接证据，已经兑现：`SourceWeaponPhong` 随每次合成传入，
`SOURCE_AK_WEAPON_PHONG` 只是 AK 那一侧的值（见下节）。

入库：`scripts/stage-source-kit-inputs.py <weapon>...` → `public/source/csgo-12426148/kit-inputs/<weapon>/`，
回执 `game/source-kit-input-resources.json`（每条含角色、采样器号、尺寸、`vtfFlags`、PNG 与解码后 RGBA 摘要）。

```
KIT_INPUTS {"weapons": {"weapon_m4a1": {"textures": 28, "bytes": 107561221,
             "refusedFinishes": ["155","993"], "phong": {"phongBoost": 2, "phongAlbedoBoost": 25}}},
            "entries": 29, "destination": "public/source/csgo-12426148/kit-inputs"}
```

- **无损逐张验证**：28 张入库 PNG 由独立的 stdlib PNG 解码器重解，PNG 摘要与解码后 RGBA 摘要
  **全部一致**，`mismatches 0`。
- **原装没唯一定位的涂装不被静默丢掉**：kit 155 / 993 的 pattern 引用在原装里不止一个候选，
  抽取器记为 `refusedFinishes` 并随回执入库；生成式涂装表**按构造**只列唯一解析的涂装，
  因此这两张永远不会出现在菜单里，解析器也会拒绝被点名索取。
- M4A1 可合成的涂装为 **10 张**（style 7、pattern 唯一、无 normal）：
  `215 X 射线 / 255 二西莫夫 / 309 咆哮 / 336 沙漠精英 / 384 狮鹫 / 400 龙王 / 449 波塞冬 /
  480 杀意大名 / 588 死寂空间 / 664 地狱烈焰`。

## 合成器按武器驱动（已落地）

原来 `SHARED_INPUTS` 与 `$phongalbedoboost 35` 写死在 AK 那一侧；现在两者都随调用传入，
因此同一份合成代码同时服务 AK 与 M4A1，而**已验证的红线路径逐字节不变**。

- `game/source-redline-seed.ts`：`sourceRedlineSkinParameters(input, kit, weapon = SOURCE_AK_WEAPON_PHONG)`。
  第三个参数是 `SourceWeaponPhong { phongBoost, phongAlbedoBoost }`：前者是涂装强度的**除数**，
  后者是合成**保留**的值。两者都校验为正整数。AK 的默认值就是原来的常量，
  因此 kit 282 的默认调用与改动前完全一致。
- `game/source-redline-compositor.ts`：新增 `weaponInputs`（`SourceKitWeaponInput[]`，每张自带
  **原程序自己的采样器号**）。给了它，就**完全不读** AK 的 `inputs.json` 回执——
  那份回执是另一把武器的；此时必须同时给出该涂装自己的 pattern。每个输入仍逐项校验
  （采样器范围、尺寸 ≤2048、字节数、16 进制摘要、路径不得越出服务目录），与回执路径同一口径。
- `game/source-kit-inputs.ts`（新）：`loadSourceKitWeapon(weapon, baseUrl)` 取回该武器的
  `inputs.json` 回执，与 `game/source-kit-input-resources.json` 的**字节数与 SHA-256** 核对，
  再按结构规则校验：五个角色（`ao/paintWear/weaponExponent/weaponAlbedo/gunGrunge`）**各恰好一张**、
  UV 图谱至多一张、恰好一份回执、`refusedFinishes` 与已入库 pattern 的涂装**不得重叠**。
  `patternFor(paintKitId)` 在某张涂装没有唯一图案时抛错，绝不用别的涂装的图顶上。
- `game/source-kit-finishes.ts`（新）：`createSourceKitFinishResolver({weapon, catalogueBaseURL, kitBaseURL})`
  是 AK 解析器的按武器对应物。`available()` 只给**既能合成、又有自己图案**的涂装。
- `game/source-ak-finishes.ts`：把「能不能合成」的三条判据抽成 `sourceComposableFinish(catalogue, weapon, id)`，
  **两个解析器共用**，因此它们拒绝的涂装集合与理由完全相同；不同的只是武器输入与 Phong 的来源。

### 验收（浏览器，两把武器同一页）

`scripts/serve-source-finishes.mjs`（同时挂 `/inputs/`、`/patterns/`、`/kit-inputs/`）+
`scripts/run-playwright-source-finishes.mjs` 在真实浏览器里合成 5 张涂装：

```
AK #282 elegantredv1.1.vtf albedo 35 color e76eba798ef0… opaque 777499
AK #302 rubber_ak47.vtf    albedo 35 color 04bbdcda6b5d… opaque 777499
AK #180 fireserpent_ak47.vtf albedo 35 color f5d23b2523ca… opaque 803402
M4 #309 howling_m4a1.vtf   albedo 25 color ffbe551acae2… opaque 680200
M4 #255 zone9_m4.vtf       albedo 25 color f593357d94c8… opaque 769574
```

断言的不只是"跑通了"：每张用的 pattern 贴图 SHA 与入库回执**相同**；AK 一律 35、M4A1 一律 25
（证明武器级 Phong 是**读出来的**，不是常量）；颜色图 1024²、exponent 256²；五张颜色图**互不相同**
且都非空；`available()` 在 M4A1 上恰好是那 10 张。

## 涂装按武器进入传输规则与菜单（已落地）

上面的合成还只是"能合成"；要让这 **65 张**（AK 18 / M4A1 10 / AWP 11 / Glock 9 / USP 14 / Deagle 3）真的能**选、能传输、能装上枪**，
还需要三件事。

### 生成表按武器列出

`game/source-finish-table.ts`（生成，替换原来的 `source-ak-finish-table.ts`）现在按**武器**列出：

```ts
export const SOURCE_FINISH_WEAPONS = [
  Object.freeze({ id: "vandal", originalWeapon: "weapon_ak47",         inputSource: "verified-receipt" }),
  Object.freeze({ id: "m4a4",   originalWeapon: "weapon_m4a1",         inputSource: "staged-kit-inputs" }),
  Object.freeze({ id: "awp",    originalWeapon: "weapon_awp",          inputSource: "staged-kit-inputs" }),
  Object.freeze({ id: "glock",  originalWeapon: "weapon_glock",        inputSource: "staged-kit-inputs" }),
  Object.freeze({ id: "usp",    originalWeapon: "weapon_usp_silencer", inputSource: "staged-kit-inputs" }),
  Object.freeze({ id: "deagle", originalWeapon: "weapon_deagle",       inputSource: "staged-kit-inputs" }),
] as const;
export const SOURCE_FINISHES = { vandal: [/* 18 张 */], m4a4: [/* 10 张 */], awp: [/* 11 张 */],
  glock: [/* 9 张 */], usp: [/* 14 张 */], deagle: [/* 3 张 */] } as const;
```

- **port id → 原作武器的映射不是手写的第二份**，而是读已入库的
  `weapon-effects/effect-map.json` 的 `prefabs`（`m4a4 → weapon_m4a1_prefab`）。同一个事实只有一份。
- **只列输入已就位的武器**：AK 走已验证的 Redline 回执（`verified-receipt`），其余走自己那套
  入库输入（`staged-kit-inputs`）。**输入没抽取的武器整把不列**——把一把枪画不出来的涂装摆进菜单，
  比不摆更糟。生成日志会把它们单列出来：

```
PAINT_KITS_TABLE {"weapons": {"vandal": {"inputSource": "verified-receipt", "composable": 18, "ofFinishes": 45},
                              "m4a4": {"inputSource": "staged-kit-inputs", "composable": 10, "ofFinishes": 39},
                              "awp":  {"inputSource": "staged-kit-inputs", "composable": 11, "ofFinishes": 39},
                              "glock": {"inputSource": "staged-kit-inputs", "composable": 9, "ofFinishes": 45},
                              "usp":  {"inputSource": "staged-kit-inputs", "composable": 14, "ofFinishes": 35},
                              "deagle": {"inputSource": "staged-kit-inputs", "composable": 3, "ofFinishes": 35}},
                  "deferredNoStagedInputs": {}}
```

- 生成器还做一次**两路独立推导的交叉核对**：目录说这把枪能画哪些（style 7 + pattern 唯一 + 无 normal），
  与入库输入里实际带着 pattern 又没带 normal 的那些，**必须逐张相同**；不同就直接报错停下来。
  六把枪两边都逐张相同，`deferredNoStagedInputs` 因此是空的——**这个移植现在出的每一把枪都能画自己的原版涂装**。

### 武器级 Phong 值：三个值，三把枪里两把都不一样

`scripts/extract-source-kit-inputs.py` 从**每把枪自己的武器 VMT**里读三个值，同一个抽取器：
`$phongboost`（涂装强度的除数）、`$phongalbedoboost`（合成保留的反照率增益）、
`$phongfresnelranges`（Phong 项混合的三个菲涅尔档）。

| 武器 | `$phongboost` | `$phongalbedoboost` | `$phongfresnelranges` | 合成可画 |
| --- | --- | --- | --- | --- |
| `weapon_ak47` | 2 | 35 | `[.83 .83 1]` | 18 |
| `weapon_m4a1` | 2 | 25 | `[.83 .83 1]` | 10 |
| `weapon_awp` | 2 | 40 | **`[.8 .8 1]`** | 11 |
| `weapon_glock` | **1** | 35 | `[.83 .83 1]` | 9 |
| `weapon_usp_silencer` | **8** | **80** | `[.83 .83 1]` | 14 |
| `weapon_deagle` | **1** | 40 | **`[.8 .8 1]`** | 3 |

**六把枪里只有一个值完全相同**（步枪与 AWP 的 `$phongboost` 2）。除数从 1（Glock / Deagle）到
8（USP-S），反照率增益从 25 到 80，菲涅尔档两套。AK 那一列**印证了先前手写的常量**：
`2 / 35 / .83 .83 1` 与独立读出的完全一致（所以 AK 那侧保持常量是**有证据的常量**，不是猜的）。
USP 的 boost 8 是有实际后果的：一张涂装自己的强度要先**除以 8 再取整**，所以同一个强度值在两把枪上
得到的材质值不同。

### 传输规则按武器查表

`game/source-weapon-finish.ts` 的武器位从写死的 `vandal` 变成 `SOURCE_FINISH_WEAPONS` 里的 id 联合，
并且**磨损窗口按武器查**：同一个原作 id 在另一把枪上是另一张涂装，所以
`sourceFinishWearWindow(weapon, paintKitId)` 必须两把都对上才放行——
`{weapon:'m4a4', paintKitId:282}` 与 `{weapon:'vandal', paintKitId:309}` 都被拒。没抽取输入的武器
（Glock/AWP…）连武器位都不存在，因此它们任何涂装都传不出去。

### 菜单按手里的枪列

`components/skin-selector.tsx` 只列**当前所持武器**的涂装，并且只在选中的涂装属于这把枪时才把它显示为
"已装备"。`app/page.tsx` 改为**按武器各记一份**选择（原来的单份值仍会读，老选择不丢），
**每次换枪也重发一次**——所以线上传的那一个字段始终是"他手里这把枪上的涂装"，远端看到的因此是对的；
而玩家换回 AK 时 AK 的涂装会自己回来（不需要再点一次菜单）。**菜单卡片数**也成了可断言的证据：
各把枪分别是 19 / 11 / 12 / 10 / 15 / 4 张（各含 1 张工厂状态）。

### 验收（游戏内，六把枪同一局）

`scripts/run-playwright-source-finish-ingame.mjs`（真实浏览器 + 局域网服务，武器库菜单里点选）：

```
ORIGINAL FINISHES IN-GAME PASSED
  AK 火神 #302 vandal · rubber_ak47.vtf · albedo 35 · boost 2 · fresnel [0.83,0.83,1] · color 407e2f8b6945…
  AK 红线 #282 vandal · elegantredv1.1.vtf · albedo 35 · boost 2 · fresnel [0.83,0.83,1] · color 36ebbec61e1b…
  M4A1 咆哮 #309 m4a4 · howling_m4a1.vtf · albedo 25 · boost 2 · fresnel [0.83,0.83,1] · color ffbe551acae2…
  AWP 巨龙传说 #344 awp · dragon_awp.vtf · albedo 40 · boost 2 · fresnel [0.8,0.8,1] · color 98959d943f01…
  Glock-18 水灵 #353 glock · liquescent.vtf · albedo 35 · boost 1 · fresnel [0.83,0.83,1] · color 8a25d7eb2477…
  USP-S 守护者 #290 usp · usp-s_ct_elegant_update.vtf · albedo 80 · boost 8 · fresnel [0.83,0.83,1] · color 1ce7ec5393ff…
  Desert Eagle 阴谋者 #351 deagle · deagle_aureus.vtf · albedo 40 · boost 1 · fresnel [0.8,0.8,1] · color 172ff8631eaa…
  AK 火神（切回） #302 vandal · rubber_ak47.vtf · albedo 35 · boost 2 · fresnel [0.83,0.83,1] · color 407e2f8b6945…
```

断言的是：每把枪的菜单只给自己的那几张、点选之后枪上材质的 `patternSourceMaterial` 就是
**这张涂装自己的**贴图、**合成适配器用的是这把枪自己的三个 Phong 值**（boost 2/2/2/1/8/1，
albedo 35/25/40/35/80/40，菲涅尔两套），六把枪的颜色图**互不相同**，M4A1 的颜色图与浏览器级
合成校验的 `ffbe551acae2…` **逐位相同**（两条独立路径同一结果），而且**换回 AK 不碰菜单就恢复了
自己那张**、颜色图与第一次**完全相同**（说明结果只是涂装与参数的函数，不是点选顺序的函数）。

这个脚本自己抓到过一处只有真机会暴露的问题：**磨损输入框显示的是上一把枪那张涂装的磨损**，
所以"等磨损被下发"在换枪时会立刻成立，于是校验脚本会在一件都没合成之前就继续往下跑
（Deagle 因此看起来"没反应"）。改成先等**这把枪自己的涂装**真的装上，再动磨损输入框。

## 其他 style：缺口已经从"要重写别的着色器"缩小成三样输入

原先的记录是"其余涂装走别的原着色器路径，尚未实现"。现在这句话被查清了：
**它们不是另外的着色器，而是同一个 `CustomWeapon` 的另外几个 static 排列。**

原客户端的 selector 算术在既有探针里已经逐项断言过：
`combined = 5*style + 50*exponentMode + 200*preview + 400*(preview&&tint) + 800*(albedoFactor<1)`，
`static = combined // 5`；非预览、`albedoFactor ≥ 1` 时 **colour 排列 = style，exponent 排列 = style + 10**。
`scripts/probe-source-redline-style-programs.py` 因此把九个 style 的排列都从同一份官方
`customweapon_ps30.vcs` 编出来，并且**用已发布的 style 7 那对做对照**：
static 7 / 17 与既有导出**逐字节相同**（两个独立推导得到同一个程序）。

每个排列自己的 **CTAB 把纹理槽的名字写了出来**（不是按 style 名猜的）：

| 槽 | 名字 | 本移植是否已入库 |
| --- | --- | --- |
| s0 | `AOSampler` | 是（`ao`） |
| s1 | `ScratchesSampler` | 是（`paint_wear`） |
| s2 | `ExponentSampler` | 是（武器 `_exponent`） |
| s3 | `BaseSampler` | 是（武器 albedo） |
| s4 | **`MasksSampler`** | **否** |
| s5 | `GrungeSampler` | 是（`gun_grunge`） |
| s6 | **`NormalsSampler`** | **否** |
| s7 | **`OSPosSampler`** | **否** |
| s8 | `PatternSampler` | 是（涂装自己的图案） |

而 style 的名字来自原作自己的材质树 `paints/master.vmt` 的分组标题；同一份探针把它一起读了：

| style | 原作家族名 | colour 排列绑定 | exponent 排列 | 缺的输入 |
| --- | --- | --- | --- | --- |
| 1 | SOLID | `0,1,3,4,5` | 有 | `s4`=Masks；另有调色板常量 |
| 2 | HYDROGRAPHIC | `0,1,3,4,5,8` | 有 | `s4`=Masks；调色板 |
| 3 | SPRAYPAINT | `0,1,3,5,6,7,8` | **不存在** | `s6`=Normals、`s7`=OSPos；调色板；额外常量 |
| 4 | ANODIZED | `0,1,3,4,5` | 有 | `s4`=Masks；调色板（只用到 c0） |
| 5 | ANODIZED MULTI | `0,1,3,4,5,8` | 有 | `s4`=Masks；调色板 |
| 6 | ANODIZED AIRBRUSHED | `0,1,3,4,5,6,7,8` | **不存在** | `s4`+`s6`+`s7`；调色板；额外常量 |
| 7 | CUSTOM APPLIQUE | `0,1,3,5,8` | 有 | 无（本移植已实现） |
| 8 | ANTIQUED/PATINA | `0,1,3,4,5,8` | 有 | `s4`=Masks；调色板 |
| 9 | （`master.vmt` 里没有标题） | `0,1,3,4,5,8` | 有 | `s4`=Masks；调色板 |

两点是**只有真数据才会给出**的结论：

- **style 7 是唯一一个不读 `MasksSampler` 的 style。** 这解释了为什么它先前能单独跑通：
  本移植入库的五个武器级输入恰好就是它要的那五个（少一个不多一个）。
- **style 3 与 6 没有 exponent 排列**（`static 13` / `16` 在 VCS 里根本不存在），
  也就是说这两个 style 在原作里**不合成指数图**；它们还要 `NormalsSampler` + `OSPosSampler`，
  而那两个名字对应的原纹理本移植连角色都还没定。**所以这两条先不列。**

还差的一样东西不是纹理而是**常量**：非 style 7 的 colour 排列会在 CTAB 里声明
`g_cCamo0_camo3r` / `g_cCamo1_camo3g` / `g_cCamo2_camo3b`（就是涂装四色调色板的打包，c0..c2），
而本移植目前只上传了 `c3`（`$phong*` 与磨损那一组，来自已验证的原上传路径）与 `c48..`（三张 2×4 变换）。
**调色板的打包规则需要照 `c3` 那样从原客户端的机器码量出来，不能按常量名反推**——
这是打开除 style 7 以外任何 style 之前必须先做的一件事。

`scripts/probe-source-redline-sampler-slots.py` 另外回答了"引擎到底绑不绑这些槽"：
它在 stdshader 的代码范围里扫了 1712 个起点，要求控制流恰好走到 `起点+0x44`（已知六个写入器的长度），
把每个槽的 bind command 写手都跑了出来：

```
sampler 0 srgb True  at 0x67968 (= style-7 见证)
sampler 1 srgb False at 0x67c40 (=)   sampler 5 srgb True  at 0x67aa0 (=)
sampler 2 srgb False at 0x67bd8 (=)   sampler 6 srgb False at 0x67a38
sampler 3 srgb True  at 0x67b6f (=)   sampler 7 srgb False at 0x679d0
sampler 4 srgb False at 0x67b08       sampler 8 srgb True  at 0x661c1 (=)
```

已知六个被**原样重新量到**（对照通过），新增的 `s4/s6/s7` 都是线性读取——
与"它们是数据纹理（masks / pos）"一致，但**具体哪个槽是哪张纹理这里没有量**，
所以不写成结论。两份结果落在 `research/customweapon-style-programs.json` 与
`research/customweapon-sampler-slots.json`。

### 排列已经变成可运行的数据

同一份探针还把每个已发布排列写成运行时数据模块 `game/source-customweapon-programs.ts`
（每个 style × 每个 pass 一份 `{static, samplers, constants, tokens}`）。写它的时候顺手钉住了两件事：

- **DEF 字面量与 CTAB 参数从不重叠**（逐排列核对过：例如 style 2 的 colour 排列把 c4..c9 以
  `def` 写成字面量、把 c0..c2 声明成参数）。因此生成器只需把**CTAB 里声明的寄存器**声明成
  uniform（`c3` 例外，由调用方按已验证的上传路径写）。style 7 的 CTAB 只有 `c3`，所以它的 GLSL
  **一字未变**——新测试同时断言：style 7 的 token 与已发布程序逐字节相同、且它的 GLSL 里没有多出
  任何 `uniform vec4 cN;`。
- **翻译器能表达哪些排列**：style 1/2/4/5/7 目前可以翻译；**8/9 的 colour 排列用到 `rcp`/`rsq`，
  exponent 排列用到 `cmp`**；**3/6 还用到 `pow` 与 `dp2add`**。翻译器对这些**按操作码报错、不做部分
  应用**（新测试逐 style 断言错误里出现的就是不支持的那个操作码）。

### 调色板常量：打包不在着色器里（这是一次有对照的否定结果）

非 style 7 的 colour 排列都声明调色板参数（style 4 只用到 `c0`），而材质里有**四个**颜色
（客户端自己的字符串表里是 `$camocolor0..3`）。这个"四色 → 三常量"的打包必须量出来。
`scripts/probe-source-redline-palette-pack.py` 的做法是：把材质参数记录填成**哨兵值**
（记录 k 的第 j 个分量 = `2 + (16k+j)/256`，二进制精确且非零），在 stdshader 的参数代码窗口里
逐起点跑一遍，看哪些写手的输出里带着哨兵、以及每个哨兵来自哪条记录的第几个分量。

- **对照通过**：同一套装置拿已知的磨损/`phong` 常量写手（`0x666d7`）跑，输出正好是
  `[1, 哨兵(0,0), 哨兵(1,0), 哨兵(2,0)]`——与既有探针当年量到的 `(1, exponent, intensity, wear)`
  同一件事。也就是说这套装置确实就是量 c3 的那一套。
- **否定结果**：在 `0x63000..0x6a000`（约 28 KB，覆盖该写手及其邻居）里**没有任何起点**产出
  带调色板哨兵的常量。所以**打包不在这段着色器参数代码里**——它只可能在客户端
  （`$camocolor0..3` 就在客户端）或引擎的绑定层。这条把搜索范围缩小了，也说明"按常量名反推
  打包"这条路仍然是**没有证据**的。

再往下追了一层，得到的是范围更窄但仍然未闭合的结论：

- **客户端确实是把四色当字符串设进材质的**：`$camocolor0..3` 在客户端各只有一处引用
  （`0xf52120 / 0xf52180 / 0xf521e0 / 0xf52240`），四处形状完全相同——各自把
  `rbx+0x9c4/0x9c8/0x9cc`、`+0x9d0/…`、`+0x9dc/…`、`+0x9e8/…` 三组浮点乘同一个全局系数，
  再走同一个 `[%f %f %f]` 格式化（该格式串就在这些名字旁边）后写进对应变量。
  旁边还有 `CCamoMaterialProxy` / `CCamoTextureRegen` 两个类名。
- **但没有任何二进制含 `g_cCamo`/`cCamo`**（客户端与平台的 .so 全查过），`$camocolor*` 也只出现在客户端。
  也就是说：这四个材质变量与那三个着色器常量之间，**在这些二进制里不存在按名字的绑定**，
  而三个常量的 CTAB **也没有记默认值**（default 字段为空）。
- 所以"谁把 c0..c2 填上"仍未定位。剩下的候选是：引擎按 CTAB 寄存器号做的索引式上传，
  或者调色板被 `CCamoTextureRegen` 烘进了一张生成的贴图。**在这件事量出来之前，非 style 7 的
  涂装一律不列**——本移植不按常量名去猜一个打包。

### 四色的**来源与形态**已读出：根本没有打包（`scripts/probe-source-camo-palette.py`）

上一节把"四色 → 三常量"当成一条**待测的打包规则**。这轮把两个客户端函数读完，
发现**客户端这边不存在打包**：四色就是四色，原样上传。

- **谁把 `this+0x9c4…` 填上：`0xf52b90`（填表函数）**。它先 `memset(this+0x98, 0, 0xbac)`、
  把 `this+0xa00` 置 `1.0f`，然后 `call 0xd16bc0(schema, [this+0x18])` 按**套件序号**在
  客户端自己的 item schema 里取出套件记录（`0xced250` 是取 schema 的包装；`0xd16bc0` 是一张
  0x20 字节一条的查找表：键在 `+0x10`、对象在 `+0x18`）。调色板就来自那条记录：
  **`+0xbc / +0xc0 / +0xc4 / +0xc8` 四处、每处三字节 (r,g,b)、四处相隔 4 字节**（第四字节代码不读），
  每个字节 `cvtsi2ss` 成 0..255 的浮点，再存到 `this + 0x9c4 + 12i + {0,4,8}`。
  所以记录里是 `{r,g,b,pad}`、对象里是三个浮点，**中间没有任何重排**。
  同一个函数还抄了记录的另外几个字段（`+0xb8`→`+0x9bc`、`+0xe9`→`+0x9f8`、`+0xea-1`→`+0x9f4`、
  `+0xeb`→`+0x9fc`、`+0xec`→`+0xa08`、`+0x118`→`+0xc4c`）——**这些是套件的其余输入，已记下但未逐个定性**。
- **上传时的那个全局系数就是 `1/255`，按字节断言**：上传函数 `0xf52040` 里四处同形的
  `movss xmm5, [rip + …]` 指向 `.rodata` 的 `0x1936e9c`，四个字节是 `81 80 80 3b`——
  **正好是 `1/255` 的最近 float32**（`0.003921568859368563`），探针按**字节**比较而不是按小数比较。
  乘完之后走同一个 `[%f %f %f]` 格式化，写进 `$camocolor0..3`
  （四处 `lea` 分别在 `0xf52120`/`0xf52180`/`0xf521e0`/`0xf52240`）。
- **因此上一条"必须量出四色→三常量的打包"的说法撤回**：客户端侧**没有这条规则**。
  仍然没读出来的是**那四个材质变量与着色器的常量之间怎么对上**（`$camocolor*` 与那三个常量在任何
  二进制里都不按名字配对、CTAB 里也没有默认值），所以**哪个颜色进哪个常量**依旧未知，
  非 style 7 的涂装依旧不列——但卡点的性质变了：不是"一条未知的打包规则"，而是
  "一条引擎侧的绑定（很可能是按寄存器号）"。`research/source-camo-palette.json` 记这份读法，
  `tests/source-camo-palette.test.ts` 三条钉住它。

**同一个函数还是"一张涂装的材质块生成器"，于是每个 style 到底要哪些贴图不再是猜的。** 它按
`style` 分派：`style == 1` 走 `0xf52660`、`style == 0` 走 `0xf52540`、**其余（含 7）直接落到
`0xf520c1` 那段**；而两段 style 专用块**都以 `jmp 0xf520c1` 结束**——也就是说**四色与那几个
"涂装旋钮"对每个 style 都会写**，分派只决定"额外加哪些贴图"。逐对读出的变量与取值来源（`lea rdx`
紧跟 `lea rsi` + `SetString` 的形状，字面量会解析成它指向的文本）：

| 何时写 | 变量 | 取值来源 |
| --- | --- | --- |
| 分派之前（每个 style 都有） | `$aotexture` / `$weartexture` | `this+0x4a8` / `this+0xb3c` |
| 共享块（每个 style 都有） | `$camocolor0..3` | `[%f %f %f]`（上面那条 ×1/255） |
| 共享块 | `$wearprogress` / `$paintstyle` / `$phongalbedofactor` / `$phongintensity` / `$phongexponent` | `%f` / `%i` / `%f` / `%f` / `%f` |
| 共享块 | `$patterntexturetransform` / `$weartexturetransform` / `$grungetexturetransform` | `scale %.2f %.2f translate %.2f %.2f rotate %.2f` |
| style 0 块 | `$exponentmode` = `"0"`、`$baseTexture`←`this+0x98`、`$maskstexture`←`this+0x2a0`、`$grungetexture`←`this+0xa38` | 再按**套件自己的 style 字段**（`this+0x9bc`，由 `kit+0xb8` 抄来）开一个 switch：值为 3/6 时加 `$postexture`←`this+0x3a4` 与 `$surfacetexture`←`this+0x5ac`；4/5/6 时加 `$exptexture`←`this+0x19c`；2/3/5…8 时加 `$painttexture`←`this+0x6b0` |
| style 1 块 | `$exponentmode` = `"1"`、`$exptexture`←`this+0x19c` | 再用**位掩码 `0x2a4`** 测同一个 style 字段（选中 2/5/7/9）决定是否加 `$painttexture`←`this+0x6b0` 与 `$maskstexture`←`this+0x2a0` |

因此**"某张涂装要哪几张原贴图"已经可以逐 style 列出来**，取值都指向 `this` 上的字段（这些字段正是
上面那个填表函数从套件记录抄来的）。仍未读的是这些材质变量**如何进入程序的采样器与常量**
（`$maskstexture` 等与程序里那几个 sampler 名之间没有按名字的绑定可查），所以 147 张仍不列——
但"缺哪三张纹理"这个问题的形状已经变成"每个 style 各要哪几个变量"。

### 打包其实是**排列自己声明的**（`scripts/probe-source-camo-packing.ts`）

上面两条把"打包"当成了客户端要算的东西。查完发现**它不在客户端，而是每个排列自己声明的**——
也就是说这一步根本不需要量代码，只需要读那张声明表（仓库里已入库的
`.reference-assets/source-exports/customweapon-style-programs/evidence.json`）。

- **每个 style 的 colour 排列自己在 CTAB 里声明了三个调色板常量**：`c0 = g_cCamo0_camo3r`、
  `c1 = g_cCamo1_camo3g`、`c2 = g_cCamo2_camo3b`（style **1/2/3/5/6/8/9** 都是这三个）；
  **style 4 只声明 `c0`**；**style 7 一个都不声明**（两个 pass 都只有 `c3=g_fvPhongSettings_wear`）。
  任何 style 的 exponent 排列**都不声明**调色板常量。
- **名字本身就把排列说清了**：三个 float4 一共 12 个通道，正好是四色 × RGB——每个常量
  **xyz 放一个颜色、w 放第四个颜色的一个通道**（`camo3r`/`camo3g`/`camo3b`）。这不是"按常量名反推"，
  而是**排列自己给的声明**；而且探针用**本仓库自己的翻译器**把能翻的排列（1/2/4/5/7）逐条编译，
  核对**通道用法**与之一致：style 1/2/5 **把 `cN.xyzw` 与 `cN.wwww` 分开读**（所以 w 确实是另一个颜色的一个通道），
  style 4 只读整个向量，style 7 一个 camo 常量都不读。**这也解释了上一轮为什么在 style 7 附近找不到打包——
  style 7 的程序根本不通过调色板常量拿四色。**
- **三个没有入库角色的采样槽也一并定位**：排列的 CTAB 还给九个采样器起了名字
  （`0 AOSampler`、`1 ScratchesSampler`、`2 ExponentSampler`、`3 BaseSampler`、**`4 MasksSampler`**、
  `5 GrungeSampler`、**`6 NormalsSampler`**、**`7 OSPosSampler`**、`8 PatternSampler`），
  已入库的角色覆盖其中六个（`ao`/`paintWear`/`weaponExponent`/`weaponAlbedo`/`gunGrunge`/`pattern`），
  **没覆盖的正是 4/6/7**；而上一节的生成器给出了它们对应的材质变量名（`$maskstexture`、`$postexture` …）。
- 交付：`research/source-camo-packing.json`（九条声明、每个 style 的 camo 常量表、翻译器下的通道用法、
  三个未覆盖槽、以及"引擎那条填充路径未读但端口不需要它"的边界），`tests/source-camo-packing.test.ts`
  三条钉住它。**这两张贴图已经入库**（见本节末尾），剩下的只有 style 3/6/8/9 缺的操作码——打包本身不再是缺口。

**`_masks` 与 `_pos` 已经抽出并入库**（`roles` 加两条 → `ROLE_SAMPLERS` 加 `mask: 4`／`osPos: 7` →
`game/source-kit-inputs.ts` 把"入库角色"与"合成采样角色"分成两张表，前者七个、后者仍是五个，
所以 style 7 的绑定没有变），五把枪各重跑一遍抽取与入库：`weapon_awp` 26 条、`weapon_deagle` 18 条、
`weapon_glock` 26 条、`weapon_m4a1` 31 条、`weapon_usp_silencer` 27 条（清单共 128 条），
每把都带 `mask`(槽 4) 与 `osPos`(槽 7)。**菜单没有因此多出任何一张涂装**——`sourceComposableFinish`
仍按 style 与 normal 拒绝，只有 style 7 的完工图被入库，所以这次入库是"把缺的输入补齐"，
不是"把画不出来的东西列出来"。

**每个 style 到底缺哪张纹理，现在是一张表而不是三个"未知角色"。** 探针对每个排列的每个 pass 记下它
声明的采样器，并与已入库的六个角色对齐，得到：

| style | 缺的输入 |
| --- | --- |
| **7**（端口已能画） | **什么都不缺**——它声明的采样器是 0/1/2/3/5/8，全在已入库角色里。这正是它今天能跑起来的原因 |
| **1 / 2 / 4 / 5** | **只缺 `MasksSampler`（槽 4）**——而这四个 style 正是翻译器能干净翻译的那四个 |
| 8 / 9 | 只缺 `MasksSampler`（另有操作码缺口） |
| 3 / 6 | 缺 `NormalsSampler`（6）与 `OSPosSampler`（7） |

**而这些纹理的文件名与路径也已读出**：同一个填表函数在最后一段把八条路径逐条格式化进各自字段
（`snprintf` 形状，两个 `%s` 来自 `this+0x88` 上那一块 0x100 相隔的双字符串缓冲，由
`CustomWeapon` 构造函数（`0xf532d0`，对象大小 `0xc50`，类名字符串就在调用点）从第三个参数收下）：

| 字段 | 路径模板 | 角色/槽 |
| --- | --- | --- |
| `+0x98` | `models/weapons/v_models/%s/%s.vtf` | `weaponAlbedo` / 3 |
| `+0x19c` | `models/weapons/v_models/%s/%s_exponent.vtf` | `weaponExponent` / 2 |
| `+0x4a8` | `models/weapons/customization/%s/%s_ao.vtf` | `ao` / 0 |
| `+0x5ac` | `models/weapons/customization/%s/%s_surface.vtf` | （未被任何排列采样） |
| **`+0x2a0`** | `models/weapons/customization/%s/%s_masks.vtf` | **`MasksSampler` / 4** |
| **`+0x3a4`** | `models/weapons/customization/%s/%s_pos.vtf` | **`OSPosSampler` / 7** |
| `+0xa38` | `models/weapons/customization/shared/gun_grunge.vtf` | `gunGrunge` / 5 |
| `+0xb3c` | `models/weapons/customization/shared/paint_wear.vtf` | `paintWear` / 1 |

**这两个 `%s` 就是武器的模型目录名**——证据不是名字，而是入库清单里已有的那五条路径
（`customization/snip_awp/snip_awp_ao.png`、`v_models/snip_awp/awp_exponent.png` …）与同一模板逐字相符；
而 pak 里 **`_masks.vtf` 与 `_pos.vtf` 对端口覆盖的六把枪（`rif_ak47`/`rif_m4a1`/`snip_awp`/`pist_deagle`/
`pist_glock18`/`pist_hkp2000`）全部都有**（另有 `_surface.vtf`）。也就是说 style 1/2/4/5 缺的
**就是这两张已存在、路径已定的贴图，而不是一条未读的规则——它们现在已经抽出并入库（本节末尾）**；
`NormalsSampler` 则来自**完工图自己的 normal 图**（入库清单里已有 `role normal` 条目），不来自武器。

## 菜单只列"合成器真能画"的（已落地）

上一版生成表的规则是"style 7 + 图案唯一 + 无 normal"，而其他 style 一旦放开就暴露了三件事，全部
已改成生成表的**硬条件**（`scripts/stage-source-paint-kits.py`）并与运行时**同一口径**
（`game/source-ak-finishes.ts` 的 `sourceComposableFinish`）：

1. **采样器覆盖**：一个 style 的两趟程序声明的**每个采样器**都必须落在**该武器自己的输入集合**里。
   AK 那条路走已验证回执（槽 0/1/2/3/5），style 2 的 color 趟还要读槽 4（`MasksSampler`），所以
   AK 的四张**层压板**（14/172/226/1070）**不该被列**——上一版列了它们，等于承诺一张一选就失败的涂装。
   六个槽号不手写：逐行读清单自带的 `sampler`（`game/source-kit-input-resources.json`）；AK 那侧从
   **合成器自己的绑定表**读出（`SOURCE_REDLINE_VERIFIED_SAMPLERS`，由 `SHARED_INPUTS` 生成），并与
   回执里的五张贴图**逐张对账**，不一致就停下而不是悄悄变窄。
2. **图案变换必须"由套件自己决定"**：上一版这里写的是"`pattern_offset_x_start/_end` 是区间时原作随磨损
   动画，本移植只合成一个变换，故不列"——**这条读法是错的，已撤回**。它们不是动画，而是**这一分量被抽
   取的范围**：客户端用 `CUniformRandomStream::RandomFloat(start, end)` 抽三次（x、y、rotate），
   `pattern_scale` 是**单值直接拷贝、不抽**，抽取顺序是"图案三抽 → 磨损四抽 → 磨痕四抽"共 11 抽，
   正是本移植一直在做的顺序。证据：`scripts/probe-source-paintkit-transform.py`
   （`research/source-paintkit-transform.json`）读出填充函数 `0xf52b90` 为 0xa0c/0xa10/0xa14 依次调用
   `0x6a0d00`（该桩经 `.rela.plt` → GOT 解析为 **`CUniformRandomStream::RandomFloat`**）并把套件记录的
   `+0xf0/+0xf4`、`+0xf8/+0xfc`、`+0x100/+0x104` 三对作参数，而磨损/磨痕那八抽的参数是常量
   **1.6/1.8、0/1、0/1、0/360**——与本移植早已使用的区间逐位相同；`RandomFloat` 本体在
   `libvstdlib_client.so` 0x1e750（97 字节）读出为 `min + value*(max-min)`（float32、一次抽取、
   **不交换区间、不夹取区间**），故 **9 张 start>end 的反向区间套件也是正常区间**（本移植原先的区间检查
   会抛错，已按客户端放开）。
   现在真正决定"能不能列"的是**缩放因子**：客户端把三个变换的 scale 都乘上**武器自己的尺寸缩放**
   （`this+0x84`，由构造函数从参数块 `+0x74` 写入），**除非套件清位 `ignore_weapon_size_scale`**
   （记录 `+0x118` → `this+0xc4c`，为真时因子恰为 1.0）。本移植尚未读出武器尺寸缩放，所以
   **未清位的图案类套件不列**——今天列出的 67 张图案涂装**全部是清位的**，故缩放一直是对的。
3. **`phongalbedoboost` 必须是 -1**：已验推导**保留武器自己的** albedo boost（`-1` 是原作自己
   "保持"的写法），覆写了它的涂装需要**自己的一次推导**，因此不列。

### 现在的菜单内容（生成表与解析器逐把枪一致，有单测盯着）

| 端口 | 原武器 | style 分布 | 合计 |
| --- | --- | --- | --- |
| `vandal` | `weapon_ak47` | 7×18 | 18 |
| `m4a4` | `weapon_m4a1` | 1×1、2×2、7×10 | 13 |
| `awp` | `weapon_awp` | 2×1、7×11 | 12 |
| `glock` | `weapon_glock` | 1×4、2×1、7×8 | 13 |
| `usp` | `weapon_usp_silencer` | 1×1、2×2、7×14 | 17 |
| `deagle` | `weapon_deagle` | 1×1、7×3 | 4 |

**共 77 张**。相对上一版：那条错误读法原本把 **16 张区间非点**的涂装挡在门外，撤回后其中 **3 张清位的
入选**（M4A1 8「沙漠风暴」、M4A1 793「转换器」、AWP 227「电子蜂巢」，都是 style 2），另外 **13 张因
真正的原因仍不列**（未清位，缺武器尺寸缩放）。`tests/source-kit-inputs.test.ts` 逐把枪断言解析器的
`available()` **等于**生成表，且**每一张都真的能 `resolve`**；`tests/source-redline-seed.test.ts` 钉住
新区间抽取（含反向区间、含"点是区间仍返回该点"，后者是已验证合成逐字节不变的保证）。

### 抽取与入库不再写死 style 7

两个抽取器的 `STYLE = 7` 换成"**程序声明了 pattern 采样器的那些 style**"：从
`game/source-customweapon-program-data.ts` 的 `SOURCE_CUSTOMWEAPON_PROGRAM_STYLES` 与程序回执读出
（即 2/5/7）。style 1/4 的程序**不采图案**，没有要抽的东西；style 3/6/8/9 本移植**建不出程序**，
所以也不抽它们的artwork。六把枪各重跑一遍：AK 31 张（25 pattern + 6 normal，其中 `laminate_ak47.vtf`
**一张图案服务四张层压板**）、M4A1 36 / Glock 32 / USP 33 / Deagle 28 / AWP 32；`KIT_INPUTS` 166 条。
原作解不出唯一 pattern 的完工图仍然**记录而非丢弃**（AK 3、M4A1 4、Glock 4、USP 3、Deagle 3、AWP 5）。

### 还差的两次推导（已被点名，不是估计）

生成表新增 `PAINT_KITS_WAITING`，把"结构条件全过、只差一个本移植没推导的数"的完工图**按规则列出**：

- **`weaponSizeScaleFactor` 13 张**：m4a1 16/164、glock 293/1016、usp 183/217/236、deagle 90/232/237、
  awp 174/251/451——图案缩放要乘武器自己的尺寸缩放，而这个数未读（客户端里它是构造参数
  `[参数块+0x74]` → `this+0x84`，源头在下一层）。
- **`phongAlbedoBoostOverride` 24 张**：m4a1 471/780、glock 48/230/399/437/1119–1123、usp 60/221、
  deagle 185/231/296/425/468/469/470/757、awp 51/395/718。

两次推导各自独立，做完即可再放开这 37 张。同一张表还给出 `stagedNotDrawn`——**已入库但菜单没列**的
图案（AK 的层压板、其余五把枪刚入库的 style 2/5 图案），所以"入库领先于能力"的部分是有账的。

## 尚未完成

1. **24 张带 normal 的涂装**（AK 6 / M4A1 6 / AWP 3 / Glock 4 / USP 2 / Deagle 3）：
   它们的 normal 贴图**已经抽出并入库**，缺的是一条会采样它的程序排列。本轮把这件事问得更准了：
   **style 7 的任何排列都不声明 `NormalsSampler`**（CTAB 里没有），而 shader 自身确实带着
   `$bumpmap`/`$NORMAL` 变量、客户端也确实读 kit 的 `use_normal` 标志——也就是说带 normal 的 kit
   很可能选了**枚举空间之外**的一个排列（现有 selector 只覆盖 style/exponent/preview/tint/factor）。
   要把这句变成结论，需要把 `use_normal` 到排列的那一位量出来；在那之前这 24 张**不列**。
   另有 **2 张**（M4A1 的 155 / 993）是原作自己就没唯一定位 pattern 的——
   那两张不是缺实现，是**原作数据本身不唯一**，因此不列。
2. **其余 147 张涂装**（AK 21 / M4A1 21 / Glock 32 / USP 19 / Deagle 29 / AWP 25）走的是同一族
   `CustomWeapon` 的其他 static 排列，排列数据已经在库里（`game/source-customweapon-programs.ts`）。
   逐 style 的剩余工作现在是可数的：
   - **style 1/2/4/5**（翻译器已能表达）差两样：**调色板参数的打包**（见上，已知不在着色器参数代码里）
     与 **`MasksSampler`（s4）那张原纹理的入库**。
   - **style 8/9**（共 53 张）还要给翻译器补 **`rcp` / `rsq`（colour）与 `cmp`（exponent）**。
   - **style 3/6**（共 21 张）还要补 **`pow` / `dp2add`**、`NormalsSampler`+`OSPosSampler` 两张纹理、
     以及它们把图案变换当常量读的 `c10`；且这两条**没有 exponent 排列**，先不列。
   238 = 已可合成 65 + 带 normal 24 + 原作未唯一定位 2 + 其他 style 147。
3. **原 seed → wear/grunge 变换、最终输出格式与 mip/filter** 的完整对照与贴纸仍未做。
4. **每人一条涂装字段**：线上只传"所持武器那一张"，因此第二把枪（副武器）在原作里是各自有皮肤的，
   这里还没有。要完全对齐需要协议按武器带多份。
5. **浏览器级合成画廊（`scripts/preview-source-finishes.ts`）覆盖 AK / M4A1 / Glock / USP-S 四把枪**
   （style 1/2/7 共十张，见本节"菜单只列合成器真能画的"），AWP 与 Deagle 只经游戏内那条路径验证过
   （同一条代码、同一套断言），没有单独进画廊。
6. **入库脚本一次只写它被点名的那几把武器的清单**：`scripts/stage-source-kit-inputs.py` 现在会**合并**
   已有清单（只替换被点名的武器），因此不会再把别的武器挤掉——这个坑在本轮真的踩到过一次
   （单独补 AWP 时把 M4A1 挤掉了，生成表随即把它报成"输入未抽取"）。
7. **合成材质的两个"从哪里取"问题，只有 AK 那一条是钉住的**。合成适配器
   （`createSourceFinishMaterial`）把三个 Phong 值设为**该武器自己的**，但还有两件事是**外推**的：

   **(a) 分支选择**：适配器走的是 `albedoTint`（`$phongalbedoboost` 参与高光色）那条分支，
   这条是**对 AK 的涂装态验证过的**（`docs/source-redline-phong-worktree.md`）。但本移植自己的
   AWP / Deagle / 三把手枪适配器**各自设了自己的 uniform 与分支**（Deagle 与 AWP 用的是
   `mix(vec3(1.0), diffuseColor.rgb, g)` 那条非 tint 分支，USP 世界材质还额外用 HalfLambert + 白 tint），
   也就是说：那些适配器描述的是**未涂装**状态，而涂装状态下原作到底走哪条分支**没有被独立验证**。
   目前是一律用 AK 那条已验分支 + 各武器自己的三个值。

   **(b) 第一人称与世界模型**：抽取器读的是 `v_models/...`（第一人称）那份 VMT，而合成材质在两边
   共用同一个（按 `id:seed:wear` 缓存）。本移植自己的世界适配器记着另一套（都注明来自原
   `w_models/...` VMT）：

   | 武器 | 第一人称（抽取值，目前两边都用） | 本移植世界适配器自己记的 |
   | --- | --- | --- |
   | `weapon_ak47` | 2 / 35 / `[.83 .83 1]` / tint | 同一个材质名、同一组值（**与合成材质逐项相同**） |
   | `weapon_glock` | 1 / 35 / `[.83 .83 1]` / tint | 1 / 35 / `[.83 .83 1]` / tint（**与合成材质逐项相同**） |
   | `weapon_m4a1` | 2 / 25 / `[.83 .83 1]` | 2 / 无 albedo / `[.83 .83 1]`、非 tint 分支 |
   | `weapon_deagle` | 1 / 40 / `[.8 .8 1]` | 同样三值，但走**非 tint** 分支 |
   | `weapon_awp` | 2 / 40 / `[.8 .8 1]` | **boost 1** |
   | `weapon_usp_silencer` | **8** / **80** / `[.83 .83 1]` | **5 / `[.2 .5 1]` / HalfLambert / 白 tint** |

   也就是说：**AK 与 Glock 的合成材质与它们的世界材质逐项相同**；M4A1 差 albedo 分支；
   **AWP 的强度差一倍**；**USP-S 差得最多**（世界材质是另一条分支，不只是常数）。

   本轮的选择是：**两边都用第一人称那组值、都用 AK 那条已验分支**——比"远端干脆不画"更接近原作
   （图案与磨损完全一致），并把上面两张表连同出处写在这里，而不是装作都一样。
   要真正对齐需要两件事：合成材质按模型各持一份（`replaces` 从名字列表变成「名字 → 该模型自己的
   参数与分支」），以及逐武器确认涂装态的分支。**没有被独立证据钉住的那一环是"涂装状态下每个模型
   到底用哪份 VMT、哪条分支"**；本移植的推断是：涂装是换掉 base texture 的贴花层，底层仍是该模型
   自己的 VMT。已验的另一侧是：AK 的合成输出与浏览器级/游戏内两条路径逐位一致，且六把枪各自用
   自己那张图案与自己那三个值。
