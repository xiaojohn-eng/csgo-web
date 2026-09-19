# 原 AWP 精度、后坐力、普通伤害与 runtime 接线

本增量在 `ad73df1359a313872f8d2332d9bedf99ed7fc706` 之后，只修改 AWP 自有文件。原 App740 build12426148 的 server SHA-256 是 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。原 item9 的继承属性通过 items_game.txt 的 SHA 与 catalog 交叉检查。

## 数值来源与独立身份

AWP vtable `0x12e92f4` 实读：FullAuto `+0x688 → 0xd47710`、CycleTime `+0x694 → 0xd34540`、MaxSpeed `+0x6b8 → 0xba9e80`、BurstCapable `+0x6c0 → 0xd4e890`、OnLand `+0x718 → 0xd40580`、Inaccuracy `+0x738 → 0xd3ff60`、UpdateAccuracy `+0x73c → 0xd42060`。探针安装 AWP 自身的这些槽位；FullAuto 从原属性读取 false。原查表/生成器、RNG、精度和 SSE 顺序与已有公共数字工具相同，但 AWP 配置、身份与模式不借用手枪或步枪参数。

`source-awp-accuracy.ts` 提供 `SOURCE_AWP_ACCURACY_PROFILES[mode]`、`sourceAWPRecoveryTime/AccuracyTick/Inaccuracy/AccuracyDeploy/Recoil/Spread`。其中 profile 已按原解析器转换到运行单位：inaccuracy/spread 原属性先转 float32，再乘 float32(0.001)。

| 原属性 | mode0 未开镜 | mode1 开镜 |
| --- | ---: | ---: |
| 最大速度，Source 单位/秒 | 200 | 100 |
| spread 原属性 | 0.2 | 0.2 |
| 站立 inaccuracy 原属性 | 80.800003 | 2 |
| 蹲下 inaccuracy 原属性 | 60.599998 | 1.5 |
| 移动 inaccuracy 原属性 | 176.479996 | 176.479996 |
| 开火 inaccuracy 原属性 | 53.849998 | 53.849998 |
| 落地 inaccuracy 原属性 | 0.307 | 0.1 |
| recoil magnitude / variance | 78 / 15 | 25 / 2 |

原 recoil seed 是 4100，angle variance 是 20，两个模式各自从同一 seed 生成 64 项表。AWP 半自动 `ApplyRecoil` 按 **normal command seed & 63** 查表，不按 recoilIndex 或 serverSeed。弹道使用独立权威 serverSeed 的低 8 位；原 R8/Negev 的特殊散布分支已用非匹配 item9 身份实际执行排除。原生 128 个表项与所有 256 seedByte 完全比对。

精度恢复的 crouch / stand 时间分别为 0.246710 / 0.345390，final 与 base 相等。原跳跃 apex 属性是 0，initial 为 172.860001；没有套用 Deagle 的非零 apex。recoilIndex 衰减边界使用原 base CycleTime **1.455**，即使 mode1 也不使用 catalog 的 cycletime alt 0.3。

## 命令、移动和权威事件契约

`SourceAWPRuntimeState` 现含独立 `handling: {version, activeWeapon:'awp', accuracy, punch}`，可完整 JSON 往返。`sourceAWPRuntimeFrame` 输入新增必填 `accuracy: SourceAccuracyContext`，其 `velocitySource` 使用原 Z-up Source 单位。

1. 玩家移动逻辑每 tick 对共享 punch 调用一次 `sourceAWPMovementTick`。发生落地时，在此之后、武器 tick 之前调用 `sourceAWPHandlingOnLand(state, currentMode, retainedFallVelocitySource, commandSeed)`。runtime 不重复做移动衰减。
2. 调用 `sourceAWPRuntimeFrame(state, {...commandInput, accuracy, execution})`。原 `weapon-tick.mode` 驱动精度更新，使用事件中实际 `reloading`；接受 bullet 用事件的退镜前 mode 更新精度与后坐力。手动开镜发生在该 tick 的精度更新之后，自动复镜在原 beforeTick 分支发生，二者不能按帧末模式重算。
3. 权威 `execution:{type:'authority',serverSeed}` 返回 bullet 的 `.shot`，包括 mode、inaccuracy、spread、recoilIndex、punchAngles、offset、commandSeed、serverSeed、scheduledTime。预测 `execution:{type:'prediction'}` 更新同样 handling，但没有 shot/serverSeed；即便 JS 调用多带 serverSeed 也被明确覆盖。
4. 成功 reload 只加原 recoilIndex 一次；dryfire 等原 Primary notification 时间通过命令结果 lastShot 同步。`sourceAWPRuntimeDeploy(state, now, accuracy)` 做原 deploy recovery，保留跨武器共享 punch；Holster 不清精度。
5. 原 `sourceAWPRuntimePostThink` 契约不变：命令后推进实际活动枪的原 VM 时钟，由 event54 提交弹药。音频/画面不能再重复提交。

**模式改变不清弹道 penalty。** 原 Secondary 只清 `+0xa8c`，事件为 `{kind:'zoom-smoothing-reset',field:'0xa8c',value:0}`；真实 penalty 位于 `+0xa84`。新 accuracy 探针还分别改变 zoomReadyTime 和 zoomSmoothing，确认原弹道 getter 不从它们直接清零或阻断精度。开镜后从当前 penalty 向 mode1 原 stance 值恢复，这决定快速开镜射击的真实散布。

`0xd499e0` 对 +0xa8c 的 FOV 修饰、客户端准镜可见条件和 4:3 水平角换算保持原命令文档中的证据范围；本增量不把已知原 FOV 数值 90/40/10 和 `hide view model zoomed=1` 当成完整客户端呈现验证。

## 普通伤害

`computeSourceAWPBulletDamage({weapon:'awp',hitgroup,distanceMetres,armor,helmet,heavyArmor?})` 为共享命中调用提供独立适配，返回与普通 Source damage 结果同形状的数据。原属性为 damage115、headMultiplier4、armorRatio1.95、range8192、rangeModifier0.99。按原距离衰减、hitgroup、护甲消耗和两个独立整数截断实现；8192 Source 单位之外返回零伤害。head/body 判断必须传原 hitgroup。

本轮是普通无穿透伤害和默认队伍倍率；heavyArmor 明确拒绝。地图穿透、特殊模式和实体侧死亡等由独立 owner 负责。

## 原生验证与重跑

```sh
.tools/source-binary-venv/bin/python scripts/inspect-source-awp-handling.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-handling.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-spread.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-landing.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-damage.py
.tools/source-binary-venv/bin/python scripts/probe-source-awp-runtime-handling.py
npx vitest run tests/source-awp-*.test.ts
npm run typecheck
```

- 682 精度/速度/跳跃/梯子/换弹/开镜字段/衰减边界状态，276 接受射击，10 deploy、10 reload，960 连续 handling 帧。
- 128 原半自动表项、2,048 散布案例、8 command/server seed scope 边界。
- 36 原 landing 与 6 movement → landing → weapon tick 链。
- 720 普通伤害：0–8192 原距离、9 hitgroup、5 armor、两种 helmet。
- 3,000 帧原 command/VM 收据按原事件顺序组合实际原生数值消费者，9 发接受子弹（mode0 一发、mode1 八发），每帧 JSON 恢复与预测/权威等价验证。此项明确是原消费者组合，非单次不中断的完整引擎调用；command 与 VM 自身另有完整函数原生连续链。

精度、recoil 表、普通伤害及连续状态在该样本集精确相等。外部 expf/asinf/sincosf 用 host libm 结果转 float32 接口，不声称覆盖所有 Linux glibc 超越函数 ULP。默认 ConVars 已从原注册表读取，转向精度、ExoJump 等非普通路径不在此收据内。未执行游戏服务、主目录修改或浏览器/LAN验收。

最终本工作树全部 AWP 专属测试 **16 文件 / 47 测试通过**，`npm run typecheck` 通过。未入 Git 的逐 SHA 清单在 `source-awp-handling-evidence-files.json`；原始 App740 库和既有 AWP 资产是只读依赖。
