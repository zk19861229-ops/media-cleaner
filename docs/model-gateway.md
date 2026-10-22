# LLM / Jev 网关契约 v1

这是本项目定义的集成契约，**不是 Jev 官方 API**。网关负责把请求映射到真实供应商 SDK/API。客户端默认关闭远程调用；启用后使用 HTTPS，拒绝重定向，最大响应 64 KiB，单次调用超时 25 秒。访问令牌通过 `Authorization: Bearer ...` 发送；Android 使用 Keystore 加密保存，Web 仅在页面内存保存，刷新清除。

## Web 接入补充

Web 使用相同 JSON 契约。HTTPS 网关必须响应 `OPTIONS` 预检，允许实际 Web 站点 Origin（含开发地址 `http://127.0.0.1:4173`）、方法 `POST`、请求头 `Content-Type, Authorization`，并在实际响应中包含相应 CORS 头。建议明确列出来源并设置 `Vary: Origin`。客户端 `credentials: omit`，不发送跨站 Cookie。不要在静态文件中嵌入共享生产密钥；使用用户自己的网关访问令牌。

页面只持久化网关地址，不持久化令牌或远程启用开关。Jev 特征包含本次请求的匿名成员 ID、尺寸、清晰度与保护状态；用户主动输入的偏好文字会发送给 LLM。连续三次 Jev 请求失败后，当前扫描剩余相似组直接转人工复核。浏览器 CORS 与真实服务联调尚未完成。

## POST /v1/policy

LLM 将用户语言映射到首版支持的两个设置。不支持的意图（如识别某位家人、压缩视频）不能声称已执行。返回未知字段或错误类型时客户端拒绝响应。

请求：

```json
{"intent":"仅清理重复内容，保留截图","current":{"includeSimilar":true,"protectScreenshots":true}}
```

响应：

```json
{"includeSimilar":false,"protectScreenshots":true}
```

解析后手机展示实际开关供用户检查；新策略只作用于下一次分析。既有计划不受模型修改。

## POST /v1/decision

Jev 接收固定任务和结构化状态。成员 ID 仅在本次请求中有效，不发送媒体 URI、文件名、完整哈希、图像向量或原始文件。

请求：

```json
{"task":"recommend_photo_keeper","relation":"VISUALLY_SIMILAR","members":[{"id":"m0","width":1920,"height":1080,"sharpness":18.3,"protected":false},{"id":"m1","width":1920,"height":1080,"sharpness":7.2,"protected":false}]}
```

响应：

```json
{"decision":"RECOMMEND_KEEPER","keeperId":"m0","confidence":0.94}
```

允许的 decision：`RECOMMEND_KEEPER`、`KEEP_ALL`、`REQUEST_REVIEW`。后两种 keeperId 必须为 null。confidence 必须是 0～1 的有限数；它被记录，但**不用于自动选择删除动作**，不假定已经在手机媒体域校准。

客户端验证成员引用和字段类型。响应错误、超时或服务不可用时，该组标记人工复核。应用只根据计划和工具证据显示说明，不把开放式模型文本作为删除依据。

## 本地模式与真实接入

- 本地模式：SHA-256 确认重复；按清晰度指标建议相似组保留项，界面显示“本地清晰度规则”。
- 远程模式：只有实际收到并验证网关输出，才标为“Jev 网关”；该标签仅表示来源，不证明服务端实际使用了哪个供应商。
- 上线前必须核对 Jev 的可配置任务/训练需求、请求限制、实际校准能力及费用，使用经授权的样本联调。未提供接入文档和凭证时，不能宣称已经实现真实 Jev 推理。
