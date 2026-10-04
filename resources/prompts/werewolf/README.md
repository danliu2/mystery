# 狼人杀 LLM 提示词资源

所有角色和辅助 agent 的提示词均为 UTF-8 文本，每次请求时读取，修改后下一次请求即生效，无需重新构建。修改应保持合法动作协议和视野约束。

- `player.txt`：人格与动作输出共同模板。
- `wolf.txt`、`villager.txt`、`seer.txt`、`witch.txt`、`hunter.txt`、`idiot.txt`：六种身份的策略提示。
- `rules.txt`：共用规则摘要；实际裁决仍由规则内核负责。
- `creator.txt`、`reflection.txt`：人物生成、本人视角跨局反思。
- `repair.txt`、`connection.txt`：格式修复和显式连接测试。

Player 占位符：`{{name}}`、`{{style}}`、`{{personality}}`、`{{energy}}`、`{{irritability}}`、`{{catchphrases}}`、`{{roleName}}`、`{{roleStrategy}}`、`{{rules}}`、`{{actionExamples}}`。未知占位符会报错。

动作返回格式：

```json
{
  "schemaVersion": 1,
  "windowId": "当前窗口",
  "action": { "type": "exileVote", "targetSeat": 3 },
  "decisionReason": "我暂时相信2号张三的公开发言；3号李四前后矛盾，因此本轮选择放逐3号。以上判断属于推测。"
}
```

`decisionReason` 是模型提供的私人理由，必须非空，程序上限 2000 字符；模板建议 50–300 字。它不属于公开发言。`action.text` 才是 speak 动作的公开文本。服务返回的 `reasoning_content` 单独保留，不要求模型在最终 JSON 中重复思考内容。

不得在模板中填写真实 Key、完整身份表或其他角色的私人信息。修改模板不会改变规则内核接受的合法动作。存档包含每次请求消息的 SHA256，用于区分提示词版本；不包含认证请求头。
