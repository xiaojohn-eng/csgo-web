# 门框与线束附件的原 tint 扩展

当前可见的整圈白门框属于尚未装载的原 tint 材质，不是 olive、缺底图或原模型丢失。复用已验原 bump+tint shader 和 VHV 精确映射即可恢复这一组；没有增加新 shader 公式或修改原几何、底图、UV、实例颜色。

## 原资产与范围

共同前缀为 `models/props/de_dust/hr_dust/`，每个材质的 tint VTF 路径为 `materials/` + 完整材质路径 + `_tint.vtf`。

| 材质 | mesh | 三角 | tint 分辨率 |
| --- | ---: | ---: | --- |
| `dust_doorframes/dust_doorframes_01` | 60 | 89,330 | 512² |
| `dust_doorframes/dust_doorframes_02` | 29 | 19,141 | 512² |
| `dust_doorframes/dust_doorframes_03` | 19 | 42,420 | 512² |
| `dust_wires/dust_wire_attachments_01` | 73 | 53,652 | 256² |
| 合计 | 181 | 204,543 | 4 张图 |

四个 VMT 全参数都通过既有 `sourcePropTintCandidate` 严格白名单，无 envmap/selfillum/phong/decal/unbumped 额外分支；原 remap 歧义数均为 0。原 shader、绿色通道、sRGB 读取、实例 RGB 转换依据为 `research/source-prop-tint.md`。原 VMT/VTF、PNG、decoded RGBA 的 SHA 在新的私有 manifest 内；没有修改旧 R4/R5 receipt。

输出位于 material 工作树 `.reference-assets/source-exports/dust2-vhv/tint-structures/`，仅 `manifest.json`、`instance-rgba.u8` 和 4 张 PNG。原 BSP pak 优先读取，固定 SourceIO 原 VTF 解码，无损 PNG 解码回读；复用既有 `scripts/extract-source-prop-tint.py` 的数据管线，只更换四个明确 materialSource 和独立 OUT。实际执行副本在 `output/material/extract-tint-structures.py`。

manifest SHA256：`403ebcf00c0565d06736d159dc5bf3e3261fce793f77b829e7406709563e305a`。instance RGBA SHA256：`5323c2eacc6979ae682b9a821cce569f14c1f827b720bbbfbc28b06e33a001df`。新增 GPU mip 4,543,824 字节，受独立 5 MiB 硬预算约束；文件校验总量 524,006 字节，不含 JSON。

## 主代理接线

本提交只新增 `game/source-prop-tint-structures.ts`、对应测试和本文。它不修改公共 loader、scene、服务器、主目录资源或当前服务。

在 `loadSourcePropLighting` 的普通 R4 tints 加载之后，按新增默认 false 的 `enableStructuralTint` 调用：

```ts
const structuralTint = options.enableStructuralTint && tints
  ? await loadSourcePropStructuralTint({
      baseURL: new URL('../tint-structures/', url).href,
      borrowedTint: tints,
      signal: options.signal,
      maxTextureSize: options.maxTextureSize,
    })
  : undefined;
```

仅把 `prepareSourcePropLightingData` 的普通 tints 参数改为 `structuralTint ?? tints`。compound 仍借用原 tints，现有 VHV 原几何 SHA/材质参数/白材质门禁不变。audit 增加 `structuralTint?.audit ?? null`。在 dispose/catch 中先释放 apply handle、compound，再 `structuralTint?.dispose()`，然后旧 decals/tints；新 owner 不释放借用的旧图、RGBA 或 Map，冲突 materialSource 直接失败。

由主代理复制上述六个文件至主目录同名私有目录和 `public/source/csgo-12426148/dust2/vhv/tint-structures/`，依据工作树 `output/material/receipt.json` 逐 SHA 回读，再在 `source-dust2` 转发默认 false 开关并由 scene 显式开启。工作树没有 stage 主目录，未启停 27015/27018/27019。完整 R7 集成若原 2459 mesh 保持且新组无重叠，预期为 2640；这是待验预期，不是本任务的生产验收数据。

## 已执行验证

- `npm run typecheck` 通过；`npx vitest run tests/source-prop-tint-structures.test.ts tests/source-prop-tint-loader.test.ts tests/source-prop-tint.test.ts`：3 文件 / 11 项通过。
- 自有 `27023`、独立 headless `material-structures` 会话，1440×900、FOV75，R5 基线与候选各采 CT/T 出生点及两个原门框近景。四组共八图均亲自查看。每组相机、calls 和提交三角数一致，`errors=[]`。
- 实际 GPU 覆盖 R5 2325 mesh / 3,969,881 tri → 2506 mesh / 4,174,424 tri；新增恰为 181 / 204,543。普通 tint 249 → 430；decal40、compound68、plain-unbumped668 保持。
- 977 份 unique geometry、98,149,248 原几何字节通过 SHA，所有 3158 实例身份通过；geometry/index/UV/TRS 不变。
- 两次退出均回到空基线 geometry1 / texture2 / program1；新 owner 不留 GPU 资源。

证据：`output/playwright/source-structural-tint-gpu.json`、`source-structural-tint-doors-gpu.json`，完整文件 SHA 清单为 `output/material/receipt.json`。四组截图前缀分别为 `source-structural-tint-ct-`、`-t-`、`-door03-`、`-door01-`，后缀 `r5.png` / `structures.png`。

亲眼所见：CT 右侧接线盒恢复暗部，精确像素 `[1245,434]` 的原三角射线命中 `static_prop_234`。T 默认机位改变较小；近景 `static_prop_824` 的整圈石门框/门楣和 `static_prop_2793` 石门框明显从发白恢复原烘焙和 tint 层。门扇、铁栏、灯、遮雨棚仍有其它未支持材质，未将它们归入本次修复。

本次私有预览以已有 R5 静态道具管线作为基线，没有启用 foliage/olive 或天空 owner。它证明新增结构材质可接入和视觉可见，不证明完整 R7 生产场景、LAN、多玩家或原客户端同机位曝光一致；这些由主代理集成后验收。

工作树预览特例：Express `sendFile` 的默认 dotfiles 规则拒绝隐藏 `.worktrees/` 绝对 HTML 路径，首次加载 404。仅在私有 `output/material/server.mjs` 对固定检查 HTML 设置 `{dotfiles:'allow'}` 后正常；静态资源范围保持，主服务脚本未修改。复验须使用该私有服务器，不能把第一次 404 日志当作候选渲染错误。
