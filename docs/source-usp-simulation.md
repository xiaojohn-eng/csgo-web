# USP-S 主线接入与工作树验收

本轮采用四个隔离 Git worktree，主目录集中负责 shared simulation、profiles、server、runtime 和入口。WIP 检查点 `47a1cd571c07c6b2aa78e346b3225bc102b6c1d9` 保存当前代码，原主 HEAD 和 index 未改动；资源 APFS 写时复制，公共依赖仅复用。各分支自有增量经 `git diff`、`git apply --check`、人工审查后集成，详见 `WORKTREES.md` 和 `output/worktrees/checkpoint.json`。

USP 与 Glock 复用原 base-gun 命令、idle 和动画时钟，原具体行为仍分别在 runtime 中执行。新增库存 adapter 只路由当前手枪，服务器与预测使用相同路径；每次移动仅推进一份玩家 punch，OnLand、武器命令、VM PostThink 按共同顺序执行。T 默认 Glock，CT 默认 USP；购买另一副武器时删除被替换状态，主枪弹药独立保留。已有副武器购买返回失败，钱、弹药、消音器、动作和 punch 全部保持。原资源的 `Cstrike_Already_Own_Weapon` 提示是此购买门禁的参考，并未声称完整原购买函数已还原。

USP 的 44/46 动画事件决定消音器是否已安装，右键命令只启动动作和门禁。提前装填 54 只转移弹药，不提前开放攻击。Holster 在原提交前取消装卸；完成后的模式可以跨切枪保留。第一人称、人物层和世界枪层保留各自原时长；世界 SHOW/HIDE 与弹匣显示随网络动作时钟插值，只影响展示。原随机 shoot1/2/3 和第三人称 alt 动作选择、完整 AnimState/IK 权重尚未恢复。

枪声由已接受 bullet 的 mode 选原 WAV。隐蔽射击转为声音 report 时，只保留独立 `sourcePistolSoundMode`，不携带弹道、随机种子、punch 或 seq。已用真实 detach→fire→filterVisibility→AudioEngine 路径复现并复验，未消音不会隔墙变为消音枪声。新增状态和两队原姿态版本进入握手，旧客户端不能占用席位或加入新仿真。

手枪 FX 附件使用原客户端函数选出的名字：USP 消音器已装时 `muzzle_flash2`，其余为 `1`；原 `2` 抛壳矩阵保留完整朝向。已有锥形枪口网格只对齐原附件位置与方向，PCF 算子、原火焰形状、原弹壳模型和运动仍未移植，不能把这次附件修正叫作完整原特效。独立原函数 8 组合、四套模型 102 动画帧矩阵验证见 `source-pistol-fx-worktree.md`。

验证包含原 992 命令 + 96 动画 handler、790 动画帧 + 264 门禁、72 idle + 72 lifecycle；720 条移动、装卸、换弹、切枪连续命令的 JSON 快照重演与服务器状态完全一致。工作树提交分别为 audio `a6624e6e`、character `cce18ece`、material `e33a8015`、effects `7393b0eb`。完整测试、构建和身份握手日志在 `output/source-usp-final-full-tests.log`、`output/source-usp-fx-build.log`、`output/tests/source-simulation-identity.json`。

实际训练证据 `output/playwright/source-r4-usp-gameplay-gpu.json` 已通过：原 T USP、两种射击声音/枪口、提前装填、装卸提交门禁、取消重拔、检视、走蹲站、主副枪弹药；页面 errors=[]，返回主菜单 rooms=[]。第一轮脚本在买枪后同一瞬间读到了前一帧 AK render，失败证据保留 `source-usp-gameplay-first.json`；复验明确等待原 USP 实际渲染后才捕捉 draw，不降低判据。

同批四种原门框/线束 tint 已按 manifest SHA 逐文件复制并开启；主场景实际原静态光覆盖由 2459 增至 2640，其中旧 134 植被风动/64 olive no-CSM 不变。root 已亲眼检查门框前后对照与实际 USP 检视画面。门扇、铁栏等仍存在未恢复材质。实际双客户端 LAN 也已通过，证据 `output/playwright/source-r4-usp-lan-gpu.json`：CT 默认 USP、T 默认 Glock、原动作和完整 pose 快照、模式/弹药跨切枪、双方正确枪声、仿真身份、页面 errors=[] 和退出 rooms=[]。完整测试为110文件627项；类型检查和构建通过。单台 Mac 两浏览器不能代替不同物理设备验收。
