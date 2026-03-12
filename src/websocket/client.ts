import * as vscode from 'vscode';
import WebSocket from 'ws';

type BackendCommandType = 'toggle_thinking' | 'toggle_search';

export interface ConnectionState {
    connected: boolean;
    connecting: boolean;
    port: number;
}

export interface ModeState {
    thinkingEnabled: boolean;
    searchEnabled: boolean;
}

export class WebSocketClient {
    private static instance: WebSocketClient | undefined;
    private ws: WebSocket | undefined;
    private statusBarItem: vscode.StatusBarItem;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private readonly messageEmitter = new vscode.EventEmitter<Record<string, unknown>>();
    private readonly connectionEmitter = new vscode.EventEmitter<ConnectionState>();
    private readonly modeEmitter = new vscode.EventEmitter<ModeState>();
    private shouldReconnect = true;
    private isConnecting = false;
    private thinkingEnabled = false;
    private searchEnabled = false;

    private constructor(private context: vscode.ExtensionContext) {
        WebSocketClient.instance = this;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.text = "$(plug) DeepSeek: 未连接";
        this.statusBarItem.command = 'deepseek.connect';
        this.statusBarItem.show();
        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(this.messageEmitter, this.connectionEmitter, this.modeEmitter);
        this.emitConnectionState();
        this.emitModeState();
    }

    static getInstance(context?: vscode.ExtensionContext): WebSocketClient {
        if (!WebSocketClient.instance && context) {
            new WebSocketClient(context);
        }
        return WebSocketClient.instance!;
    }

    get port(): number {
        const config = vscode.workspace.getConfiguration('deepseek');
        return config.get('backendPort', 8765);
    }

    get connectionState(): ConnectionState {
        return {
            connected: this.ws?.readyState === WebSocket.OPEN,
            connecting: this.isConnecting,
            port: this.port,
        };
    }

    get modeState(): ModeState {
        return {
            thinkingEnabled: this.thinkingEnabled,
            searchEnabled: this.searchEnabled,
        };
    }

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.shouldReconnect = true;
        this.isConnecting = true;
        const wsUrl = `ws://127.0.0.1:${this.port}`;
        this.statusBarItem.text = `$(sync~spin) DeepSeek: 连接中...`;
        this.statusBarItem.command = undefined;
        this.emitConnectionState();

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('[DeepSeek] WebSocket已连接');
                this.statusBarItem.text = "$(check) DeepSeek: 已连接";
                this.statusBarItem.command = 'deepseek.disconnect';
                vscode.window.showInformationMessage('DeepSeek已连接到后端');
                this.isConnecting = false;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = undefined;
                }
                this.emitConnectionState();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.messageEmitter.fire(message);
                } catch (error) {
                    console.error('[DeepSeek] 消息解析失败:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('[DeepSeek] WebSocket连接关闭');
                this.ws = undefined;
                this.isConnecting = false;
                this.statusBarItem.text = "$(plug) DeepSeek: 未连接";
                this.statusBarItem.command = 'deepseek.connect';
                this.emitConnectionState();
                if (this.shouldReconnect && !this.reconnectTimer) {
                    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
                }
            });

            this.ws.on('error', (error) => {
                console.error('[DeepSeek] WebSocket错误:', error);
                this.isConnecting = false;
                this.emitConnectionState();
                vscode.window.showErrorMessage(`DeepSeek连接失败: ${error.message}`);
            });

        } catch (error) {
            console.error('[DeepSeek] 连接失败:', error);
            this.isConnecting = false;
            this.statusBarItem.text = "$(error) DeepSeek: 连接失败";
            this.emitConnectionState();
        }
    }

    disconnect() {
        this.shouldReconnect = false;
        this.isConnecting = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
        this.statusBarItem.text = "$(plug) DeepSeek: 未连接";
        this.statusBarItem.command = 'deepseek.connect';
        this.emitConnectionState();
    }

    sendMessage(text: string): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'user_input', text }));
            return true;
        }
        vscode.window.showErrorMessage('DeepSeek未连接，请先连接后端');
        return false;
    }

    sendCommand(type: BackendCommandType, state?: boolean): boolean {
        const resolvedState = this.resolveModeState(type, state);
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, state: resolvedState }));
            this.applyModeState(type, resolvedState);
            return true;
        }
        vscode.window.showErrorMessage('DeepSeek未连接，请先连接后端');
        return false;
    }

    onDidMessage(handler: (data: Record<string, unknown>) => void): vscode.Disposable {
        return this.messageEmitter.event(handler);
    }

    onDidConnectionStateChange(handler: (state: ConnectionState) => void): vscode.Disposable {
        return this.connectionEmitter.event(handler);
    }

    onDidModeStateChange(handler: (state: ModeState) => void): vscode.Disposable {
        return this.modeEmitter.event(handler);
    }

    private resolveModeState(type: BackendCommandType, requestedState?: boolean): boolean {
        if (requestedState !== undefined) {
            return requestedState;
        }

        return type === 'toggle_thinking'
            ? !this.thinkingEnabled
            : !this.searchEnabled;
    }

    private applyModeState(type: BackendCommandType, value: boolean) {
        if (type === 'toggle_thinking') {
            this.thinkingEnabled = value;
        } else {
            this.searchEnabled = value;
        }
        this.emitModeState();
    }

    private emitConnectionState() {
        this.connectionEmitter.fire(this.connectionState);
    }

    private emitModeState() {
        this.modeEmitter.fire(this.modeState);
    }
}
