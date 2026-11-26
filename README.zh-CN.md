# RustDesk 网页客户端

[English](README.md) · [架构](docs/architecture.md) · [更新记录](CHANGELOG.md)

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
| `RUSTDESK_ENABLE_WEBRTC` | `false` | 设为 `true` 时启用可选 WebRTC 信令入口 |

生产模式不会接受空令牌或占位令牌。网关令牌与 RustDesk 被控端密码是两个独立凭据。

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

WebRTC 默认关闭；未启用时，所有连接沿用网关路径。

启用前需要同时准备网关和信令基础设施：

1. 在 Node.js 网关设置 `RUSTDESK_ENABLE_WEBRTC=true`。
2. 重启网关并刷新页面。
3. 按需配置兼容的 RustDesk ID 服务器和 hbbs 补丁。
4. 在支持的被控端启用对应 WebRTC 设置。
5. 在网页的「设置 → 网络」中填写相同的 ID 服务器和公钥。
6. 确认局域网、防火墙和 UDP 通信可用。

信令入口为 `/ws/webrtc`。建立身份后会校验服务器签名、设备签名和 DTLS 指纹；信令、网络或身份校验失败时回退到原网关路径。

官方开源 hbbs/hbbr 不等于已支持该信令协议。请使用兼容服务端，或应用 [server-patches/hbbs/README.md](server-patches/hbbs/README.md)。

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
| `server-patches/hbbs/` | 可选 hbbs 信令适配及说明 |
| `docs/` | 架构说明和截图 |
| `Dockerfile` | Node.js 构建与运行镜像 |
| `docker-compose.yml` | 本地容器部署 |
| `deploy.sh` | Docker 一键部署脚本 |

架构边界和信任考虑见 [docs/architecture.md](docs/architecture.md)。

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
