# 原版连败奖金在胜局后的处理

server_client.so build 12426148 的回合结算函数为 0xd97b10（长度 0xfbb）。其 outcome=2 分支在 0xd98564 读取 mp_consecutive_loss_aversion：

- 0xd98570 比较返回值 1，跳到 0xd9881b；该路径读取队伍连败计数，执行 sub ebx,1（0xd9883b），cmovs ebx,0（0xd9883e），再写回（0xd9884a）。
- 默认注册值在 0x5bf7a9 为字符串 1，名称在 0x5bf7b0。帮助串位于 0x143e8d0，明确写出 1 = first win steps down loss bonus。
- 0xd98599 路径把连败计数写成 0，是 mp_consecutive_loss_aversion=0 的完全重置行为。
- 0xd98579 比较返回值 2，进入 0xd98851 的第二种规则；该模式会读取 mp_consecutive_loss_max 并按其规则下调。

mp_starting_losses 原注册默认是字符串 0（0x5bf754），竞争配置覆盖为 1，短竞技配置覆盖为 2。mp_consecutive_loss_aversion 没有竞技配置覆盖，因此端口若按发货配置运行应采用默认 1。

当前游戏端 game/simulation.ts:1556 无论配置都把胜方 streak 直接设为 startingLosses，相当于 aversion=0；这会在胜方此前有多级连败时少保留一个原版下调阶梯。应由主线实现 owner 状态并补测试；不要把本证据误解为每次胜局都重置到 1400/1900。

可重复探针：

    PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-economy-round-end.py

输出 output/goal-objective-timers-20260913/economy-round-end-receipt.json，固定服务端 SHA256 5dc259006b3251e48c39cf30a86aae149da36c975fda054d0314907b7391845c 与关键字节。探针只做 ELF/Capstone 读取，不运行服务、不改代码；完整奖金发放顺序和实际对局仍需另行验收。
