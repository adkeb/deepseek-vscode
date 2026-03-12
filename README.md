# DeepSeek VS Code

一个本地桥接式的 DeepSeek VS Code 扩展原型。

它由三部分组成：

- VS Code 插件：负责聊天面板、MCP 兼容工具调用、本地文件/编辑器能力
- `backend/local_app.py`：本地 WebSocket 中转服务
- `浏览器插件/dist`：注入 `chat.deepseek.com`，把网页侧输入和流式输出转发到本地

## 目录说明

- `src/`：VS Code 插件源码
- `backend/local_app.py`：本地 WebSocket 桥接服务
- `浏览器插件/dist/`：浏览器扩展打包产物
- `.vscode/launch.json`：VS Code 扩展调试配置

## 环境要求

- Node.js 18+
- npm
- Python 3.10+
- 已安装 VS Code
- Chromium 内核浏览器

Python 依赖：

```bash
pip install websockets
```

Node 依赖安装：

```bash
npm install
```

## `backend/local_app.py` 使用说明

`backend/local_app.py` 是整个系统的本地消息总线，默认监听：

```text
ws://127.0.0.1:8765
```

它的职责只有两件事：

1. 接收来自 VS Code 插件和浏览器插件的消息
2. 将消息广播给其他已连接客户端

支持的消息类型：

- `user_input`
- `toggle_thinking`
- `toggle_search`
- `ai_chunk`
- `ai_end`

### 启动方式

在项目根目录执行：

```bash
python backend/local_app.py
```

启动成功后会看到类似输出：

```text
WebSocket 服务器启动在 ws://127.0.0.1:8765
等待浏览器扩展连接...
```

### 控制台输入

`local_app.py` 支持直接从终端输入消息并广播：

- 直接输入文本：向已连接客户端发送 `user_input`
- `/think on`：打开深度思考
- `/think off`：关闭深度思考
- `/think`：切换深度思考
- `/search on`：打开智能搜索
- `/search off`：关闭智能搜索
- `/search`：切换智能搜索

如果当前没有客户端连接，服务会提示输入不会被发送。

## 项目启动顺序

建议按下面顺序启动：

1. 启动本地桥接服务

```bash
python backend/local_app.py
```

2. 启动 VS Code 插件开发环境

```bash
npm run compile
```

然后在 VS Code 中打开这个项目，按 `F5` 启动扩展宿主。

3. 安装浏览器插件

在 Chromium 浏览器中打开扩展管理页，选择“加载已解压的扩展程序”，目录选择：

```text
浏览器插件/dist
```

4. 打开 DeepSeek 网页

访问：

```text
https://chat.deepseek.com/
```

5. 在扩展宿主里打开聊天面板

执行命令：

- `DeepSeek: 启动聊天面板`

## VS Code 插件调试

已配置好调试和后台编译任务：

- `F5`：启动扩展开发宿主
- `npm: watch`：后台持续编译 TypeScript

常用命令：

- `DeepSeek: 启动聊天面板`
- `DeepSeek: 连接后端`
- `DeepSeek: 断开连接`
- `DeepSeek: 切换深度思考`
- `DeepSeek: 切换智能搜索`
- `DeepSeek: 运行 MCP 请求 (测试)`

## MCP 兼容工具调用

当前插件会从 AI 回复中的 ` ```mcp ` 代码块里读取严格 JSON-RPC 请求，并执行本地工具。

支持两类方法：

- `tools/call`
- `deepseek/tools/callBatch`

工具示例：

- `workspace.read_file`
- `workspace.write_file`
- `workspace.list_directory`
- `workspace.find_files`
- `workspace.search_text`
- `editor.get_active_document`
- `editor.get_selection`
- `editor.replace_selection`
- `editor.apply_text_edits`
- `window.open_file`
- `commands.execute`

## 常用开发命令

编译：

```bash
npm run compile
```

静态检查：

```bash
npm run lint
```

最小 smoke test：

```bash
npm test
```

## 常见问题

### 1. 面板显示未连接

检查 `backend/local_app.py` 是否已经启动，且端口 `8765` 没被占用。

### 2. 浏览器插件没有响应

确认已加载 `浏览器插件/dist`，并且当前页面就是 `https://chat.deepseek.com/`。

### 3. MCP 工具没有触发

确认 AI 输出的是：

- 一个 ` ```mcp ` fenced code block
- 合法 JSON
- 合法 JSON-RPC 2.0 请求

### 4. `commands.execute` 被拒绝

该工具只允许执行白名单命令。可以通过 VS Code 设置里的 `deepseek.allowedCommands` 追加允许的命令 ID。
