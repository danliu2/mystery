# Mystery · 狼人杀

单人文字狼人杀桌面原型：一位真人与具有固定人格、外貌和跨局记忆的 AI 朋友同桌。确定性主持人负责规则裁决，模型只接收各自合法视野。

## 启动

需要 Node.js ≥22.18 和 npm。首次在项目目录执行：

```sh
npm ci
npm start
```

安装会准备与锁文件一致的 Electron 运行时；首次需要网络，macOS 已有的同版本缓存会在校验 SHA256 后复用。安装中断后可执行 `npm run setup-runtime` 重试。

依赖安装完成后，macOS 可以双击项目根目录的 `mystery.command`，或执行 `./mystery.sh`。启动脚本每次先构建。尚未制作签名安装包。

默认可直接选择“离线演示”游玩，不需要 Key。演示机器人使用简单策略，主要验证完整游戏流程。正式模型模式需要把 `api_key.env.example` 复制为根目录的 `api_key.env`，填写自己的服务地址、可用模型名称和 Key，再在设置页重新加载配置。服务需兼容 Chat Completions；远程地址必须使用 HTTPS，本地回环服务可使用 HTTP。配置文件作为文本解析，不执行其中内容。

连接测试、模型生成朋友及模型对局均会发送请求，可能产生服务费用；初次版本验证未调用真实付费模型；后续已按用户授权进行真实服务联调，结果见开发更新。UI 不显示 Key。

## 已实现

- 6–14 人固定配置；预言家、女巫、猎人、白痴、狼人和平民；10 人及以上警长机制。
- 静默狼刀投票、讨论、放逐及 PK、死亡技能、遗言、自爆、胜负判定和终局复盘。
- 男女各 10 位持续人格朋友，轮换、疲劳、休息及视野范围内的跨局经验。
- 默认即时显示（可选逐字播放）、身份练习、暂停续玩、事务存档、损坏尾部恢复及朋友池恢复确认。
- 角色提示词统一为可编辑文本，think 和私人决策理由存档，玩家完成出局后的遗言和技能后自动开放全视野观战，终局也自动展示全知记录。
- 独立模型上下文、结构化输出校验、有限重试、取消、请求及 Token 预算。

存档和朋友池位于 Electron 的用户数据目录，macOS 通常为 `~/Library/Application Support/mystery-werewolf`。文件包含身份和私人行动，应按个人存档管理。模型凭据仅位于根目录配置文件；`secret/`、实际 `.env`、依赖与构建产物均被 Git 忽略。

## 验证与文档

```sh
npm test
npm run typecheck
npm run build
npm run smoke
npm run simulate -- 1000
npm run format:check
```

`smoke` 会启动真实 Electron，以临时数据目录完成离线对局并打开复盘，不使用实际凭据。模拟参数是每种人数配置的局数，1000 对应合计 9000 局。

[设计文档索引](doc/README.md) · [开发状态、验证证据与已知限制](doc/09_development_status.md) · [玩家手册](doc/06_player_guide.md)

[即时显示、真实 LLM 与人物一致性更新](doc/10_llm_backend.md) · [提示词资源](resources/prompts/werewolf/README.md)

## 开源许可证

项目采用 [MIT License](LICENSE)。
