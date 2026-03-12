import * as vscode from 'vscode';
import {
    AnyMcpRequest,
    createJsonRpcError,
    createJsonRpcSuccess,
    parseMcpRequestCode,
} from './mcp/protocol';
import { ChatPanel } from './webview/panel';
import { WebSocketClient } from './websocket/client';
import { ToolManager } from './tools/toolManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('DeepSeek 插件已激活');
    
    // 初始化 WebSocket 客户端
    const wsClient = WebSocketClient.getInstance(context);
    
    // 初始化工具管理器（使用单例）
    const toolManager = ToolManager.getInstance(context);

    // 注册启动聊天面板命令
    const startCommand = vscode.commands.registerCommand('deepseek.start', () => {
        ChatPanel.createOrShow(context.extensionUri, wsClient, toolManager);
    });

    // 注册连接命令
    const connectCommand = vscode.commands.registerCommand('deepseek.connect', () => {
        wsClient.connect();
    });

    // 注册断开命令
    const disconnectCommand = vscode.commands.registerCommand('deepseek.disconnect', () => {
        wsClient.disconnect();
    });

    // 注册切换深度思考命令
    const toggleThinkingCommand = vscode.commands.registerCommand('deepseek.toggleThinking', async () => {
        const state = await vscode.window.showQuickPick(['on', 'off', 'toggle'], {
            placeHolder: '选择深度思考状态'
        });
        if (state) {
            wsClient.sendCommand('toggle_thinking', state === 'toggle' ? undefined : state === 'on');
        }
    });

    // 注册切换智能搜索命令
    const toggleSearchCommand = vscode.commands.registerCommand('deepseek.toggleSearch', async () => {
        const state = await vscode.window.showQuickPick(['on', 'off', 'toggle'], {
            placeHolder: '选择智能搜索状态'
        });
        if (state) {
            wsClient.sendCommand('toggle_search', state === 'toggle' ? undefined : state === 'on');
        }
    });

    // 添加工具测试命令
    const runToolCommand = vscode.commands.registerCommand('deepseek.runTool', async () => {
        const input = await vscode.window.showInputBox({
            prompt: '请输入 JSON-RPC MCP 请求对象',
            placeHolder: '{"jsonrpc":"2.0","id":"debug-1","method":"tools/call","params":{"name":"workspace.list_directory","arguments":{"path":"."}}}'
        });
        if (!input) return;
        try {
            const parsed = parseMcpRequestCode(input);
            const response = 'error' in parsed
                ? parsed.error
                : await executeDebugRequest(toolManager, parsed.request);

            const document = await vscode.workspace.openTextDocument({
                language: 'json',
                content: JSON.stringify(response, null, 2),
            });
            await vscode.window.showTextDocument(document, {
                preview: true,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`执行失败: ${message}`);
        }
    });
    context.subscriptions.push(runToolCommand);

    // 将所有命令添加到 subscriptions
    context.subscriptions.push(
        startCommand,
        connectCommand,
        disconnectCommand,
        toggleThinkingCommand,
        toggleSearchCommand
    );

    // 自动连接
    const config = vscode.workspace.getConfiguration('deepseek');
    if (config.get('autoConnect')) {
        wsClient.connect();
    }
}

export function deactivate() {
    const wsClient = WebSocketClient.getInstance();
    if (wsClient) {
        wsClient.disconnect();
    }
}

async function executeDebugRequest(toolManager: ToolManager, request: AnyMcpRequest) {
    if (request.method === 'tools/call') {
        const validation = toolManager.validateToolCall(
            request.params.name,
            request.params.arguments ?? {}
        );
        if (!validation.ok) {
            return createJsonRpcError(
                request.id,
                validation.code === 'unknown_tool' ? -32601 : -32602,
                validation.message ?? '工具调用无效。'
            );
        }

        const outcome = await toolManager.executeToolCall(
            request.params.name,
            request.params.arguments ?? {}
        );
        return createJsonRpcSuccess(request.id, {
            tool: request.params.name,
            isError: !outcome.success,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(outcome.success ? outcome.data : { error: outcome.error }, null, 2),
                },
            ],
        });
    }

    for (const [index, call] of request.params.calls.entries()) {
        const validation = toolManager.validateToolCall(call.name, call.arguments ?? {});
        if (!validation.ok) {
            return createJsonRpcError(
                request.id,
                validation.code === 'unknown_tool' ? -32601 : -32602,
                `批量调用第 ${index + 1} 项无效: ${validation.message ?? '未知错误'}`
            );
        }
    }

    const outcome = await toolManager.executeBatch(request.params.calls);
    return createJsonRpcSuccess(request.id, outcome);
}
