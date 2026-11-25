# RustDesk Web Client

通过浏览器连接 RustDesk 设备，提供适合手机和电脑的远程桌面操作界面。本项目位于 `feature/web-client` 分支的 `web-client/` 目录，包含 React 前端和 Node.js 网关。

[项目源码](https://github.com/suijiafeng/rustdesk/tree/feature/web-client/web-client)

## 连接方式

**WebRTC 默认关闭。** 未配置 `RUSTDESK_ENABLE_WEBRTC` 或值不是 `true` 时，所有连接直接走原来的网关流程，不会尝试 WebRTC，也不会增加其协商等待时间。

在 Render / Node 服务设置 `RUSTDESK_ENABLE_WEBRTC=true` 并重启服务、刷新页面后，使用设备 ID 连接时，浏览器才会优先尝试 WebRTC。协商通过同源 `/ws/webrtc` 和 ID 服务器完成；建立并验证身份后，视频、声音、键鼠及剪贴板数据直接通过浏览器与电脑之间的 DataChannel 传输。

```text
协商：浏览器 ── WSS ── Node.js 网关 ── hbbs ── 被控端
数据：浏览器 ═════════ WebRTC ═══════════ 被控端
回退：浏览器 ── WSS ── Node.js 网关 ── RustDesk 直连或中继 ── 被控端
```

协商不支持、网络无法打通或身份校验不通过时，会关闭本次 WebRTC 连接，再使用原有网关路径。密码提交后被拒绝则直接报错，不换通道重复提交密码。直接输入 IP、强制中继及不支持 WebRTC 的浏览器沿用原连接方式。

连接详情中的「WebRTC · 浏览器直连」来自浏览器实际选中的 ICE 路径；如果被控端的 TURN 配置参与中继，会显示「WebRTC · TURN 中继」。「网关直连」仍仅表示网关与被控端之间的直连。

### 局域网 WebRTC 的启用条件

- Render / Node 网关设置 `RUSTDESK_ENABLE_WEBRTC=true`；这个开关与 hbbs 的 `ENABLE_WEBRTC=Y` 分别控制两个服务，需要分别配置。

- 浏览器与电脑的局域网能互相访问，未开启访客网络隔离，防火墙允许 WebRTC 的 UDP 通信。
- 被控端使用支持 WebRTC 的 RustDesk（本次对接以 1.5.3 协议源码为依据）；自建服务器场景需要在被控端高级设置启用 `enable-webrtc=Y`。
- 网页中的 ID 服务器和公钥与被控端一致。WebRTC 必须通过服务器签名、设备 ID 和设备签名的 DTLS 指纹校验；缺少可信身份时会回退。
- **开源 hbbs/hbbr 不能仅凭客户端版本认定已支持 WebRTC。** 本次检查的官方开源 hbbs `680b60395ecf99a76f74a1d934e453bb6e5e0aa2` 不转发这些信令，需要使用支持该协议的服务端，或应用 [hbbs 适配补丁](server-patches/hbbs/README.md)。hbbr 不需要修改。

Render 上仍需要运行 Node.js 服务完成信令转发和回退，不能只托管静态文件后填写内网 IP。连通时远控数据可以留在局域网，页面加载和 ID 协商仍需要访问对应服务。WebRTC 尝试的建立阶段最多等待 12 秒；已验证身份后的登录另有超时。

浏览器支持的编码会参与会话协商，实际使用的编码还取决于被控端能力。

## 环境要求

- Node.js 24，版本范围由 `package.json` 和 `.node-version` 指定。
- Yarn Classic 1.22.22，依赖版本由 `yarn.lock` 管理。
- 浏览器支持 WebCodecs，远程访问使用 HTTPS。本机开发可使用 `http://localhost`。
- 被控端已运行 RustDesk，并允许相应的键鼠、声音或隐私模式权限。

## 本地开发

从仓库根目录执行以下命令。

```sh
cd web-client
yarn install --frozen-lockfile
yarn dev
```

打开 `http://localhost:3000`。网关同时提供前端页面、`/api/health` 和 `/ws`。

如果本地已有设置了 `NODE_ENV=production` 的环境文件，使用 `NODE_ENV=development yarn dev` 启动开发模式。

## 构建与启动

```sh
yarn install --frozen-lockfile --production=false
yarn typecheck
yarn test
yarn build
NODE_ENV=production yarn start
```

构建生成 `dist/` 与 `server.js`，生产运行需要两者及运行时依赖。`yarn preview` 仅预览 Vite 前端产物，完整远控服务使用 `yarn start`。

`yarn lint` 是兼容保留的类型检查命令，与 `yarn typecheck` 相同。

## Render 部署

在 Render 创建 Node Web Service，使用以下项目设置。

| 设置 | 值 |
| --- | --- |
| Repository | `suijiafeng/rustdesk-web-client` |
| Branch | `main` |
| Root Directory | 留空（仓库根目录） |
| Build Command | `yarn install --frozen-lockfile --production=false && yarn build` |
| Start Command | `yarn start` |
| Health Check Path | `/api/health` |
| Environment | `NODE_ENV=production`，设置私有的 `RUSTDESK_GATEWAY_TOKEN` |

项目提供 `.node-version`。如服务已设置 `NODE_VERSION`，应确认该值使用 Node 24。当 Render 注入 `RENDER=true` 时，网关监听 `0.0.0.0`，端口使用平台提供的 `PORT`（默认 `10000`）。

Render 的构建与启动命令在所选根目录执行。平台配置说明见 [Render Web Services](https://render.com/docs/web-services)、[Root Directory](https://render.com/docs/your-first-deploy) 和 [Node 版本设置](https://render.com/docs/node-version)。

## 环境变量

服务端会读取运行目录中的 `.env`，可以从 `.env.example` 创建生产环境文件，也可以直接在托管平台设置变量。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `NODE_ENV` | 未设置时为开发模式 | 生产部署设为 `production`，提供已构建页面 |
| `PORT` | `3000` | HTTP 与 WebSocket 共用的监听端口 |
| `HOST` | `127.0.0.1` | 网关监听地址。Render 环境固定使用 `0.0.0.0` |
| `RUSTDESK_GATEWAY_TOKEN` | 空 | 网关访问令牌，设置后连接时需要填写 |
| `RUSTDESK_ENABLE_WEBRTC` | `false` | 只有设为 `true` 才开启浏览器 WebRTC 尝试和 `/ws/webrtc` 信令入口；修改后重启服务并刷新页面 |

公开网关应配置私有访问令牌。它与被控端 RustDesk 密码分别验证。空值及代码识别的示例占位值会关闭网关令牌校验，因此请使用实际生成的值。健康检查接口返回服务存活、是否要求令牌及 WebRTC 开关状态，不验证目标设备是否在线。开关缺失、健康检查失败或旧网关未返回开关时，网页默认使用原网关路径。

ID 服务器、中继服务器和服务器公钥在网页「设置 → 网络」中填写。

## Docker 部署

`web-client/Dockerfile` 构建 Node.js Web 服务镜像。仓库根目录的 Dockerfile 用于原生客户端构建。

在 `web-client/` 内执行以下命令。

```sh
export RUSTDESK_GATEWAY_TOKEN='replace-with-a-private-random-token'
docker compose up -d --build
docker compose logs -f rustdesk-web
```

默认宿主机端口为 `21120`，容器端口为 `3000`。可通过 `HOST_PORT`、`HOST_BIND`、`CONTAINER_NAME` 调整。

也可使用 `./deploy.sh` 自动选择可用端口。脚本把部署参数保存到权限为 `600` 的 `.env.docker`，等待容器健康检查通过后报告成功。环境文件已加入 Git 和 Docker 构建上下文的忽略规则。

远程浏览器访问时，在服务前配置 HTTPS 反向代理，并转发 WebSocket `/ws` 升级请求。

## 手机操作

工具条提供键盘、触摸／鼠标切换、屏幕设置、手势说明和操作菜单。点击收起后显示展开与键盘两个按钮，点击键盘即可唤起手机输入法。横屏样式随设备方向调整，并考虑安全区。

- 触摸模式下，单指轻点操作对应位置。
- 鼠标模式下，单指滑动移动远端指针。
- 双指滑动与捏合用于平移和缩放远程画面。
- 三指上下滑动发送滚轮操作。
- 右键、双击和拖动的具体操作可在「手势」中查看。
- 键盘条提供修饰键、方向键、Home、End、Page Up、Page Down 和 Delete。

手机端默认显示远端光标，并尝试在轻点文本光标位置时弹出输入法。自动判断依赖远端光标形状，首次点击输入框可能需要手动点键盘按钮。浏览器也可能限制系统键盘的自动唤起。

操作系统截获多指手势时，网页可能收不到触摸事件。

## 功能与限制

| 功能 | 当前行为 |
| --- | --- |
| 开启声音 | 播放远端发送的音频，需要浏览器支持 Opus AudioDecoder 和被控端授权，电脑本地外放仍可能继续 |
| 隐私模式 | 被控端报告支持且授权后显示入口，收到确认才更新开关 |
| 分辨率 | 从被控端提供的可用列表选择 |
| 画质与帧率 | 向被控端发送请求，实际效果取决于编码能力、网络与画面变化 |
| 连接详情 | 显示路径、加密状态、视频信息、当前通道的往返延迟和被控端上报 RTT |
| 剪贴板 | 支持双向纯文本同步，手机和电脑端均在每次连接的「操作 → 同步剪贴板」开启 |
| 重启设备 | 需要被控端授权与用户确认，发送后尝试重连原设备 |

## 屏幕设置

屏幕菜单直接展示画质、帧率和编码选项，无需展开；多屏切换和远程分辨率在被控端支持时显示。
会话菜单与设置页使用统一下拉控件，列表跟随所在面板的浅色或深色外观；画质档位统一为「流畅 / 均衡 / 清晰」，帧率带 FPS 单位。
下拉列表会根据当前可见区域和安全区自动向上或向下展开，并避让左右边缘；空间不足时列表内部滚动。
列表不受菜单面板边界裁切，选择后或点击外部关闭，也可使用方向键、Enter 和 Esc 操作。
视图入口已移除，缩放、移动画面仍可使用手势；横竖屏由手机系统控制，网页不主动请求全屏或锁定方向。

## 双向剪贴板

开启同步后，本机文本会发送到远程剪贴板，随后可在远程应用中粘贴。
从其他应用复制文本后返回网页，已有读取权限的浏览器会自动同步；
需要手势授权的浏览器会提示点击「同步」。手机输入法的粘贴操作也会同步文本并输入到远程位置。
远程复制的文本会尝试写入本机剪贴板；若浏览器要求点击授权，则显示「远程文本可复制」提示，点击「复制」后再到手机其他应用粘贴。

同步仅在当前连接开启，断开、被控端撤销剪贴板权限或设置中禁用剪贴板后停止；文本不写入本地存储或日志。
需要 HTTPS（本机 localhost 可用于开发），浏览器可能要求剪贴板权限，部分内置浏览器不支持。
支持 UTF-8 文本和 RustDesk 压缩文本，每条最多 256 KiB，不包含图片、文件或富文本。
这不是系统级后台同步：网页不可见时不会读取本机剪贴板，Safari 等浏览器可能需要每次点击确认。

## 密码和本地设置

「在此标签页记住密码」默认关闭。开启后，密码以 AES-256-GCM 加密，密文存入 `sessionStorage`，不可导出的密钥存入 IndexedDB。同一标签页刷新可恢复，取消勾选会清除保存记录。浏览器的会话恢复行为可能影响标签页关闭后的数据保留。

同源脚本仍能使用浏览器中的密钥，客户端加密的保护范围需要与网页自身安全一起考虑。浏览器存储不可用时会提示，刷新后需要重新输入。

常规连接地址、设备记录与显示设置保存在 `localStorage`。旧版明文密码存储会在页面启动时清除。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `src/` | React 界面、输入、手势、WebCodecs 与本地设置 |
| `server.ts` | HTTP、WebSocket 服务入口 |
| `server/` | RustDesk 协议、握手、连接、音视频与输入转发、WebRTC 信令转发 |
| `src/lib/webrtc/` | 浏览器原生协议处理、身份验证与 DataChannel 传输 |
| `shared/webrtc.ts` | SDP 封装、ICE 校验及消息分片 |
| `server-patches/hbbs/` | 独立的开源 hbbs 适配补丁与启用说明 |
| `index.html` | 页面标题、描述与浏览器视口配置 |
| `package.json` | 包名称、版本、命令及依赖 |
| `vite.config.ts` | 前端构建与版本注入 |
| `Dockerfile`、`docker-compose.yml` | 容器构建和部署 |

产品名称为 RustDesk Web Client，界面顶栏简称 RustDesk Web。关于页版本来自 `package.json`，发布时统一更新该字段。原生协议中发送的客户端兼容版本由协议实现维护。

本目录沿用仓库根目录的 [许可证](../LICENCE)。

## 常见问题

- 页面能打开但不能连接，检查网关令牌、设备密码、服务器地址、公钥及网关到目标设备的网络。
- 浏览器提示无法解码，检查 HTTPS 和关于页的浏览器解码支持，再尝试兼容的编码选项。
- 静止画面 FPS 较低，可能是被控端只在画面变化时发送新帧。
- Docker 构建失败，确认构建上下文为 `web-client/`，并检查依赖下载与 Docker 服务状态。

## WebRTC 改动范围与验证

已有运行路径的改动集中在以下文件，其余会话逻辑仍走原来的网关实现：

- `src/App.tsx`：只在网关明确开启 WebRTC 且非强制中继的 ID 连接入口选择新传输适配器；IP 连接和强制中继仍直接创建 WebSocket。
- `server.ts`：新增受部署开关控制的 `/ws/webrtc` 信令入口，关闭时拒绝访问；原 `/ws` 处理函数保留。
- `server/protos.ts`：补齐 WebRTC SDP / ICE 字段，现有字段编号不变。
- `server/control.ts`、`server/video.ts`、`server/protos.ts`：显式导入 Buffer，以便浏览器复用原协议转换代码；Node 继续使用自己的 Buffer 实现。
- `src/lib/protocol.ts`、`src/components/DiagnosticOverlay.tsx`、`src/lib/i18n.ts`：增加实际 WebRTC 路径和浏览器到电脑的延迟标签。
- `package.json`、`yarn.lock`：新增 `buffer` 和 `fzstd`，分别用于浏览器协议兼容和远端光标解压。

验证包含类型检查、生产构建、现有测试、新增的协议/身份/光标/信令测试、真实 Chrome DataChannel 联调，以及实际编译的 hbbs 加密信令测试。关闭 hbbs 扩展后的旧连接路径也已验证。尚未在用户的手机和 RustDesk 1.5.3 被控电脑之间完成实机局域网联调。
