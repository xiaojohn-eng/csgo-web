# 局域网游玩与验证

当前开发主线是 R4：网页和权威房间服务共用 `27019`，协议族为 `csgo-web-r4`，原版 Dust II 使用 `?map=de_dust2`。保留的 R3 旧港口入口使用 `27015` 与 `release/web`、`release/server`；项目根目录的旧 `.command` 启动器属于 R3。

## 启动已有 R4 运行版

需要 Node.js 22.13 或以上、锁定依赖，以及已经验收的 `release/source-r4/{web,server}`。在项目目录运行：

```sh
npm run source:start
npm run source:status
npm run source:stop
```

启动不会修改源码或自动构建。房主打开 `http://127.0.0.1:27019/?map=de_dust2`，创建房间后将界面里的局域网地址与六位房间码给同网玩家。其他电脑必须使用真实网卡地址，不能使用房主的 `127.0.0.1`。同房间最多 10 个战斗席位；空位由 AI 控制。

可选短竞技（16 回合、先到 9 胜、第 8 回合后换边）与完整竞技（30 回合、先到 16 胜、第 15 回合后换边）。按房间码加入时采用该房间实际赛制；从列表明确选择的赛制须与服务器匹配。Source 地图、动作或库存规则身份不匹配时拒绝加入，刷新网页以加载当前版本。

服务默认绑定 `0.0.0.0`。Origin 白名单仅包含本机 `localhost`、`127.0.0.1` 和启动时实际网卡的私网/链路本地 IPv4 地址，均使用当前端口；无通配符。网页、房间 API 和 WebSocket 共用规则。切换网络后，可在没有正在进行的比赛时重新启停服务以刷新地址。入口不修改系统防火墙或路由器设置。

`GET /api/server-info` 返回当前 `protocol`、`port`、`localUrl`、`lanUrls`、`urls`、`maxPlayers`。分享使用 `lanUrls` 并带上 `?map=de_dust2`；IP 以本次查询为准。

## 会话与服务边界

- 服务端 60 Hz 模拟、20 Hz 快照；玩家只提交输入与购买请求，生命、位置和库存由服务端决定。
- 意外掉线保留席位 30 秒，清空输入，比赛继续。网页会把 Colyseus `room.reconnectionToken` 保存在本地，并在局域网面板提供“恢复上次席位”入口；恢复失败或服务端超时会清理 token，显式离开也会清理。房主离开时仍由服务端完成 host handoff，token 只恢复原玩家席位，不恢复房主权限。
- 网页房主离开时转移房间管理权；停止 Node 服务会断开所有房间，不是服务器迁移或续局。
- 正常离开或超时后，席位回到 AI；最后一个真人离开后清房。
- 原版涂装通过 `sourceFinish` 校验和同步，旧独立皮肤 ID 通过 `skin`。每名玩家只能修改自己的外观。

R4 状态存 `.lan-source-service/state.json`，日志存 `.lan-source-service/server.log`。启停核对入口绝对路径、PID、启动指纹和服务实例；重复启动沿用同一实例。端口被其他程序占用时拒绝接管。开发进程应在其原终端停止。

## 开发候选与回退

源码和 Git 忽略的原始资源需分别保留。不能仅 `git clone` 后声称已能恢复游戏，不能把 `.reference-assets` 约 42 GB 全部当成浏览器运行资源。

```sh
npm run source:check -- --id r4-my-candidate
npm run source:verify -- --candidate release/source-candidates/r4-my-candidate
npm run source:preflight -- --candidate release/source-candidates/r4-my-candidate
```

这些命令不覆盖或启停运行服务；创建新候选、检查源码/锁文件与 SHA，并输出可审查的替换/回退步骤。流程、候选试跑与未打包依赖见 [source-release.md](source-release.md)。

## 验证范围

`tests/net-session.test.ts` 和 `tests/initial-sync.test.ts` 使用独立端口上的实际 Colyseus 服务器、SDK 和受控场景。它们能检验身份、席位、输入与恢复契约，不能证明原版画面或跨设备游戏手感。

对运行中的独立 R4 候选，使用以下脚本并传入候选浏览器读取的完整 `simulationVersion`；每个脚本只创建和清理自己的测试房间：

```sh
node --import tsx scripts/verify-source-economy-lan.ts --server-url http://127.0.0.1:27039 --peer-url http://局域网IP:27039 --simulation-version 完整身份
BASE_URL=http://127.0.0.1:27039 node --import tsx scripts/verify-source-finish-gallery-lan.ts --peer-url http://局域网IP:27039 --simulation-version 完整身份
```

一台电脑上使用回环和真实 LAN 网卡的两个 SDK 仍只是一台物理设备。目标中的两电脑完整短竞技、十席 60 分钟、100ms RTT、真实键鼠/音频/皮肤同步，以及前台性能和干净恢复均需各自记录实际证据。旧 `csgo-lan-smoke.ts` 与 `test-lan-service.mjs` 的 R3/旧地图结果不能替代 R4 验收。
