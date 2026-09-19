# Trae Work 接续记录 · 2026-09-13

本轮从当前主树 `65776d309e23a0fb96649e28c6e547d57380fb9e` 接续。它比之前 `b86938c` 多 112 次提交；没有恢复旧工作树覆盖 Trae 的提交。交接时的 7 个未提交皮肤文件已逐文件保存和 SHA-256 校验，补丁、副本、初始服务状态位于 `output/handoff/2026-09-13-trae-inheritance/`。

## 继承的当前实现

- 原 Dust II 几何、碰撞、NAV、PVS、双层天空、环境雾和地图光照参数；原静态道具、天空与 world 批处理。
- 六枪 AK-47、M4A4、Glock-18、USP-S、Desert Eagle、AWP，双方人物与手臂、原模型/动画/声音；AWP 两级开镜及专属弹壳、曳光、枪口系统已进入游戏。
- 尸体进入服务器快照并由两端显示；全部武器角色调用脚部地形适配，角色原投掷动作已接入。
- 最多 10 席位、AI 补位、短竞技/完整竞技、原金额与回合计时、逐武器击杀奖励、原 Dust II 队伍购买区。
- 皮肤按原 paint kit、图案编号、磨损窗口、颜色/指数程序合成；继承时已提交菜单 77 张，未提交增量再增加 10 张 style 5。

## 本轮完成的接续修复

1. **皮肤扩展**：保留新增 10 张金属涂装。修正 style 5 强度不除武器 boost、albedo factor 原六位小数序列化、克隆材质的 boost 和 factor 小于 1 的原程序选择。AWP 无畏战神的材质 boost 为 60，沙鹰青铜装饰为 70；低因子颜色程序 static165，指数请求175经原 alias 映射15。六枪菜单共 87 张：18 / 14 / 14 / 19 / 17 / 5（AK / M4 / AWP / Glock / USP / Deagle），不含默认外观。实际 GPU 换装另发现 AWP395/Glock1119/1120/1122 使用原 RGBA 颜色记录，已按原程序四字节跨度只读取 RGB 的依据兼容，保留并校验原 alpha，不改资产来掩盖异常。
2. **曳光**：每个 Source 权威 shot 带实际末端，人物命中和射程耗尽不再缺失原曳光；Dust II 不再同时创建旧黄线和黄球。本机正常抛壳与 R3 原行为保留。频率字段 3/1/0 的原派发语义尚未验证，本轮没有猜测筛发。
3. **比赛结算**：短竞技 8:8、完整竞技 15:15 均正常平局结束，过期 nextRound 不会继续加局；正式重开仍有效。界面显示“比赛平局”。
4. **击杀来源**：HE 击杀事件保留手雷来源，投掷者切到 AWP 等其他武器不会改变播报归属；Dust II 击杀栏显示手雷图标。
5. **首局冻结**：服务器直接构造比赛时也使用原配置的 15 秒，修复只有后续回合取原值、首局仍为 12 秒的遗漏。
6. **交接说明**：README 与经济文档删除“AWP / ragdoll / 逐武器奖励 / 购买区未接入”等过时说法，R4 构建命令与入口单独列明。武器库换弹时间显示保留两位小数。

对应主树提交链：`d02d5ec`、`5b9c017`、`c317fb4`、`ea4d4e7`、`8d66d70`。皮肤源工作树提交 `33e0323`；先校验原 dirty 7 文件未被改动，再同步其 16 个源码/测试/回执文件及 6 个新增原生回执文件，没有覆盖既有原生证据。

## 验证记录

- 接续基线：198 文件、1,185 条测试通过。
- 首轮合并：202 文件、1,204 条测试通过；合并后修复测试中 shot/kill 联合类型的交叉冲突。
- 首局冻结新增后：经济、平局、曳光呈现 3 文件、27 条通过。客户端和服务器 TypeScript 检查、lint 已通过；lint 保留既有警告。
- 皮肤：10 张实际 kit/VMT 的原生机器码执行值与程序字节已核对，见 `research/source-style5-overrides.json` 和 `.reference-assets/source-exports/style5-albedo-overrides/`。
- 最终完整回归：**202 文件、1,207 条通过**，见 `final-tests-after-palette.log`；客户端/服务器类型检查和最终 lint 通过，lint 有既有警告、无错误。
- 实际 GPU：新增 10 张 style 5 均合成非空且不同的颜色图（1024）与指数图（256），和原生 scalar/selector 一致；原 style 7 identity 对照通过，见 `style5-gpu.json`。
- 原 AWP FP/world 同一模型/同一 owner 的默认→51→395→51→默认通过：两次雷击 framebuffer 一致，默认恢复 framebuffer 一致，镜片/手臂未被涂装修改。主线程已查看两张原世界模型渲染，导出的 10 张图片与说明在 `style5-images.json`。
- 当前运行游戏菜单回读总数 **87 张**；AWP395 与 Deagle425 实际装备 ready，均选择165/175，材质 boost 分别为60/70。见 `awp-manowar-equipped-final.json`、`final-menu-and-deagle.json`。
- 实际局域网：一个 loopback 与一个真实 LAN 地址的 SDK 客户端进入同一 Dust II 竞技房间；两席800、购买Deagle剩100、首快照14.95秒并自然在15秒开始、射击7→6与原 wood_panel 末端、对端同事件id的隐蔽报告过滤、两会话正常退出/房间清理均通过。见 `sdk-lan.json`。
- 独立候选构建后切入 `release/source-r4`，RGBA 修复再次更新 web；服务PID66507 / instance `11ebfe77-1f90-4c11-83e0-cf40874484b4`。核对 R3 索引/服务器文件/服务状态 SHA 均未变，当前 R4 health=ok、rooms=[]，见 `release-readback.json`。旧 R4 完整构建和后续 web 构建均保留可回退副本。以上文件均在 `output/handoff/2026-09-13-trae-inheritance/`。

## 必须保留的验收边界

旧 `source-r4-awp-gameplay-gpu.json`、`source-r4-awp-gameplay-live.json`、`source-r4-awp-lan-gpu.json` 当前文件均为 failed；后续 `source-awp-effects-ingame.json` 确为特效单枪 passed，不能代替完整开镜、换弹与双浏览器联机验收。

本轮 Ego Lite 能加载实际地图、菜单并购买 AWP，GPU 为 Apple M4 Pro / ANGLE Metal；鼠标捕获返回 `WrongDocumentError: The root document of this element is not valid for pointer lock.`。未绕过游戏输入门禁，未把本轮 SDK 仿真客户端称为浏览器实射或两台物理电脑。另一次浏览器截图请求超时，原错误保留。

完整经济尚未恢复：竞技出生/死亡后仍免费给主武器及投掷物，半场存活者的装备和资金未重置。需跨库存、出生、购买、预测、机器人与界面做完整专项，不能只改一个默认值。

投掷物弹道、HE 遮挡/高度伤害、烟雾、友伤、原引擎 IK/物理、地图绳索、太阳精灵、自动曝光及枪口烟等仍有明确缺口。9 月 10 日的 10 分钟性能记录不能当作新增特效/皮肤后的持续帧率保证。完整完美复刻目标未完成。

## 本轮失败记录与后续顺序

`awp-style5-switching.json` 和 `output/style5-preview/proof-2026-09-13T02-34-51-568Z-1.json` 保留修复前 RGBA 拒绝；前者第二次点击的旧 error 回读有测试等待条件竞态，不作为“雷击失败”的结论。修复后的真实 GPU 与运行游戏回读使用新文件，未覆盖失败证据。

下一轮优先级：竞技初始/死亡/半场库存与资金完整生命周期；标准桌面浏览器的 AWP 开镜、射击、换弹和双端实玩；枪口烟与远端弹壳；新构建多人/烟火负载性能测试。原模型渲染和 SDK 网络证据不能替代这些验收。

可复用经验已保存为 Obsidian `10-待审核/CSGO 金属涂装扩展须联验材质克隆、程序分支和实际换装.md`（candidate，未晋升）。它记录了可复现的原参数/程序检查与实际 RGBA 失败、修复后的 GPU/装备验证，不记录猜测或历史授权。
