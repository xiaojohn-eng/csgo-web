# App740 env_wind → rendering parameter 3

此切片已完成独立、默认无副作用的 `game/source-wind.ts`。没有修改 scene、SourceDust2、foliage owner、服务器或端口，没有启用生产 foliage。它闭合原安装包的风随机状态、缓存、插值和时间传递；不重新声称完成 GPU、实际联网或整个原引擎调度。

## 可接入合同

```ts
import {createSourceWind, updateSourceWind, restoreSourceWind,
  DUST2_WIND_PARAMETERS} from './source-wind';

// levelCurtimeOrigin is explicitly supplied by the host. No Date.now().
const wind = createSourceWind(DUST2_WIND_PARAMETERS, {
  seed: 0, startTime: levelCurtimeOrigin,
  initialDirection: 0, initialSpeed: 0,
});

// One shared owner for all foliage meshes, not one RNG per material.
// Follow the returned next-think time; don't force 100 Hz substeps.
const now = Math.fround(levelCurtime);
if (now >= wind.nextThinkTime) updateSourceWind(wind, now);
foliage.setState({
  timeSeconds: now, // Shader time advances even on frames without WindThink.
  windSourceXY: [wind.renderParameter3[0], wind.renderParameter3[1]],
});

const json = JSON.stringify(wind);
const restored = restoreSourceWind(JSON.parse(json));
```

`updateSourceWind(state, curtime)` 执行一次原客户端 `WindThink`，返回 `{timeSeconds, windSourceXY, nextThinkTime, events}`，并更新纯 JSON 状态。`events` 是原切换边界的回读信息，未发送网络/音效/游戏事件。可直接用返回的时间和 XY 更新 foliage，但没有 Think 的渲染帧仍应使用当前 shader 时间。

快照保存初始参数、当前/目标风速、方向、gust 标志、0.1 秒变化计时器、2 秒摆动缓存计时器、当前风、两份缓存、render parameter 3、下一次 Think 时间和 **两条各有 32 项 shuffle 表的 RNG**。`restoreSourceWind` 校验并复制数组；不靠当前时间猜缓存，不重新播种。模块不引用 Three、DOM、socket、系统时钟或全局 gameplay RNG。

原状态依赖实际 Think 调用序列。首次可立即 Think；原函数建议下次 `curtime + .01`，实际执行由宿主帧调度决定。示例遵循这一阈值，不冒充整个 Source 客户端 scheduler。两个客户端如果起始值/调用序列不同，风缓存可能不同；精确复播必须恢复快照并重放相同时间序列。仅广播 seed 无法重建任意晚加入时的已缓存风。

API 明确限定关卡时间 `0..1,000,000` 秒和单次 catch-up 最长 `300` 秒；越界或倒退在修改状态前报错。它们是本模块工作预算，**不是原引擎时间 clamp**。恢复/重播调用由宿主选择，不能悄悄跳时或改成零风。重复的原 float32 时间保留原行为，包括 JS `.1` 重复输入；先转 float32 再比较。菜单暂停/服务器继续走时的时钟策略由接入方明确决定。

## 原数据与原调用链

原 Dust2 `output/source1/de_dust2/lumps/00-entities.bin` 仅一个 `env_wind`：hammerid `2568362`，origin `1408 2168 40`，angles `0 0 0`；min/max wind `2/4`，min/max gust `3/6`，min/max gust delay `10/20`，duration `5`，dir change `20`。这些值保持原标量，没有擅自换成米/秒。

server `0x67b0a3..0x67b0db` 直接执行参数准备后停在 Init 调用前，32 个不同时间/yaw/entityIndex 样本回读确认：seed **0**、initial speed **0**、time 为服务端 `gpGlobals+0x10`、direction 为 entity yaw 转 int。这里不需要推断未知全局 RNG 历史；仍保留 API 显式 seed 以便非默认回放。server 起始 curtime 的运行时数值没有被假设为零。

客户端 `C_EnvWind` shared 区在 entity `+0x9c8`；网络更新 `0x9fecf0..0x9fed54` 读取网络 seed/startTime/initialDir/initialSpeed 调用 `CEnvWindShared::Init`。`0x9feca7..0x9fecbf` 的 Think 参数是客户端 `gpGlobals+0x10`。`C_BaseEntity::operator new` `0x9c6870..0x9c68be` 的 `memset` 重定位在 `0x9c68af`，证实整个实体先清零；shared constructor 和 Init 不写 sway 时间/三份风缓存，所以首次它们从 **零** 开始，不能把 swayTime 自动设置为 startTime。

时间到 shader 的同构建原指令链也已闭合，9 组输入值逐段原指令转交、回读完全一致：

| 环节 | 原地址/证据 |
|---|---|
| 引擎向客户端传全局时间结构 | engine `0x3bbba7` 传 `0xead6c0`，调用 client vtable[0]；client vtable `0x100e8c8` 对应 `0x760360`，在 `0x7603b5..0x7603c8` 存至 `0x1492c10` |
| 客户端 WindThink 取 curtime | client `0x9feca7..0x9fecbf` 解引用上述结构 `+0x10` |
| 引擎设置 shader 时间 | engine `0x5fe030..0x5fe03f` 将同一 `0xead6d0` 送入 render context vtable `+0x31c` |
| material context 转交 | `CMatRenderContext` vtable `0x114e48`，`+0x31c → 0x7c930`，尾调用 shader API `+0x404` |
| shader 时间存取 | shaderapi secondary vtable `0xcaf54`；`+0x404 → 0x578a0/0x578b0` 存 float member `+0x37a4`；`+0x20 → 0x3ad20/0x3ad30` 原 `CurrentTime` 转 double 返回 |
| 原 treesway 消费 | 先前已验的 x64 stdshader `0xc6d5a` 动态 `CurrentTime`，`0xc8deb..0xc8df3` 读 rendering parameter **3**；`0xc6d8d..0xc6e1d` 写 c12 `[0,time,windX,windY]` |

此处逐段验证接口数据传递，资源对象地址由 oracle 提供；没有启动整个引擎或假称已执行网络时间同步。

## 原状态机关键顺序

1. Init 把两条独立 `CUniformRandomStream` 设为同一 seed，angle/speed variation 初始为 `1`，gusting 为 true；sim/switch/variation 时间设为 startTime。当前初始方向保留传入 int，网络初始方向经过原 anglemod 量化。
2. 每跨越 `.1f` 变化边界，variation stream 连续取 `RandomFloat(-10,10)` 和 `1+RandomFloat(-.2,.2)`。保持原 float32 累加，不能用 `floor(time*10)` 替代。
3. **计算本次当前风之前**，每跨越 2 秒把旧 currentWind 放入 sway 缓存。漏过两个以上边界时，两份缓存都变为上一次 Think 的同一旧风。时间缓存与当前风更新的先后不能交换。
4. 原渲染风为 `f32((previous + f32((current-previous)*alpha)) * .5)`，`alpha=f32(f32((time-swayTime)*.5)+1)`。render parameter 3 是该结果，不是瞬时 currentWind，也不是固定 `[2,0]`。
5. gust 切换比较为 **strict greater**。到达 switchTime 恰好相等时不会切换，下一次超出时才切。目标风速向上追赶 `150/s`、向下 `15/s`。
6. 当前为 gust 时，average stream 取整数 normal speed，随后 switch 增量为 **minGustDelay + RandomFloat(0,maxGustDelay)**。Dust2 此阶段为 10–30 秒随机延迟，不能误写成 RandomFloat(10,20)。原 SSE 次序是 `(oldSwitch+minDelay)+random`。
7. 当前非 gust 时，取整数 gust speed，再取整数 direction delta，做原 anglemod/截断；switch 增加 duration。角度从度转弧度后原 AngleVectors/FSINCOS 给方向，乘 speed×variation 得 currentWind。

2 秒 catch-up 在模块中用等价 O(1) 处理：在受限时间域，swayTime 是完全可表示的 2 秒整数；跨一格保留旧 currentSway，跨多格使用同一旧 currentWind。晚创建 native 样本验证该优化；没有改变几何或 wind 缓存采样点。

## 独立验证与复现

```sh
.tools/source-binary-venv/bin/python scripts/probe-source-wind.py
npx vitest run tests/source-wind.test.ts
npx tsx scripts/validate-source-wind.ts
```

oracle 执行安装包 **完整 client Init / ComputeWindVariation / UpdateTreeSway / WindThink / AngleVectors**，包含原 x87 `FSINCOS` 指令；两条独立的原 vstdlib 完整 SetSeed、GenerateRandomNumber、RandomFloat、RandomInt 供返回值。只适配单线程 ID、network dirty 通知、render context 资源调用和捕获 SetVectorRenderingParameter；没有用 Python wind/RNG 算法替换原算术。

5 组调用序列，**12,427 次 Think、75 次 gust 切换**，覆盖 Dust2 60 Hz、负 seed、不等帧、2147483647/−2147483648 种子、晚创建、跨多个阵风稀疏更新、strict boundary。172,783 标量比较、149,172 向量分量、其中 10,880 RNG 字段：采样最大误差 **0**。独立 validator 在 128 个位置执行 JSON 存储恢复后继续原 fixtures 仍零误差；单测另有 3,388 帧不中断/恢复并行比较。10 项测试通过。

`output/tests/source-wind-native.json` SHA256：`fc8d415a3f43fc5168df952e37a0215123d2d8dbac52f9a3d607054cd1fe410f`。汇总见 `output/tests/source-wind-validation.json`；红绿日志 `output/source-wind-red.log`、`output/source-wind-paused-red.log`、`output/source-wind-green.log`。暂停重复 `.1` 的 float64/float32 比较问题已用真实失败再修复。

这组证据是离散原指令输入和纯模块对齐；不是物理 x87 最后一位跨处理器担保、全部连续输入证明、完整宿主调度、联机时钟或本轮 GPU 验收。先前 foliage 的 70 mesh GPU 证据保持独立，不重复运行。

官方 SDK 仅提供公开参照，结论优先上述同构建二进制与 Dust2 原 lump：[env_wind_shared.cpp](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/env_wind_shared.cpp)、[env_wind_shared.h](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/env_wind_shared.h)。无付费依赖、插件安装或泄漏源码。

## 原文件身份

| 文件 | SHA256 |
|---|---|
| csgo/bin/client_client.so | `21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb` |
| csgo/bin/server.so | `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386` |
| bin/libvstdlib.so | `bed32bd6bc26d6808b3e003fdf57066e0df884f2b264255450bdc75f64b314af` |
| bin/engine_client.so | `4ab884d3acfc94f2687f5504724d10d3270a46e29cab4c6aad3ec6feae71c312` |
| bin/materialsystem_client.so | `223ebff789b330fe7a1ab102ab08d297140b5e982e17925b6368d7e727712176` |
| bin/shaderapidx9_client.so | `4b476b4924b56b9861f9cffee9101270f15826de4821982acf38478147817b65` |

全部在脚本运行前校验完整 SHA。旧包文件只读；新增资源仅私有 wind 调查与回读文件。
