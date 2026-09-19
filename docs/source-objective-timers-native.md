# 原版 C4 时间：build 12426148 原机器码证据

2026-09-13。只读探针，没有改游戏规则、运行服务或创建房间。

| 项目 | 确认结果 | 原 Linux x64 二进制证据 |
| --- | --- | --- |
| 安包内部截止时间 | `curtime + 3.0` 秒 | `CC4` vtable slot 319 → `0xf16c60`，含 `bomb_beginplant`；`0xf17022` 加 double 常量 `0x13a3130`，原字节 `0000000000000840`；`0xf1706a` 写 `+0xd80`。 |
| 安包完成判断 | 当前时间达到截止时间 | `0xf17447` 读 `+0xd80`，`0xf17452` 读当前时间，`0xf17457` 比较，`0xf1745a` 的 `jae` 进入完成分支。原 sendtable `0xf15ecb/0xf15ed4` 将此字段命名为 `m_fArmedTime`。 |
| 有工具包拆包 | 5 秒 | `CPlantedC4` vtable slot 102 → `0xf12c30`；`0xf1342e` 调 getter `0xdeaeb0` 读取玩家 `+0x1b00`；非零分支 `0xf1343b` 写位型 `0x40a00000`，即 float32 `5.0`。 |
| 无工具包拆包 | 10 秒 | 零分支跳 `0xf13613` 写位型 `0x41200000`，即 float32 `10.0`；合流后写 `+0x6c8`，加当前时间写 `+0x6cc`。原 sendtable 分别命名 `m_flDefuseLength`、`m_flDefuseCountDown`；玩家字段名为 `m_bHasDefuser`。 |
| `mp_c4timer` 注册默认值 | 40 秒 | `0x5bec71` 为构造函数 `rdx` 装入字符串 `40`，`0x5bec78` 为 `rsi` 装入 `mp_c4timer`，`0x5bec86` 调原构造函数 `0x10654a0`。 |
| 引信真正使用的时间 | 配置值，经 GetInt 转 float | `0xf194bd` 读取同一个 ConVar 对象 `0x1d98340`；`0xf19506` 以后将 GetInt 返回值写 `m_flTimerLength(+0x6b4)`，加当前时间写 `m_flC4Blow(+0x644)`。 |

原资产：`.reference-assets/csgo-legacy/csgo/bin/linux64/server_client.so`。
SHA256：`5dc259006b3251e48c39cf30a86aae149da36c975fda054d0314907b7391845c`。
探针固定此哈希与关键指令字节；不同二进制会明确失败，避免把错误地址当同一版本。

探针使用项目已有的 pyelftools、Capstone、Unicorn。执行原注册参数准备代码，在构造函数入口停止，实取 `name/default/help`；随后对 4 个当前时间，各执行原安包块、2 个拆包分支，以及 GetInt 后的 3 个引信输入块，共 **24 组**。实体与全局时钟是明确构造的内存，网络 dirty-state 对象为空以避开无关更新调用。实际拆包 getter、原条件跳转、float 运算和字段写入均执行原字节。

可重复命令（从仓库根目录运行；也可按本地 Python 环境调整 `PYTHONPATH`）：

```sh
PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-objective-timers.py
```

输出：`output/goal-objective-timers-20260913/receipt.json`，包含原指令/字节/地址、原字段 metadata、逐例结果、二进制与配置文件哈希。脚本支持 `--binary`、`--cfg-root`、`--output`。

边界：

- `3.0` 是内部开始安包到截止时间的规则；未验证完整动画时长或输入到显示的延迟，不能据此宣称所有视觉动作正好持续 3 秒。
- `40` 是原注册默认。原 `gamemode_competitive.cfg`、`gamemodes.txt` 未出现覆盖；原 `gamemode_survival.cfg` 有 `mp_c4timer 18`，不适用竞技。部署配置、插件、控制台仍可覆盖，不能把所有原版服务器一概称为 40 秒。
- 引信原运算分别以显式给定 GetInt 返回值 `40/35/18` 执行，证明它遵从配置；没有执行完整 ConVar 子系统或完整原版服务器。
- 仅核验该 Linux x64 服务端二进制；没有独立执行 32 位/客户端版本，没有进行浏览器或联机实玩。这些结果不构成完整目标交互、原动画或整局验收。
