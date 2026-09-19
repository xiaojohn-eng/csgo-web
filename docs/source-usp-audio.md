# USP-S 射击音频调用契约

`AudioEngine.shot(id, volume, pan, position, occluded, sourcePistolMode?)` 保留原前五个参数，第六个参数为 `0 | 1`。它只选择已接受射击的音频，不改变武器状态，也不触发换弹、装卸消音器或拔枪音效。

| USP 原射击 mode | 清单事件 | 原 WAV 对应 key | 清单 gain / pitch |
| --- | --- | --- | --- |
| `1`，消音器已装上 | `weapon_usp.silencedshot` | `source_usp_8`、`source_usp_9`、`source_usp_10` | `0.7` / `100` |
| `0`，消音器已取下 | `weapon_usp.single` | `source_usp_19`、`source_usp_20`、`source_usp_21` | `0.8` / `100` |

上述键与参数来自 `game/source-pistol-audio.json`，播放复用 `sourcePistolEvent` 的样本选择和原清单增益。省略第六个参数时，USP 采用默认已装消音器状态；Glock 和原步枪调用行为保持不变。联机和预测集成必须显式传入射击发生时的 mode，不能根据后来抵达的玩家状态、动画名或右键输入重新推断。

```ts
// 本地预测：acceptedBullet 是本次已接受的 bullet 事件。
audio.shot('usp', .9, 0, undefined, false, acceptedBullet.mode);

// 权威 / 远端：沿用原 predictedOwn 去重和空间参数。
audio.shot(event.weapon, .8, pan, position, occluded, event.sourcePistolShot?.mode);
```

准备阶段须等待既有 `preparePistols()`。缺失原射击样本时不会回退为合成音效，准备失败须继续沿用入口的就绪阻断处理。动画音效仍仅由 `assets` / `playback` 时间线调用 `sourcePistolEvent`，不在 `shot` 中重复触发。

验证：`npm test -- tests/source-usp-audio.test.ts tests/source-pistol-audio.test.ts`，2 个文件、9 项测试通过；`npm run typecheck` 通过。新增测试覆盖两个 mode 的全部 6 个样本、原增益 / pitch、空间和遮挡参数、延后报告的独立 mode、旧 Glock 调用，以及缺失样本时无合成和动画音效。既有测试核验全部 34 个手枪音频别名的原 WAV 哈希、共享解码和失败处理。日志位于当前工作树 `output/source-usp-audio-tests.log`、`output/source-usp-audio-typecheck.log`。

本次范围是音频派发模块，尚未证明主目录运行时已接线或完成真人听音验收。距离与遮挡沿用现有 Web Audio 管线；清单中的 `weapon_usp.singledistant` 未加入新的远距分层，未声称已复刻原引擎声场或原始随机样本序列。
