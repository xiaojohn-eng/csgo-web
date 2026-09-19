# Desert Eagle 主线接入与证据

原 App 740 build 12426148 的 Deagle 已接入 T/CT 购买、副武器库存、服务器与预测、原手臂和人物姿态、原音频。此记录只覆盖沙鹰的已验证部分，不表示完整 CS:GO 复刻完成。

第二批工作树统一基线为 `1c21fffeb5189c3dcda484c552aa9696675e9b17`。武器线交付 `d6a38dde`、`680cb3a`、`156ab6cb`；主目录按路径导入并完成共享模拟、网络及浏览器接线。220 个资源共 306,968,895 字节逐文件校验 SHA，回执在 `output/worktrees/deagle-asset-receipt.json`。原第一人称 9 个片段、639 帧，T/CT 两套手臂、世界枪与人物姿态、22 个音频别名使用独立资源所有者；详见 [资源记录](source-deagle-assets.md)。

## 命令、数值与动画

原服务器 SHA 为 `7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386`。原 RTTI `7CDEagle`、vtable `0x12f75dc` 确认它沿用 base-gun 命令，但 `0x47c` 槽的 `0xd4ffc0` 在扣弹前检查 clip=1，把射击 activity 从 192 改成 195。因此末发实际播放 `shoot_empty`，不是普通射击的程序补位。

原价格 700，弹匣 7、备弹 35，射速间隔 .225 秒，移动速度 230 Source 单位/秒。普通伤害 53、头部倍率 3.9、护甲比例 1.864、射程 4096、距离衰减 .85；头部倍率先转 float32 再参与原乘法顺序。原 jump apex 非零，独立 Deagle 数值 profile 保留该区别，旧 Glock/USP handling 快照格式不变。玩家共享 punch 仍只推进一次。

原第一人称 reload 为 66/30=2.2 秒，事件 54 在 cycle `.39393940567970276` 提前补弹；补弹后原攻击门禁仍未结束。世界枪 reload 为 77/30 秒，弹匣隐藏/显示用自己的原事件；这两个层的时长没有互相替代。原 inspect 两序列都进入动画时钟的门禁处理，目前浏览器主动检视选择 `lookat01`；原随机射击/检视权重仍未闭合。

原机器码通过明确的资源查找适配器运行，目标函数内部算术不由 JS 代算。冻结语料包括：

| 范围 | 独立原程序证据 |
| --- | --- |
| 命令 | 1,140 cases，含 720 条连续命令、生命周期；另 16 个动画事件处理 cases |
| 动画时钟 | 676 帧、189 个请求门禁 |
| 数值 | 328 准确度上下文、138 个已接受 bullet、5 deploy、5 reload、480 条连续状态 |
| 伤害 | 630 cases，JS 与原输出最大 float 误差 0 |
| 落地 | 18 个状态与 3 条连续链 |

生成脚本为 `scripts/probe-source-deagle-{command,animation-clock,handling,damage,landing}.py`；证据在 `output/tests/source-deagle-*-native.json`。原活动选择、随机环境与资源适配的限制保留在各语料 `limits`，不能外推为完整原引擎已移植。

## 购买、网络与独立复核

购买只替换副武器并收取 700，原主枪弹药保持。重新购买已拥有副武器失败且不修改状态；换枪恢复各自弹药和命令状态。T/CT 原 Deagle pose、runtime、handling、clock、damage 身份共同进入仿真版本。`scripts/source-simulation-identity-smoke.ts` 验证两个 SDK 客户端正确握手、旧 USP 版本与缺失版本被拒绝、缓存及退出清房。

独立复核找到并修复两个真实问题：

- 空仓命令已执行但没有传声音事件。权威模拟现在为已接受 `empty` 发出一次 `Default.ClipEmpty_Pistol`，由现有事件 ID 去重及原 WAV 调度播放；预测不发事件。测试正常射击全部 42 发和五次自动换弹后，再扣扳机并推进门禁内六 tick，只有一个空仓事件。
- 在最后一个购买 tick，旧 slot=0 输入可在快照发送前重新切回步枪。客户端现在按快照的主/副武器库存确认购买，再选择对应槽位。测试自然推进到阶段边界、复现 live/m4a4/secondary=deagle，再通过下一条 slot=1 恢复沙鹰，钱只扣一次。

两个回归测试分别为 `tests/source-pistol-empty-sound.test.ts`、`tests/source-buy-boundary.test.ts`。主目录目前 129 文件、690 项测试通过，类型检查与 R4 构建通过；日志在 `output/source-r4-second-wave-{tests,typecheck,build}.log`。

## 实际浏览器

以下记录使用真实 UI 与正常输入，没有注入弹药、阶段或武器状态：

- `output/playwright/source-r4-deagle-gameplay-gpu.json`：T 购买、原手臂、按住只射一发、手动/自动换弹、提前补弹门禁、末发 `shoot_empty`、检视、主副枪弹药、走/蹲、原 WAV；errors=[]、rooms=[]。
- `output/playwright/source-r4-deagle-lan-gpu.json`：两个真实浏览器经 `ws://192.168.1.100:27019/` 联机，CT Deagle 原手臂与动作、原 WAV、两端完整姿态/身份、T 默认 Glock 回归；errors=[]、rooms=[]。
- `output/playwright/source-r4-deagle-empty-gpu.json`：实际训练正常打完 42 发后，ammo=0/reserve=0，单次空仓扣扳机，dryFireCount=1、原空仓 WAV 事件=1；errors=[]、rooms=[]。

root 已查看 T 检视、末发和 CT LAN 检视截图，原手/枪确实出现在最终场景。两个 LAN 浏览器位于同一台 Mac，第二台物理设备、长时间十人对战仍待验收。完整 AnimState/IK、原材质光照、全部 PCF 子系统、原随机动作、穿透和其他武器仍在总目标待办内。
