# 原 Source1 分段末帧纠正与已提升版本

已在根任务指定的同步窗口提升 AK 两队第一人称和连续姿态数据，原版文件、manifest、脚本常量及收据保存在 `.reference-assets/source-exports/section-before-20260909/`。M4 从首次交付就使用同一修正规则。本轮不操作浏览器、不重启服务器；根任务负责统一下一次构建与 simulationVersion admission。

## 直接证据与边界

固定 [Valve SDK `mstudioanimdesc_t::pAnim`](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.cpp#L70) 对长分段动画的最后一帧单独选择 `numframes / sectionframes + 1` 区段、局部帧0。旧 SourceIO cfc2591 的区段顺序复制未走这条分支。绝对动画最后区段还可能省略保持 rest 的骨；初始化全零会产生零 quaternion。M4 world reload 中实际出现这一错误，不能靠放宽容差接受。

`scripts/source-section-decoder.py` 仅在当前 Python 进程覆盖 `StudioAnimDesc.read_animations`，不改 SourceIO checkout；保留原 block/ANI offset，按原 source bone rest 或 delta零位移/单位四元数初始化后覆盖实际通道。参考 SDK 是公开的对应格式/算法证据，不等于闭源 CS:GO 完整动画图。

本次修正前的独立原 MDL 对比：AK reload 最后帧最大局部分量差0.00203037262，inspect0.00006103515625；T 角色原17个分段片段中10个受影响，最大0.00390625；CT 同为10个，最大0.0009765625。这是 p/q 局部分量差，不能直接称作实际关节米制误差。证据分别 `output/source-animation-section-review.json`、`output/source-character-section-review.json`。

## 当前版本

| 内容 | 新身份 |
|---|---|
| AK + T FP | `8e93eb7f575bcf4ae7cd05cfce32d374fd8d114d9993e76dd5f1adc5182b0baa` |
| AK + IDF CT FP | `8a8a31f668a54255eeea1556859878910828ad84001f670b566c5e43b5a43e55` |
| T + AK continuous | `csgo-t-ak-12426148:0bb54296ce32fc11` |
| CT + AK continuous | `csgo-ct-ak-12426148:c56dc682f203b1b9` |

第三人称原身体/world-AK 组合 GLB 保持原 SHA；其烘焙历史 clips 作为原先参考保留，生产 actor 由新 continuous 原数组驱动。AK 新 pose JSON 与旧 JSON 只有 `frames` receipt 字段改变，骨映射、状态 ID、序列/权重/时标、hitbox bytes、IBM 完全相等。

每队 FP 168 个 animation channel 只在 reload/inspect 最后 key 改变。所有其他帧、输入时标、几何属性、索引绕序、106 个 IBM、嵌入 PNG bytes 均严格相等。需区分 glTF exporter 对 sampler 去重后的编号变化与实际通道变化；对比按原 target node+path 匹配，不能直接 zip sampler 表。

## 验证与复现

- `scripts/compare-source-ak-section-candidates.py` 自动从提升前备份读取旧输入，对比结果 `output/source-ak-section-candidate-diff.json`。
- `output/source-ak-pose-section-candidate-diff.json` 保留逐 descriptor/字段/帧差异；变化全部是末帧。T12/CT10个数组变化，其中同一动画 pos/quat 分开计数。
- 新 candidate 两队各40原 Python world、40 interior locals、9way corners、weight0/mask0 与实际 Three joints 通过；FP Three/Khronos 与 CT原逐骨/加权顶点、附件验证通过。
- 提升后 `output/source-weapons-final-staged-receipt.json` 独立回读8个目录、147个manifest文件的 bytes+SHA。最新相关测试见 `output/source-weapon-sections-final-tests.log`，全项目类型检查见 `output/source-weapon-sections-final-tsc.log`。

```sh
# 每队独立 factory-startup 进程，避免 Blender orphan action 使第二套 clip 带 .001 后缀。
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-ak-section-candidate.py -- --team t
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-ak-section-candidate.py -- --team ct
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/export-source-ak-pose-section-candidate.py
```

已完成提升脚本为 `scripts/promote-source-ak-sections.py`，公开服务暂存沿用 `stage-source-weapon.py` / `stage-source-ct-viewmodel.py` / `stage-source-character.py` / `stage-source-ct-character.py`。loader 固定 SHA 同步更新，FP与角色 manifest/bytes请求显式 `cache:'no-cache'`。旧目录的通过标记只证明当时的转换；本报告撤回任何把旧末帧称为原始完全一致的说法。
