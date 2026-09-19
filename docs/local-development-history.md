# CSGO WEB · 局域网战术竞技开发版

浏览器第一人称战术射击工程，支持本地训练、Node 权威局域网房间、最多 10 名玩家与 AI 补位。当前开发主线为独立 R4：原 Dust II 地图、碰撞、NAV、PVS、天空，双方人物与手臂，以及 AK-47、M4A4、Glock-18、USP-S、Desert Eagle、AWP 六种枪械已经接入。当前源码、验收范围与剩余问题见 [Trae 接续记录](docs/trae-handoff-20260913.md)。

已接入的系统还包括逐武器射击与换弹、AWP 两级开镜、原枪口/弹壳/曳光/弹孔资源、皮肤合成、服务器尸体快照、脚部地形适配、竞技赛制与购买区。**完整复刻仍在开发**：动作、物理、光照、烟雾、经济与全武器覆盖各有未完成部分；已有功能也需按对应验收记录判断，不能把资源存在或单项测试通过当成全流程一致。

R4 入口为 [本机 Dust II](http://127.0.0.1:27019/?map=de_dust2) 和 [本次核对的局域网 Dust II](http://192.168.1.100:27019/?map=de_dust2)。IP 会随网卡变化，以 `npm run source:status` 和 `/api/server-info` 当前返回为准。R4 与保留的 R3（27015，旧港口/C02）使用不同输出目录、状态文件和端口。

```sh
npm run source:start
npm run source:status
npm run source:stop
```

R4 源码变化后运行 `npm run source:check -- --id r4-你的版本名`，在独立候选目录完成类型检查、全量测试、前后端构建与运行资产 SHA 校验。`source:build` / `source:stage` 只构建独立候选，不覆盖运行版。候选浏览器及联机验收通过后，按 [R4 发布与回退流程](docs/source-release.md) 检查并替换服务。碰撞、动画或库存规则更新会改变仿真身份，旧网页必须刷新后才能加入新房间。

## 保留的 R3 入口

双击 `启动局域网游戏.command`，终端会显示本机和当前网卡地址。房主打开页面后创建房间；同一局域网的其他电脑打开终端所示地址，在房间列表加入。房主的服务进程需保持运行。退出网页房主可以转移房间管理权；停止服务器会断开整个房间。

```sh
npm start
npm run status
npm stop
```

默认本机入口为 <http://127.0.0.1:27015/>。局域网 IP 会随网络变化，以启动器或页面显示为准。

## 操作

| 操作 | 键位 |
| --- | --- |
| 移动 / 视角 | WASD / 鼠标 |
| 射击 / 瞄准、Glock 模式或 USP 消音器切换 | 左键 / 右键 |
| 跳跃 / 蹲伏 | Space / Ctrl 或 C |
| 换弹 / 主副武器 | R / 1、2 |
| 检视武器 | F |
| 爆破弹 / 烟雾弹 / 闪光弹 | G / V / Q |
| 安拆装置、交互 / 购买 | E / B |
| 战况 / 释放鼠标 | Tab / Esc |

进入战场时点击按钮捕获鼠标，暂停后点击「继续行动」恢复。六种枪械在武器库中各有默认外观和已支持的原版涂装，可调整图案编号与该涂装允许的磨损范围。用 1/2 切换主副武器，分别保留弹药；AWP 右键依次切换两级开镜与解除瞄准。

原角色投掷动作、布娃娃死亡与脚部地形适配已有接线和专项证据。原投掷物弹道、爆炸/烟雾、完整动作图与原引擎 IK/物理逐步对照仍在进行，详见 [还原进度](docs/parity.md)。

## 开发与校验

需要 Node.js 22.13 或以上。当前项目已安装独立依赖，不依赖另一个工程的 node_modules。

```sh
npm ci
npm run dev
npm run typecheck
npx tsc --project tsconfig.server.json --noEmit
npm test
npm run source:check -- --id r4-my-candidate
CSGO_TEST_PORT=27017 npm run test:lan
```

开发入口为 127.0.0.1:27016，原版地图需要 `?map=de_dust2`。R4 候选输出为 `release/source-candidates/r4-版本名/{web,server}`；实际运行版仍为 `release/source-r4`。普通 `build` / `qa` 会写保留 R3 的 `release/web` 和 `release/server`；开发 R4 时使用 `source:check`。服务器正在运行时使用其他端口跑 LAN smoke，避免占用 27015 和 27019。

`public` 内资源是本机实文件，未纳入 Git；仅复制 Git 源码不能恢复资产。迁移工程需一并复制 `public`，保留其中的来源与许可说明。原版资产来自本机官方 App 740 安装；转换依据与校验记录在 `research`，原始安装与私有候选在 `.reference-assets`。当前构建使用本地同源资源，不需要外部付费 API。

实际测试资料在 `output/playwright` 和 `output/tests`；两浏览器联机目前在一台物理设备上验证，不能替代第二台电脑实测。[局域网运行说明](docs/lan.md)、[性能记录](docs/performance-review.md)、[共享步态合同](docs/locomotion-contract.md) 包含详细边界。
