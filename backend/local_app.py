import asyncio
import websockets
import json
import sys

connected_clients = set()

async def broadcast(message: dict, exclude_client=None):
    """广播消息给所有连接的客户端，可选排除某个客户端"""
    if not connected_clients:
        return
    message_json = json.dumps(message)
    tasks = []
    for client in connected_clients:
        if exclude_client and client == exclude_client:
            continue
        tasks.append(client.send(message_json))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

async def handle_client(websocket):
    connected_clients.add(websocket)
    client_id = id(websocket)
    print(f"客户端 {client_id} 已连接，当前连接数: {len(connected_clients)}", flush=True)

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                print(f"从客户端 {client_id} 收到消息: {data}", flush=True)

                # 处理不同类型的消息
                msg_type = data.get('type')
                if msg_type == 'user_input':
                    # 将用户输入广播给所有其他客户端（如浏览器扩展）
                    await broadcast(data, exclude_client=websocket)
                    #print(f"从客户端 {client_id} 收到消息: {data}", flush=True)
                elif msg_type in ('toggle_thinking', 'toggle_search'):
                    # 按钮切换命令也广播给其他客户端
                    await broadcast(data, exclude_client=websocket)
                elif msg_type == 'ai_chunk':
                    # AI 回复块广播给所有客户端（包括 VSCode 插件）
                    await broadcast(data)
                elif msg_type == 'ai_end':
                    await broadcast(data)
                # 其他消息类型根据需求处理
            except json.JSONDecodeError:
                print(f"无效的JSON消息: {message[:100]}", flush=True)
            except Exception as e:
                print(f"处理消息时出错: {e}", flush=True)

    except websockets.exceptions.ConnectionClosed:
        print(f"客户端 {client_id} 连接关闭", flush=True)
    finally:
        connected_clients.remove(websocket)
        print(f"客户端 {client_id} 已移除，剩余连接数: {len(connected_clients)}", flush=True)

async def send_user_input():
    loop = asyncio.get_running_loop()
    while True:
        text = await loop.run_in_executor(None, sys.stdin.readline)
        text = text.strip()
        if not text:
            continue

        if text.startswith('/'):
            parts = text[1:].split()
            cmd = parts[0].lower()
            if cmd in ('think', 'thinking'):
                state = parts[1].lower() if len(parts) > 1 else None
                target = True if state == 'on' else (False if state == 'off' else None)
                message = {'type': 'toggle_thinking', 'state': target}
            elif cmd == 'search':
                state = parts[1].lower() if len(parts) > 1 else None
                target = True if state == 'on' else (False if state == 'off' else None)
                message = {'type': 'toggle_search', 'state': target}
            else:
                print(f"未知命令: {cmd}")
                continue
        else:
            message = {'type': 'user_input', 'text': text}

        if connected_clients:
            await broadcast(message)
            print(f"📤 已广播: {message}", flush=True)
        else:
            print("⚠️ 没有客户端连接，输入将不会被发送")

async def main():
    async with websockets.serve(handle_client, "127.0.0.1", 8765):
        print("🚀 WebSocket 服务器启动在 ws://127.0.0.1:8765", flush=True)
        print("等待浏览器扩展连接...", flush=True)
        await send_user_input()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 服务器已关闭", flush=True)