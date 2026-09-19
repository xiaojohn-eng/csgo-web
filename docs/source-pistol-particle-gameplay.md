# 原手枪枪口粒子主版本接入

R4 本地第一人称射击使用原 PCF 的 main/core 系统、CSheet 帧和原粒子材质。原始输入固定 SHA 校验；实际接受的射击事件从原枪口附件进入同一 gunScene 米制空间，替代三种原手枪的旧锥形火焰。预测射击与权威确认共用去重路径。

原函数 getter 的8种返回组合已核验：Glock、Deagle、卸下消音器的 USP 使用普通 pistol flash；USP 原 mode1 表示已装消音器，alt 字段为空。该空字段只说明此路径不触发普通 main/core，不是对原作所有动态光或其他效果的不存在证明。

## 原随机与时间调度

R2 已接入原4096项随机表、批量初始化的取数顺序和 main/core 各自时钟。主批量消耗44项随机数，core批量48项；索引渐隐使用原表。一次50ms页面帧经过原初步调度后，main第一步7.5ms、core第一步15ms；零时长更新不重复推进。

原默认 collection seed 包含地址与 `Plat_MSTime()`，网页没有相同地址/启动时钟；当前默认种子是明确的浏览器展示适配，并非两程序自然随机流逐发相同。core固定8粒子批量与小于7ms首步的原渐进发射仍有差异，不能由已通过的普通页面帧推导全部 dt 一致。

## 主版本证据

- `output/playwright/source-r4-pistol-particles-gameplay-gpu.json`：第一轮真实训练，三种普通枪口均出现4 main+8 core，5份资源 SHA 全通过，旧锥体隐藏；装消音器 USP 扣弹但不生成普通粒子。
- `output/playwright/source-r4-pistol-particles-r2-gameplay-gpu.json`：R2 构建重做同一组实际训练，Glock/Deagle/卸消音器 USP 各一次 burst、实际呈现帧4+8，装消音器 USP 无普通 burst；`errors=[]`、`rooms=[]`。每份证据包括真实渲染后读取的 PNG 和当帧两套时钟；没有改变模拟、弹药或渲染时间。
- `output/playwright/source-r4-pistol-particles-r2-lan-gpu.json`：R2重新运行两个真实 LAN 浏览器，Deagle 本地预测+收到确认只增加一次 burst，旧锥体不显示；原购买、换弹、CT手臂及T Glock回归仍通过，`errors=[]`、`rooms=[]`。更改前第一轮保留为 `source-r4-pistol-particles-lan-gpu.json`。
- `tests/source-pistol-particle-renderer.test.ts` 的14项独立复核覆盖 SHA/取消/释放、容量与缓冲、米制空间、R2时间推进；原选择、图及 native clock/RNG 有各自测试。当前完整回归140文件751测试通过。

初次把 USP 模式含义接反的失败证据仍保留在 `source-r4-pistol-particles-first.json`，修正后重新执行真实射击，未修改旧失败记录。

## 后续范围

当前是本地第一人称 main/core。远端世界枪口、原 smoke_small、sparks4、深度羽化、HDR、完整效果寿命/性能及原弹壳/弹着仍待接入与最终画面对照。已有通用效果不能计入这些原版完成项。
