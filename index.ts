/**
 * openclaw-weixin-bridge
 *
 * OpenClaw 插件：微信/QQ 消息处理 + 发送 API
 * - 收到微信消息 → 自定义处理 → 回复
 * - POST /send_wx — 发送微信消息（iLink API）
 * - POST /send_qq — 发送 QQ 消息（QQ Bot 官方 API）
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createServer, IncomingMessage, ServerResponse } from "http";

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const WX_ACCOUNT_DIR = resolve(HOME, ".openclaw", "openclaw-weixin", "accounts");

// --- 微信 iLink API（自动发现账号）---

function loadWeixinAccount() {
  try {
    const files = readdirSync(WX_ACCOUNT_DIR);
    const f = files.find(f => f.endsWith(".json") && !f.includes("context-tokens"));
    if (!f) return null;
    const accountId = f.replace(".json", "");
    const acc = JSON.parse(readFileSync(resolve(WX_ACCOUNT_DIR, f), "utf8"));
    return { accountId, token: acc.token || "", baseUrl: acc.baseUrl || "" };
  } catch (_) { return null; }
}

function loadContextToken(accountId: string, to: string): string {
  try {
    const tokens = JSON.parse(readFileSync(resolve(WX_ACCOUNT_DIR, `${accountId}.context-tokens.json`), "utf8"));
    return tokens[to] || "";
  } catch (_) { return ""; }
}

// --- HTTP 发送服务 ---

function startHttpService(port: number, logger: any) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {

    // --- /send_wx ---
    if (req.method === "POST" && req.url === "/send_wx") {
      let body = "";
      req.on("data", (c: string) => { body += c; });
      req.on("end", () => {
        try {
          const { to, text } = JSON.parse(body);
          const account = loadWeixinAccount();
          if (!account) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "no weixin account found" }));
            return;
          }
          const contextToken = loadContextToken(account.accountId, to);
          const payload = JSON.stringify({
            msg: {
              from_user_id: "",
              to_user_id: to,
              client_id: `bot-${Date.now()}`,
              message_type: 2,
              message_state: 2,
              item_list: [{ type: 1, text_item: { text } }],
              context_token: contextToken,
            },
            base_info: { local_id: 1 },
          });
          fetch(`${account.baseUrl}/ilink/bot/sendmessage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${account.token}`,
              "AuthorizationType": "ilink_bot_token",
              "X-WECHAT-UIN": String(Math.floor(Math.random() * 900000000) + 100000000),
            },
            body: payload,
          }).then(r => r.text()).then(result => {
            const ok = result === '{}' || !result.includes('"ret"');
            logger.info(`[send_wx] ${ok ? 'ok' : 'fail'}: ${result.substring(0, 80)}`);
            res.writeHead(ok ? 200 : 502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok, result: result.substring(0, 100) }));
          }).catch((err: any) => {
            logger.error(`[send_wx] error: ${err}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          });
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });

    // --- /send_qq ---
    } else if (req.method === "POST" && req.url === "/send_qq") {
      let body = "";
      req.on("data", (c: string) => { body += c; });
      req.on("end", () => {
        try {
          const { to, text } = JSON.parse(body);
          const qqCfg = JSON.parse(readFileSync(resolve(HOME, ".openclaw", "openclaw.json"), "utf8"));
          const qq = qqCfg?.channels?.qqbot || {};
          const appId = String(qq.appId || qq.appid || "");
          const secret = qq.clientSecret || qq.token || "";
          if (!appId || !secret) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "qqbot not configured" }));
            return;
          }
          fetch("https://bots.qq.com/app/getAppAccessToken", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appId, clientSecret: secret }),
          }).then(r => r.json()).then((tokenResp: any) => {
            if (!tokenResp.access_token) throw new Error("no access_token");
            return fetch(`https://api.sgroup.qq.com/v2/users/${to}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `QQBot ${tokenResp.access_token}` },
              body: JSON.stringify({ content: text, msg_type: 0 }),
            });
          }).then(r => r.json()).then((result: any) => {
            const ok = !!result.id;
            logger.info(`[send_qq] ${ok ? 'ok' : 'fail'}: ${JSON.stringify(result).substring(0, 80)}`);
            res.writeHead(ok ? 200 : 502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok }));
          }).catch((err: any) => {
            logger.error(`[send_qq] error: ${err}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          });
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });

    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
  server.listen(port, "127.0.0.1", () => {
    logger.info(`[weixin-bridge] HTTP service on :${port}`);
  });
  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      logger.warn(`[weixin-bridge] port ${port} in use, skipping`);
    }
  });
}

// --- 插件入口 ---

export default definePluginEntry({
  id: "weixin-bridge",
  name: "WeChat Bridge",
  description: "WeChat/QQ message handler + send API",
  register(api) {
    const cfg = api.pluginConfig || {};
    const httpPort = cfg.httpPort || 9201;
    const webhookUrl = cfg.webhookUrl || "http://127.0.0.1:9200/wx_incoming";

    api.logger.info(`WeChat Bridge active`);
    startHttpService(httpPort, api.logger);

    api.on("reply_dispatch", async (payload, ctx) => {
      const inbound = payload?.ctx || {};
      const text = (inbound.BodyForAgent || inbound.Body || "").trim();
      if (!text) return { handled: true };

      const channel = inbound.OriginatingChannel || inbound.Channel || "";

      // 只处理微信和QQ消息
      if (channel !== "openclaw-weixin" && channel !== "qqbot") return { handled: false };

      const from = inbound.From || "";
      api.logger.info(`[weixin-bridge] ${from}: ${text.substring(0, 50)}`);

      const reply = async (msg: string) => {
        await ctx.dispatcher.sendBlockReply({ text: msg, type: "text" });
        await ctx.dispatcher.markComplete();
      };

      // ===== 自定义消息处理逻辑 =====
      // 默认：转发到 webhook
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, text, channel }),
        });
      } catch (e) {
        api.logger.warn(`[weixin-bridge] webhook failed: ${e}`);
      }
      // 回复示例（取消注释启用）：
      // await reply(`收到: ${text}`);
      // ==============================

      return { handled: true };
    });
  },
});
