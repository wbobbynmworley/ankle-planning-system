# Railway 上 Web 打不开 / Not Found 排查

按「步骤 2」打开的是 **Web 前端** 的域名，仍然显示 **Not Found** 或打不开时，按下面逐项检查。

---

## 1. 确认打开的是 Web 的域名

- **不要**打开 Algo 的域名（如 `algo-production-xxx.up.railway.app`），Algo 没有网页，会一直 Not Found。
- 在 Railway 里点进 **名为 Web（或你起的前端服务名）** 的那一个服务 → **Settings** → **Networking** → 复制 **Generate Domain** 下面显示的地址，用这个在浏览器打开。

---

## 2. 看 Web 服务是否部署成功

1. Railway 控制台 → 点进 **Web** 服务。
2. 打开 **Deployments** 页签。
3. 看**最新一条**状态：
   - **Success**：部署成功，继续看第 3 步。
   - **Failed** 或 **Crashed**：点进这次部署，看 **Build Logs** 或 **Deploy Logs** 里的报错（见下面「常见报错」）。
4. 若是 **Success** 但网页仍 Not Found，打开 **Logs**（实时日志），再刷新一次网页，看有没有报错（如 `Cannot find module`、`EADDRINUSE` 等）。

---

## 3. 确认环境变量

在 **Web** 服务 → **Variables**：

- 必须有 **NEXT_PUBLIC_API_URL** = 你的 **API** 的完整地址，例如：  
  `https://api-production-xxxx.up.railway.app`  
  （不要加 `/api`，不要漏掉 `https://`）
- 若没有或填错，改好后保存，等自动重新部署完成再试。

---

## 4. 域名是否生效

- 刚 **Generate Domain** 后可能要等 1～2 分钟才生效。
- 换一个浏览器或无痕窗口试一次，排除缓存。
- 确认地址栏是 **Web** 的域名，不是 API 或 Algo 的。

---

## 5. 常见报错与处理

| 日志里看到的 | 可能原因 | 处理 |
|-------------|----------|------|
| `Cannot find module 'server.js'` 或 standalone 相关 | Next 未生成 standalone | 确认 `apps/web/next.config.js` 里有 `output: 'standalone'`，重新部署。 |
| `Build failed` / `npm run build` 失败 | 依赖或构建错误 | 看 Build Logs 里具体报错；本地在 `apps/web` 运行 `npm run build` 复现并修代码后再部署。 |
| `EADDRINUSE` | 端口被占 | Railway 一般会自动注入 PORT，通常无需改；若自定义了 PORT，不要和 3000 冲突。 |
| 页面空白或一直转圈 | 前端请求不到 API | 检查 Web 的 **NEXT_PUBLIC_API_URL** 和 API 的 **CORS_ORIGIN** 是否互为对方域名。 |

---

## 6. 再确认一遍三个服务

| 服务 | 你要用的地址 | 用途 |
|------|--------------|------|
| **Web** | 在 Web 服务 Networking 里复制的域名 | 在浏览器里打开这个，才能看到登录页 |
| **API** | 在 API 服务 Networking 里复制的域名 | 只给 Web 的变量和 CORS 用，不要当网站打开 |
| **Algo** | 可不生成域名 | 只给 API 内网调用，不要用浏览器打开 |

---

按上面检查后，把 **Web** 的 **Deployments** 状态（Success/Failed）和 **Build Logs** 或 **Logs** 里的一小段报错贴出来，可以更精确地排查。
