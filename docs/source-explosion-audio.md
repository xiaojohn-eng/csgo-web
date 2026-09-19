# 原始 HE / C4 爆炸音效

Dust II 的 `grenade` 与 `explode` authority 事件原先都调用 `AudioEngine.explosion()` 的合成噪声。现已分别映射到 App740 build12426148 的 `BaseGrenade.Explode` 与 `c4.explode` 原始 WAV；旧港区继续沿用原来的声音。

## 原始依据

`scripts/game_sounds_weapons.txt`（VPK 内原路径）为 219,339 bytes，SHA256 `24833a684bcc0908fe775db74b1dbda4815e6c7ed1a78a59237eab6d1cb34b4d`。HE 定义位于原文件 10889–10958 行，C4 位于 11318–11324 行。

| 事件 | 有效 WAV | volume / pitch | 声级 |
| --- | --- | --- | --- |
| `BaseGrenade.Explode` | `hegrenade_detonate_02.wav`、`hegrenade_detonate_03.wav` | 1 / 97–103 | `SNDLVL_140dB` |
| `c4.explode` | `c4_explode1.wav` | 1 / 未显式声明，默认 100 | `SNDLVL_NONE` |

HE 的 `_01` 在原脚本中被注释，因此不进入随机列表。三份音频总计 2,729,104 bytes，均为 44.1kHz、16-bit、双声道 PCM。完整 VPK 偏移、CRC、SHA、原定义和最终 URL 记录在 `research/source-explosion-audio.json`；执行 `python3 scripts/stage-source-explosion-audio.py` 可由本地原 VPK 重建，拒绝目录项或 CRC 不符的资源。

## 运行契约

- Source 就绪门禁等待三份原文件验 SHA 和解码；加载失败不会在 Source 爆炸事件上偷换合成音。
- HE 在 authority 的真实爆炸位置播放。C4 原定义为 `SNDLVL_NONE`，不添加距离 panner。
- 本地和联机快照事件复用 `Game.presentExplosion()`。事件去重仍由原有 authority event id 管理。
- owner 释放只移除自己加载的 buffers；校验失败会回滚已完成的加载。

## 验证及边界

`tests/source-explosion-audio.test.ts` 核验原 WAV SHA、脚本参数、HE 两个随机分支、C4 无距离衰减、失败回滚、重复预载和 local/remote 共用事件映射。原始音源、增益和音高已接入；HE 的 `BaseGrenade.ExplodeDistant`、原 operator stack 交叉淡变、DSP、`soundlevel` 精确衰减和整体空间声学尚未复刻。该变更不涉及爆炸粒子、脚步材质映射或原客户端听感对照。
