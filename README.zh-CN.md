# RustDesk 网页客户端

[English](README.md) · [更新记录](CHANGELOG.md)

这是 [RustDesk](https://github.com/rustdesk/rustdesk) 的非官方浏览器客户端，与 RustDesk 作者没有隶属、背书或维护关系。

> **Alpha 状态：** 本项目仍处于受控开发阶段，不建议暴露到公网，也尚未达到公开发布标准。

网页使用 React 渲染和 WebCodecs 解码远程画面；Node.js 网关建立 RustDesk 协议连接，并通过 WebSocket 转发画面、音频、键鼠、触控和会话控制。

本仓库不打 Git 标签，不创建 GitHub Release，也不发布软件包或容器镜像。

```text
浏览器
  | HTTPS 或 localhost
  | /api/health  /ws  /ws/webrtc
  v
Node.js 网关
  | RustDesk TCP 和可选 WebRTC 信令
  v
RustDesk 被控端 / ID 和中继服务器
```

## 当前状态

- Node.js 24 与 Yarn 1.22.22 下可安装、检查、构建和运行测试。
- 自动化测试覆盖协议、网关、WebRTC 信令、远程光标和浏览器逻辑。
- 尚未完成 Windows、macOS、Linux、Android、iOS 和公网 HTTPS 的真机验证。
- 兼容性矩阵中的组合在拿到实证前仍为 `untested`。
- WebRTC 默认关闭，需要兼容的 hbbs/hbbr 服务端基础设施。
- 支持本地 Docker Compose 部署；正式发布前不要公开暴露。

发布门禁和已知限制见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- 浏览器远程桌面与 WebCodecs 视频解码
- 键盘、鼠标、触控、双指缩放、画面平移和滚轮输入
- 手机端工具栏、操作手势和屏幕键盘
- 被控端授权后播放音频和切换隐私模式
- 被控端支持时切换显示器或远程分辨率
- 会话诊断、往返延迟、画质、帧率和编码设置
- 双向纯文本剪贴板同步
- 网关令牌认证和 WebSocket Origin 过滤
- 可选 WebRTC 传输，失败时回退到网关连接

## 环境要求

- Node.js 24（见 `.nvmrc` 和 `.node-version`）
- Yarn Classic 1.22.22
- 支持 WebCodecs 的浏览器
- 远程访问使用 HTTPS，本机开发可使用 `http://localhost`
- 被控端运行 RustDesk，并授予相应的键鼠、音频、隐私和剪贴板权限

## 本地启动

```sh
yarn install --frozen-lockfile
cp .env.example .env
yarn dev
```

打开 `http://127.0.0.1:3000`。开发进程同时提供 React 页面、健康检查和 WebSocket 网关。

开发模式下可不设置令牌；生产环境必须设置真实的网关令牌。

```sh
export RUSTDESK_GATEWAY_TOKEN="$(openssl rand -hex 32)"
yarn typecheck
yarn lint
yarn test
yarn build
NODE_ENV=production yarn start
```

`yarn lint` 与类型检查相同。生产启动前先运行 `yarn build`。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | development | 设为 `production` 后提供已构建前端 |
| `HOST` | `127.0.0.1` | 网关监听地址；Render 环境固定为 `0.0.0.0` |
| `PORT` | `3000` | HTTP 和 WebSocket 共用端口 |
| `RUSTDESK_GATEWAY_TOKEN` | 空 | 公网网关应设置的私有令牌 |
| `RUSTDESK_ALLOWED_ORIGINS` | 空 | 用逗号分隔的 WebSocket Origin 白名单 |
| `RUSTDESK_REQUIRE_ORIGIN` | `false` | 要求 WebSocket 升级请求携带 Origin 头 |
| `RUSTDESK_TRUSTED_PROXIES` | 空 | 用逗号分隔的可信代理 IP 或 CIDR 网段；空值表示不信任转发头 |
| `RUSTDESK_CLIENT_IP_HEADER` | `x-forwarded-for` | 客户端地址头：`x-forwarded-for` 或显式信任的 `cf-connecting-ip` |
| `RUSTDESK_ALLOW_PRIVATE_TARGETS` | 生产为 `false`，开发为 `true` | 允许连接局域网和回环目标 |
| `RUSTDESK_ALLOWED_TARGET_PORTS` | 空 | 生产环境额外允许的 ID 和中继服务器 TCP 端口，用逗号分隔 |
| `RUSTDESK_DEFAULT_FORCE_RELAY` | `false` | 网关的 ID 连接跳过 TCP 直连；与浏览器 WebRTC 和 IP 直连独立 |
| `RUSTDESK_ENABLE_WEBRTC` | `false` | 设为 `true` 时启用可选 WebRTC 信令入口 |

生产模式不会接受空令牌或占位令牌。网关令牌与 RustDesk 被控端密码是两个独立凭据。

配置在开始监听前统一解析校验：布尔值只接受 `true` 或 `false`，端口必须为 1–65535 的整数，Origin 或代理网段格式错误会阻止启动，并提示对应配置项名称。修改配置需要重启；连接策略不会随着进程内环境变量变化而漂移。

生产环境允许 ID 和中继服务器使用 TCP `21114–21119`。对端连接支持用户填写的直连端口，以及 ID 服务器下发的 NAT 动态端口。所有连接统一校验目标 IP。局域网部署可设置 `RUSTDESK_ALLOW_PRIVATE_TARGETS=true`，链路本地地址及已知云元数据地址始终会被拦截。

两个 WebSocket 入口共享每个网关实例最多 128 条连接的限额，每个来源 IP 最多同时 4 条连接，每分钟最多 24 次升级。多次令牌校验失败仅对该来源 IP 触发短时退避。IPv4 映射 IPv6 地址及等价的 IPv6 写法会归一化，使用同一份额度。

默认使用 TCP 对端地址。经反向代理部署时，将实际代理 IP 或 CIDR 网段填入 `RUSTDESK_TRUSTED_PROXIES`，例如通过回环地址连接网关的代理可填 `127.0.0.1,::1`。仅当 TCP 对端可信时才解析 `X-Forwarded-For`，从右向左跳过可信代理，采用第一个不可信地址。检查到格式错误的地址或整条链都可信时回退为 TCP 对端地址。代理必须追加实际连接来源或覆盖转发头，不能直接信任客户端提交的值。信任配置格式错误会阻止启动。

WebSocket 的 Origin 必须与请求的协议、域名和端口一致；域名大小写和默认端口会统一处理。HTTPS 在代理处终止时，可信代理需要保留公网 `Host`（含非默认端口），并覆盖 `X-Forwarded-Proto` 为单个 `https` 或 `http` 值。不可信连接不能通过该头改变协议，含多个协议的转发链会被拒绝。托管平台无法提供明确可信的代理范围时，可显式设置 `RUSTDESK_ALLOWED_ORIGINS=https://你的公网域名`；白名单中的 Origin 不受内部请求地址限制。跨端口的回环 Origin 豁免只在开发模式启用，生产回环部署同样需要同源或显式白名单。

Render 部署在 `RENDER=true` 且未配置 Origin 白名单时，自动使用平台提供的 HTTPS `RENDER_EXTERNAL_URL` 作为允许的 Origin。此地址来自 [Render 官方部署环境变量](https://render.com/docs/environment-variables)，不从请求头推断。自定义域名或额外网页来源需要设置 `RUSTDESK_ALLOWED_ORIGINS`，显式白名单会替换此默认值。

Cloudflare 场景可继续使用默认的 `X-Forwarded-For` 信任链。如需直接使用 `CF-Connecting-IP`，设置 `RUSTDESK_CLIENT_IP_HEADER=cf-connecting-ip`，且只信任 Cloudflare 入口，或会校验 Cloudflare 来源并在每次请求中覆盖/清除该头的自有入口。仅透传该头的普通代理不满足这个条件。该头缺失或格式错误时使用 TCP 对端地址；不可信对端携带任何转发头都不能改变身份。

网关的 ID 连接会竞速 TCP 直连与中继，让直连先尝试 350 毫秒；直连提前失败时立即启动中继。先完成对端握手的路径胜出，另一条路径被取消并关闭连接，然后仅在胜出的路径执行一次密码登录。确定网关应始终走中继时，可设置 `RUSTDESK_DEFAULT_FORCE_RELAY=true`。此设置不关闭浏览器 WebRTC。

健康检查位于 `/api/health`：

```json
{
  "ok": true,
  "service": "rustdesk-web-gateway",
  "authRequired": true,
  "webRtcEnabled": false
}
```

## Docker 部署

Compose 默认把宿主机 `127.0.0.1:21120` 映射到容器端口 `3000`。

```sh
export RUSTDESK_GATEWAY_TOKEN="$(openssl rand -hex 32)"
docker compose up -d --build
curl http://127.0.0.1:21120/api/health
```

也可使用一键脚本：

```sh
./deploy.sh
./deploy.sh --port 28080 --token "$(openssl rand -hex 32)"
```

脚本会把端口、监听地址、容器名和网关令牌写入权限为 `600` 的 `.env.docker`。`.env` 和 `.env.docker` 均已加入忽略规则。

远程访问时，应在网关前配置 HTTPS，并转发 `/ws` 和启用后使用的 `/ws/webrtc` WebSocket 升级。

## WebRTC

「设置 → 网络 → WebRTC（实验性）」默认关闭，浏览器会记住你的选择。未启用时，所有连接沿用网关路径。

启用前需要同时准备网关和信令基础设施：

1. 在 Node.js 网关设置 `RUSTDESK_ENABLE_WEBRTC=true`。
2. 重启网关并刷新页面。
3. 按需配置兼容的 RustDesk ID 服务器和 hbbs 补丁。
4. 在支持的被控端启用对应 WebRTC 设置。
5. 在网页的「设置 → 网络」中填写相同的 ID 服务器和公钥。
6. 确认局域网、防火墙和 UDP 通信可用。
7. 在此浏览器的「设置 → 网络」中打开「WebRTC（实验性）」。

信令入口为 `/ws/webrtc`。建立身份后会校验服务器签名、设备签名和 DTLS 指纹；只有用户主动开启且网关报告支持时，符合条件的 ID 连接才会先尝试浏览器 WebRTC，信令、网络或身份校验失败后建立网关连接。被控端拒绝登录时不会自动通过网关重试。IP 直连和强制中继使用网关路径。

官方开源 hbbs/hbbr 不等于已支持该信令协议。hbbs 补丁、镜像构建和部署说明统一在独立仓库 [suijiafeng/hbbs-webrtc](https://github.com/suijiafeng/hbbs-webrtc) 维护，本 Web 客户端不构建或修改 hbbs。

## 剪贴板和本地数据

- 剪贴板同步按每次连接启用，仅支持纯文本 UTF-8，单条最多 256 KiB。
- 浏览器只有获得剪贴板权限后才能写入本机剪贴板。
- 不是系统级后台同步，网页不可见时不会持续读取本机剪贴板。
- 可选记住密码使用 AES-256-GCM 加密，密文按设备保存在当前浏览器的本地存储，不可导出密钥存入 IndexedDB。
- 在「设置 → 网络」保存的网关访问令牌也会在此浏览器加密保存，留空并保存可清除。
- 设备记录和显示设置保存在 `localStorage`；旧版明文密码会在启动时清除。

同源脚本仍能访问浏览器存储。客户端加密不能替代安全域名、浏览器环境和托管环境。

## 手机操作

- 单指轻点可发送触控或鼠标操作。
- 单指拖动可移动远端指针或平移画面。
- 双指捏合可缩放画面。
- 三指上下滑动可发送滚轮操作。
- 工具栏提供键盘、触摸／鼠标切换、屏幕设置和手势说明。

操作系统可能先截获多指手势，导致网页无法收到触摸事件。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/` | React 界面、输入、手势、WebCodecs、浏览器 WebRTC 和本地设置 |
| `server.ts` | HTTP、健康检查、静态页面、WebSocket 升级和服务启动 |
| `server/` | RustDesk 协议、会话、音视频、输入和信令转发 |
| `shared/` | 各层共享的协议和 WebRTC 消息定义 |
| `docs/` | 截图 |
| `Dockerfile` | Node.js 构建与运行镜像 |
| `docker-compose.yml` | 本地容器部署 |
| `deploy.sh` | Docker 一键部署脚本 |

## 验证

```sh
yarn typecheck
yarn test
yarn build
```

Docker 验证：

```sh
docker compose config
docker compose up -d --build
curl http://127.0.0.1:21120/api/health
```

除非完成了相关真机会话并记录了平台证据，否则不要声称已通过真实设备验证。

## 许可证

Copyright 2026 suijiafeng。基于 GNU AGPL-3.0-only 授权，见 [LICENSE](LICENSE)。
