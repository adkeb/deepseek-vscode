import assert from 'node:assert/strict';
import {
    createJsonRpcSuccess,
    formatTransportResponse,
    parseAssistantProtocol,
    parseMcpRequestCode,
} from '../mcp/protocol';
import { MarkdownRenderer } from '../webview/markdownRenderer';

async function main() {
    const plainMarkdown = parseAssistantProtocol([
        '普通回答',
        '```json',
        '{"example": true}',
        '```',
    ].join('\n'));
    assert.equal(plainMarkdown.request, undefined, '普通 json 代码块不应触发 MCP');

    const singleRequest = parseAssistantProtocol([
        '先读取文件。',
        '```mcp',
        JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'tools/call',
            params: {
                name: 'workspace.read_file',
                arguments: {
                    path: 'src/extension.ts',
                },
            },
        }, null, 2),
        '```',
    ].join('\n'));
    assert.equal(singleRequest.request?.method, 'tools/call');
    assert.equal(singleRequest.displayText, '先读取文件。');

    const multipleBlocks = parseAssistantProtocol([
        '```mcp',
        '{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"workspace.read_file","arguments":{"path":"package.json"}}}',
        '```',
        '```mcp',
        '{"jsonrpc":"2.0","id":"b","method":"tools/call","params":{"name":"editor.get_selection","arguments":{}}}',
        '```',
    ].join('\n'));
    assert.equal(multipleBlocks.request?.id, 'a');
    assert.ok(multipleBlocks.warnings.length > 0, '多个 MCP 代码块应产生告警');

    const invalidRequest = parseMcpRequestCode('{');
    assert.ok('error' in invalidRequest, '非法 JSON 必须返回结构化错误');

    const responsePayload = formatTransportResponse(
        createJsonRpcSuccess('req-2', {
            ok: true,
        })
    );
    assert.ok(responsePayload.includes('```mcp-result'), '结果消息必须使用 mcp-result 代码块');

    const renderer = new MarkdownRenderer();
    const rendered = renderer.render([
        '**加粗**',
        '',
        '```ts',
        'const answer = 42;',
        '```',
    ].join('\n'));
    assert.ok(rendered.includes('<strong>加粗</strong>'), 'Markdown 必须渲染粗体');
    assert.ok(rendered.includes('code-copy-button'), '代码块应包含复制按钮');

    console.log('DeepSeek VS Code smoke tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
