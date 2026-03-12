export type JsonRpcId = string | number | null;

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcErrorResponse {
    jsonrpc: '2.0';
    id: JsonRpcId;
    error: JsonRpcError;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
    jsonrpc: '2.0';
    id: JsonRpcId;
    result: TResult;
}

export type JsonRpcResponse<TResult = unknown> = JsonRpcErrorResponse | JsonRpcSuccessResponse<TResult>;

export interface McpToolCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}

export interface McpBatchCallItem {
    name: string;
    arguments?: Record<string, unknown>;
}

export interface McpBatchCallParams {
    calls: McpBatchCallItem[];
}

export interface McpToolCallRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: 'tools/call';
    params: McpToolCallParams;
}

export interface McpBatchCallRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: 'deepseek/tools/callBatch';
    params: McpBatchCallParams;
}

export type AnyMcpRequest = McpToolCallRequest | McpBatchCallRequest;

export interface ParsedAssistantProtocol {
    displayText: string;
    warnings: string[];
    request?: AnyMcpRequest;
    errorResponse?: JsonRpcErrorResponse;
    blockCount: number;
}

interface ExtractedMcpBlock {
    raw: string;
    code: string;
}

const MCP_BLOCK_REGEX = /```mcp[ \t]*\r?\n([\s\S]*?)```/g;

export function parseAssistantProtocol(markdown: string): ParsedAssistantProtocol {
    const blocks = extractMcpBlocks(markdown);
    const warnings: string[] = [];
    const validRequests: AnyMcpRequest[] = [];
    let firstErrorResponse: JsonRpcErrorResponse | undefined;

    for (const block of blocks) {
        const parsed = parseMcpRequestCode(block.code);
        if ('error' in parsed) {
            firstErrorResponse ??= parsed.error;
            continue;
        }
        validRequests.push(parsed.request);
    }

    if (validRequests.length > 1) {
        warnings.push(`检测到 ${validRequests.length} 个可执行 MCP 代码块，已只执行第一个合法块。`);
    }

    if (blocks.length > 0 && validRequests.length === 0) {
        warnings.push('检测到 MCP 代码块，但未找到合法的 JSON-RPC 请求。');
    }

    return {
        displayText: stripMcpBlocks(markdown),
        warnings,
        request: validRequests[0],
        errorResponse: validRequests.length === 0 ? firstErrorResponse : undefined,
        blockCount: blocks.length,
    };
}

export function parseMcpRequestCode(code: string): { request: AnyMcpRequest } | { error: JsonRpcErrorResponse } {
    let value: unknown;

    try {
        value = JSON.parse(code);
    } catch (error) {
        return {
            error: createJsonRpcError(
                null,
                -32700,
                'MCP 请求 JSON 解析失败。',
                getErrorMessage(error)
            ),
        };
    }

    if (!isRecord(value)) {
        return {
            error: createJsonRpcError(null, -32600, 'MCP 请求必须是 JSON 对象。'),
        };
    }

    const id = parseId(value.id);
    if (value.jsonrpc !== '2.0') {
        return {
            error: createJsonRpcError(id, -32600, '仅支持 JSON-RPC 2.0。'),
        };
    }

    if (typeof value.method !== 'string') {
        return {
            error: createJsonRpcError(id, -32600, 'MCP 请求缺少 method。'),
        };
    }

    if (!('id' in value)) {
        return {
            error: createJsonRpcError(null, -32600, 'MCP 请求缺少 id。'),
        };
    }

    if (value.method === 'tools/call') {
        if (!isRecord(value.params)) {
            return {
                error: createJsonRpcError(id, -32602, 'tools/call.params 必须是对象。'),
            };
        }

        if (typeof value.params.name !== 'string' || !value.params.name.trim()) {
            return {
                error: createJsonRpcError(id, -32602, 'tools/call.params.name 必须是非空字符串。'),
            };
        }

        const args = value.params.arguments;
        if (args !== undefined && !isRecord(args)) {
            return {
                error: createJsonRpcError(id, -32602, 'tools/call.params.arguments 必须是对象。'),
            };
        }

        return {
            request: {
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: {
                    name: value.params.name,
                    arguments: (args as Record<string, unknown> | undefined) ?? {},
                },
            },
        };
    }

    if (value.method === 'deepseek/tools/callBatch') {
        if (!isRecord(value.params) || !Array.isArray(value.params.calls)) {
            return {
                error: createJsonRpcError(id, -32602, 'deepseek/tools/callBatch.params.calls 必须是数组。'),
            };
        }

        const calls: McpBatchCallItem[] = [];
        for (let index = 0; index < value.params.calls.length; index += 1) {
            const call = value.params.calls[index];
            if (!isRecord(call)) {
                return {
                    error: createJsonRpcError(id, -32602, `批量调用第 ${index + 1} 项必须是对象。`),
                };
            }

            if (typeof call.name !== 'string' || !call.name.trim()) {
                return {
                    error: createJsonRpcError(id, -32602, `批量调用第 ${index + 1} 项缺少合法的 name。`),
                };
            }

            if (call.arguments !== undefined && !isRecord(call.arguments)) {
                return {
                    error: createJsonRpcError(id, -32602, `批量调用第 ${index + 1} 项 arguments 必须是对象。`),
                };
            }

            calls.push({
                name: call.name,
                arguments: (call.arguments as Record<string, unknown> | undefined) ?? {},
            });
        }

        return {
            request: {
                jsonrpc: '2.0',
                id,
                method: 'deepseek/tools/callBatch',
                params: { calls },
            },
        };
    }

    return {
        error: createJsonRpcError(id, -32601, `不支持的方法: ${value.method}`),
    };
}

export function createJsonRpcSuccess<TResult>(id: JsonRpcId, result: TResult): JsonRpcSuccessResponse<TResult> {
    return {
        jsonrpc: '2.0',
        id,
        result,
    };
}

export function createJsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
    return {
        jsonrpc: '2.0',
        id,
        error: {
            code,
            message,
            data,
        },
    };
}

export function formatTransportResponse(response: JsonRpcResponse): string {
    return [
        '以下是工具调用结果，请继续处理当前任务，不要把它当作新的用户需求。',
        '',
        '```mcp-result',
        JSON.stringify(response, null, 2),
        '```',
    ].join('\n');
}

function extractMcpBlocks(markdown: string): ExtractedMcpBlock[] {
    const blocks: ExtractedMcpBlock[] = [];
    for (const match of markdown.matchAll(MCP_BLOCK_REGEX)) {
        blocks.push({
            raw: match[0],
            code: match[1].trim(),
        });
    }
    return blocks;
}

function stripMcpBlocks(markdown: string): string {
    return markdown.replace(MCP_BLOCK_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
}

function parseId(value: unknown): JsonRpcId {
    if (typeof value === 'string' || typeof value === 'number' || value === null) {
        return value;
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
