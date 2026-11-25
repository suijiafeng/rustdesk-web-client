# 开源 hbbs 的 WebRTC 适配

这是一组独立的服务端补丁，不会在 Render 部署时自动修改你的 ID 服务器。`hbbr` 无需改变。补丁针对以下固定源码版本，不应直接套在其他版本或已经修改过的服务端上：

- [rustdesk-server](https://github.com/rustdesk/rustdesk-server/commit/680b60395ecf99a76f74a1d934e453bb6e5e0aa2)：`680b60395ecf99a76f74a1d934e453bb6e5e0aa2`（包版本 1.1.17）。
- `libs/hbb_common`：`69cea8dafee147848ae88702029f4bf7df7224c3`。

## 补丁内容

- 转发 `PunchHoleRequest` 中的 WebRTC offer，并将 `PunchHoleSent` / `RelayResponse` 中的 answer 发回控制端。
- 即使位于同一局域网，带 WebRTC offer 的请求也走支持 offer 的 PunchHole 消息，避免落入不携带 SDP 的 FetchLocalAddr 分支。
- 保持控制端信令连接，双向转发 ICE，校验会话指纹、设备 ID、被控端来源 IP，并限制候选数、消息长度、会话数量和生存时间。
- 提供由 hbbs 私钥签名的 NaCl KeyExchange。RustDesk 1.5.3 的被控端只在加密信令连接上发送 ICE；仅添加 protobuf 字段不足以工作。
- 默认关闭。只有设置 `ENABLE_WEBRTC=Y` 且配置了服务器签名密钥才启用新 TCP 握手。不开启时保留原连接路径。

该补丁不是官方服务端版本。它使用现有 NaCl 握手版本 0；不实现 Pro 的管理、授权或其他功能。

## 构建和启用

在独立目录准备上述固定版本的完整源码，并初始化该版本的 `libs/hbb_common` 子模块。不要覆盖当前运行目录和密钥。

```sh
git clone https://github.com/rustdesk/rustdesk-server.git rustdesk-server-webrtc
cd rustdesk-server-webrtc
git checkout 680b60395ecf99a76f74a1d934e453bb6e5e0aa2
git submodule update --init --recursive
```

用本目录的 `apply.sh` 传入新源码目录的绝对路径。脚本会先验证版本、干净工作区和两个补丁能否应用，再修改源码；不会自动编译、部署或启动服务。

```sh
/path/to/web-client/server-patches/hbbs/apply.sh /path/to/rustdesk-server-webrtc
cd /path/to/rustdesk-server-webrtc
cargo build --locked --release --bin hbbs
```

先在独立环境验证，再替换自己的 `hbbs` 程序或镜像。继续使用原来的数据库、`id_ed25519` / `id_ed25519.pub`、端口和启动参数，并在服务进程的环境中加入：

```text
ENABLE_WEBRTC=Y
```

Docker 部署需要把这个变量配置在 hbbs 容器；不能只加在 Render 的 Node 服务中。原有 TCP/UDP 21116 等端口配置保持不变，WebRTC 画面不经过 hbbs。

Render / Node 网关的 WebRTC 默认关闭，还需设置 `RUSTDESK_ENABLE_WEBRTC=true`、重启网关并刷新网页。这与 hbbs 的 `ENABLE_WEBRTC=Y` 是两个独立开关。

被控端使用 RustDesk 1.5.3，并在高级设置启用 `enable-webrtc=Y`。网页填写相同的 ID 服务器、公钥和设备 ID，浏览器与电脑的局域网不能开启客户端隔离。成功时连接详情会显示「WebRTC · 浏览器直连」；仅看到「网关直连/中继」说明发生了回退。

## 验证范围

补丁已完成 `cargo check --locked --bin hbbs` 和开发构建，并用实际编译的 hbbs 验证加密握手、同局域网请求的 offer 转发、服务器签名设备公钥、answer 及双向 ICE 转发；补丁应用脚本也已在干净副本中验证。关闭扩展后的原始 TCP / 局域网 FetchLocalAddr 流程已验证。

浏览器实现已用真实 Chrome DataChannel 验证身份绑定、密码登录、鼠标控制、延迟探测、回退和拒绝密码后的停止行为。协议和网关信令有自动化测试。实际手机与 RustDesk 1.5.3 的局域网会话仍需部署后联调，不能据此承诺所有路由器、移动浏览器均能直接连通。

## 回退

关闭 `ENABLE_WEBRTC` 并重启 hbbs 可停用扩展；也可以恢复原服务端程序和原配置。补丁不更改数据库结构或重新生成已有密钥。Web 页面会继续使用原网关通道。
