# openclaw-weixin-bridge

OpenClaw 插件：微信 & QQ 消息处理 + 发送 API。

|  依赖  | 版本 |
| :----: | :--: |
| OpenClaw | [![OpenClaw](https://img.shields.io/badge/OpenClaw-2024.x+-orange)](https://openclaw.ai) |
| openclaw-weixin | 已登录 |
| qqbot | 已配置（可选） |

## 功能

1. **收到微信/QQ 消息 → 自定义处理 → 回复**
2. **HTTP API 发送微信消息**（iLink API）
3. **HTTP API 发送 QQ 消息**（QQ Bot 官方 API，无条数限制）

## 前置条件

### 1. 安装 OpenClaw

```bash
npm install -g openclaw
```

### 2. 安装 openclaw-weixin 插件

```bash
openclaw plugins install @tencent-weixin/openclaw-weixin
```

### 3. 扫码登录微信

```bash
openclaw channels login --channel openclaw-weixin
```

用微信扫描终端显示的二维码，完成登录。登录后会在 `~/.openclaw/openclaw-weixin/accounts/` 生成账号配置文件。

### 4. 启动 Gateway

```bash
openclaw gateway
```

Gateway 会持续运行 `getupdates` 长轮询，保持 token 存活。**Gateway 停止后 token 几小时内失效**，需要重新扫码。

### 5. 获取用户 ID

给 ClawBot 发一条微信消息，然后查看 Gateway 日志或 `~/.openclaw/openclaw-weixin/accounts/<accountId>.context-tokens.json`，里面的 key 就是用户 ID（`xxx@im.wechat` 格式）。

## 安装插件

```bash
# 复制到 OpenClaw 扩展目录
cp -r openclaw-weixin-bridge ~/.openclaw/extensions/weixin-bridge

# 重启 Gateway 生效
openclaw gateway stop
openclaw gateway
```

验证插件加载：
```bash
openclaw channels status
# 应该看到: weixin-bridge loaded
```

## 消息处理

用户给 ClawBot 发消息，插件收到后处理并回复。在 `index.ts` 的 `reply_dispatch` 中自定义逻辑：

```typescript
// 示例1：echo 回复
await reply(`收到: ${text}`);

// 示例2：关键词回复
if (text.includes("你好")) {
  await reply("你好呀！");
} else {
  await reply(`你说的是: ${text}`);
}

// 示例3：调用外部 API
const resp = await fetch("http://your-api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: text }),
});
const data = await resp.json();
await reply(data.reply);
```

## 发送 API

插件启动后在 `127.0.0.1:9201` 提供两个发送端点：

### POST /send_wx — 发送微信消息

```bash
curl -X POST http://127.0.0.1:9201/send_wx \
  -H "Content-Type: application/json" \
  -d '{"to": "xxx@im.wechat", "text": "你好"}'
```

- 通过 iLink API
- 需要 openclaw-weixin 已登录
- 每 10 条需要用户回一条消息（微信限制）

### POST /send_qq — 发送 QQ 消息

```bash
curl -X POST http://127.0.0.1:9201/send_qq \
  -H "Content-Type: application/json" \
  -d '{"to": "用户openid", "text": "你好"}'
```

- 通过 QQ Bot 官方 API
- 需要在 `~/.openclaw/openclaw.json` 中配置 qqbot 的 appId 和 clientSecret
- 无条数限制，无需保活
- openid 可从 `~/.openclaw/qqbot/data/known-users.json` 获取

### 参数（两个端点通用）

| 字段 | 类型 | 说明 |
|------|------|------|
| `to` | string | 目标用户 ID |
| `text` | string | 消息内容 |

### 返回

```json
{"ok": true}
{"ok": false, "error": "原因"}
```

### 调用示例

**Python**
```python
import requests

# 微信
requests.post("http://127.0.0.1:9201/send_wx", json={"to": "xxx@im.wechat", "text": "你好"})

# QQ
requests.post("http://127.0.0.1:9201/send_qq", json={"to": "用户openid", "text": "你好"})
```

## 配置

`openclaw.plugin.json` 中可配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `httpPort` | `9201` | HTTP 发送服务端口 |

## 注意事项

- **Gateway 必须运行**：Gateway 负责长轮询保活，停止后 token 几小时内失效
- **context token 会过期**：长时间不活动后发送可能失败（返回 `ret: -2`），用户给 bot 发一条消息即可刷新
- **账号自动发现**：插件自动从 `~/.openclaw/openclaw-weixin/accounts/` 读取账号配置，无需手动填写 token
- **单向发送不需要 Gateway**：如果只用发送 API 不需要接收消息，可以参考 [forwarder-sms-BF](https://github.com/lengmuning/forwarder-sms-BF) 的纯 HTTP 方案

## iLink API 参考

发送消息的 HTTP 请求格式：

```
POST https://ilinkai.weixin.qq.com/ilink/bot/sendmessage

Headers:
  Content-Type: application/json
  Authorization: Bearer {bot_token}
  AuthorizationType: ilink_bot_token
  X-WECHAT-UIN: {随机数字}

Body:
{
  "msg": {
    "to_user_id": "xxx@im.wechat",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{"type": 1, "text_item": {"text": "消息内容"}}],
    "context_token": "从 context-tokens.json 读取"
  },
  "base_info": {"local_id": 1}
}

返回：
  {} = 成功
  {"ret": -2} = token 失效
```

## 免责声明

仅用于学习和个人使用。
