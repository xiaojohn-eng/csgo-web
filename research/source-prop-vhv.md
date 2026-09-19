# Dust2 原始静态道具 VHV：逐实例字节与原顶点映射验收

本报告保留第一阶段的 **3158 个原实例 VHV 字节提取及 MDL/VVD/VTX 原顶点映射** 验收。当时颜色解释尚未确认，以下“未解释”段落描述该阶段边界。后续已经通过当前官方安装二进制及编译 shader 证实三路 D3DCOLOR bumped diffuse，并完成原 GLB 精确映射和有界模块，详见 [解码与接线续报](source-prop-vhv-encoding.md)。原 `props.glb` 始终未修改。

## 数据范围与身份

输入为已安装完成的 App 740，build `12426148`，原图 `csgo/maps/de_dust2.bsp`。文件读取优先级严格为地图 embedded ZIP、游戏 loose 文件、`pak01` VPK；ZIP/VPK 读取校验 CRC，所有依赖另存 SHA256。

| 输入/产物 | 实际结果 |
| --- | --- |
| 原 BSP SHA256 | `b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc` |
| BSP lump 40 原 ZIP SHA256 | `35592881ed33fee49d1e1877b4197afd5d1c9d268001ea4975ffc28c1e9b1705` |
| VHV 成员 | `sp_hdr_0.vhv` 至 `sp_hdr_3157.vhv`，连续且与原实例集完全对应 |
| VHV 总文件字节 | 73,297,408，包含头、表和对齐空白 |
| 独立模型/原实例 | 1258 / 3158 |
| 模型硬件顶点组/实例光照组 | 1411 / 3749 |
| 模型映射顶点/实例光照记录 | 3,565,287 / 5,903,895 |
| 实际 LOD | 所有 VTX 只有 1 个 LOD，所有 VHV 组为 LOD 0 |
| 实际 VVD fixup | 1258 个模型全部为 0；未把通用分支当成非零 fixup 的实物验收 |

原 `props.glb` 为 543,629,080 字节，重新流式校验 SHA256 为 `55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232`，与冻结 manifest 相同。验证器还把提取的 ZIP 与原 BSP lump 40 的字节摘要直接比较，防止仅信任旧提取目录。

## 原 VHV 布局与可确认范围

3158 个实物全部符合：40 字节文件头、28 字节组表项，版本 `2`，`vertexFlags=2`，`vertexSize=12`。头和组表保留字段均为 0；表后的首数据位置及文件末尾按 512 字节对齐，实际空白全为 0。每组原顶点数、LOD、组顺序和原 VTX 一致；文件头的总顶点数等于组之和。

官方固定 SDK 的 `hardwareverts.h` 给出相同头表结构、MDL checksum 字段和 512 字节流对齐要求，并明确仅靠顶点大小不足以识别颜色格式。这里只将结构与实物对应，不把 SDK 的另一种颜色载荷视作当前 CS:GO 格式。[Valve hardwareverts.h](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/materialsystem/hardwareverts.h)

每个模型的原 MDL、VVD、VTX checksum 与对应 VHV checksum 四方相等。例如第 0 个轮胎实例的 checksum 是 `2868866793`，561 个硬件顶点，首组偏移 512，文件大小 7680 字节。

当前 12 字节记录完整保存为 3 组连续 4 字节，**没有指定 RGB/BGR 顺序、指数格式、颜色空间、法线方向基或 alpha 语义**。原实例 0 的第一条为 `4f 4e 4f 00 35 35 36 00 44 43 42 00`；实例 2 为 `2d 32 35 04 30 39 3f 00 26 29 2c 03`。

三组的第 4 字节各有 156、166、149 种实际取值，范围均为 0–255，并非固定 padding 或 255。各组前 3 字节实测范围为 0–239。这些统计保存在完整 histogram 中，不能据此直接宣称为 RGBExp32。

公开 SDK 的 VRAD 路径实际写的是每顶点 **4 字节**，先转换颜色，再按 B/G/R/A 顺序落盘；其转换函数将第四字节设为 255。该路径与本次 12 字节且第四字节变化的实物不同，不能直接复制为 CS:GO 三方向解码器。查阅的通用 bump 基也不能独立证明这 3 组载荷的方向语义。[Valve VRAD 写出路径](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/utils/vrad/vradstaticprops.cpp#L1550-L1602)，[Valve 颜色转换](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/utils/vrad/lightmap.cpp#L3553-L3603)

## 从硬件顶点定位源 VVD

官方 `ApplyLightingToStaticProp` 按 body → model → LOD → mesh → strip group → group vertex 写出光照；VTX 顶点的 `origMeshVertID` 指回该 mesh 的原顶点。在模型顶点基址上加 mesh 顶点偏移和该索引，就能得到 VVD LOD0 原位置。实际每个 VHV 组与此顺序、顶点数量逐一匹配。[Valve VRAD 映射](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/utils/vrad/vradstaticprops.cpp#L1220-L1275)，[Valve VTX 顶点结构](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/optimize.h#L36-L52)

映射公式：

```text
packedVvdLod0 = mdlModelVertexByteOffset / 48
             + mdlMeshVertexOffset
             + vtxVertex.origMeshVertID
rawVvdFileIndex = lod0FixupMap[packedVvdLod0]
```

生成器使用固定 SourceIO 提供的结构解析，验证器则用独立 `struct` 偏移从 MDL 49、VVD 4 和 VTX 7 重新推导所有 3,565,287 对索引。所有模型每 mesh 仅有一个 strip group，因此实际数据没有验证多 strip-group 时 25/33 字节组头步长差异；不能扩展声称所有 Source 分支布局均已支持。

该索引指向原 VVD，**不等于现有 GLB 顶点编号**。现有 `props.glb` 没有保留 source vertex ID；导出器可能因 UV/法线拆分或顶点重排改变编号。后续必须生成新的候选导出并保留经过回读的源索引，或者建立独立验收的重映射，才可把 VHV 绑定给渲染顶点。

## 产物与消费者契约

私有目录：`.reference-assets/source-exports/dust2-vhv/`。

| 文件 | 大小/含义 |
| --- | --- |
| `inventory.json` | 模型与实例目录、原 SHA/CRC、逐组范围、完整通道 histogram |
| `source-vertex-map.u32` | 28,522,296 字节；每记录两个 little-endian uint32：packed LOD0、raw VVD index |
| `instance-lighting.bin` | 70,846,740 字节；每记录原 12 字节，不做数值/颜色变换 |
| `verification.json` | 独立原结构回读、原 BSP/ZIP/GLB 身份验证结果 |
| `sdk-reference/manifest.json` | 官方固定 commit 的源码 URL、SHA256、大小 |

映射文件 SHA256：`519b04abf8c8772fce4815b5c564c505443e8ea92375c226f98e1366e71a60b0`。

光照文件 SHA256：`ede17ac928ea1bbeaf679c766e45fdc744a81da8e6b34a1af9a7b7b9fb7a2087`。

`inventory.instances` 保留原 `index`、`modelIndex` 和 `skin`。对一个实例及其第 `k` 个组，连接方式为：

```text
instanceGroup = instance.groups[k]
sourceGroup = inventory.models[instance.modelIndex].groups[k]
第 j 个顶点的源索引对：mapping[sourceGroup.mappingOffset + j * 8 .. + 8]
第 j 个顶点的原光照： lighting[instanceGroup.lightingOffset + j * 12 .. + 12]
```

`mappingOffset` / `lightingOffset` 均为字节偏移；对应的 `mappingBytes` / `lightingBytes` 和 `vertexCount` 提供边界。组还保留 body/model/LOD/mesh/stripGroup 和材质引用。消费者应验证文件 SHA、索引和范围，不能跨模型复用偏移。

352 个模型拥有多个原实例，其中 **350 个模型的实例光照载荷不同**。例如轮胎 `models/props/de_dust/hr_dust/dust_tire/tire001.mdl` 的实例 0 和 1 共用 modelIndex 0，但 payload SHA 分别为 `307e03dbf1a84c7456a54b260b74c78e0bf4baead296efd2cae726f10fdc722e` 和 `df9b538912f3e32b35100dfe19d43dfb37d9b7b268648dd741fb642fd56d56f8`。

因此可以共用几何和原模型索引表，但光照必须维持实例身份。可给不同实例独立 attribute，或用实例偏移访问独立光照存储；直接修改共享 geometry 的唯一 color attribute 会覆盖其他实例的烘焙结果。

## 复验命令与当前界限

在项目根目录使用普通 Python 模式运行，不加 `-O`：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/inventory-source-vhv.py
python3 scripts/validate-source-vhv.py
```

生成器仅借用 Blender 自带的固定 SourceIO/NumPy 解析，不 register 插件、不创建场景对象。全量扫描实测约 6.22 秒；独立验证最终约 2.11 秒。后者不导入 SourceIO，逐个比较 3158 个原 VHV 数据跨度，并重新计算所有模型索引。两份脚本通过 Python 语法编译。

已完成的是源字节保全、checksum/CRC/SHA、组次序、索引、逐实例隔离和原文件不变验证。当前没有 GPU 光照验收，未确认三方向颜色解码与 shader 合成，没有替换原 `props.glb`，没有修改 `game`/`public`/预览页面。下一步应先取得安装包对应的颜色解码/顶点流语义证据，再在新候选几何中保留源索引并做实例级 GPU 对照；原始底色不作手工变暗补偿。
