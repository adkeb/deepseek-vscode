import * as vscode from 'vscode';
import * as path from 'path';

export interface ToolValidationResult {
    ok: boolean;
    code?: 'unknown_tool' | 'invalid_params';
    message?: string;
}

export interface ToolExecutionOutcome {
    name: string;
    success: boolean;
    data?: unknown;
    error?: string;
    confirmationRequired: boolean;
    confirmationState: 'not_required' | 'approved' | 'rejected';
}

export interface BatchExecutionOutcome {
    results: ToolExecutionOutcome[];
    summary: {
        total: number;
        succeeded: number;
        failed: number;
    };
    confirmationRequired: boolean;
    confirmationState: 'not_required' | 'approved' | 'rejected';
}

interface ToolPromptSpec {
    argumentsShape: string;
    description: string;
}

interface ToolDefinition {
    name: string;
    description: string;
    requiresConfirmation: boolean;
    prompt: ToolPromptSpec;
    validate: (args: Record<string, unknown>) => string | undefined;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}

type BatchToolCall = {
    name: string;
    arguments?: Record<string, unknown>;
};

export class ToolManager {
    private static instance: ToolManager | undefined;
    private readonly tools = new Map<string, ToolDefinition>();
    private readonly builtInAllowedCommands = new Set<string>([
        'workbench.action.quickOpen',
        'workbench.action.gotoLine',
        'workbench.action.showCommands',
        'workbench.view.explorer',
        'workbench.view.search',
        'workbench.action.focusActiveEditorGroup',
        'workbench.files.action.showActiveFileInExplorer',
        'vscode.open',
        'vscode.diff',
    ]);
    private readonly deniedCommandPrefixes = [
        'terminal.',
        'task.',
        'debug.',
        'workbench.action.tasks',
        'workbench.action.debug',
        'workbench.action.terminal',
        'workbench.extensions.install',
        'workbench.extensions.search',
        'workbench.trust',
    ];

    private constructor(private context: vscode.ExtensionContext) {
        this.registerTools();
    }

    static getInstance(context?: vscode.ExtensionContext): ToolManager {
        if (!ToolManager.instance) {
            if (!context) {
                throw new Error('ToolManager 未初始化，需要提供 context');
            }
            ToolManager.instance = new ToolManager(context);
        }
        return ToolManager.instance;
    }

    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    validateToolCall(name: string, args: Record<string, unknown> = {}): ToolValidationResult {
        const definition = this.tools.get(name);
        if (!definition) {
            return {
                ok: false,
                code: 'unknown_tool',
                message: `未知工具: ${name}`,
            };
        }

        const validationError = definition.validate(args);
        if (validationError) {
            return {
                ok: false,
                code: 'invalid_params',
                message: validationError,
            };
        }

        return { ok: true };
    }

    async executeToolCall(name: string, args: Record<string, unknown> = {}): Promise<ToolExecutionOutcome> {
        const definition = this.getDefinition(name);
        const confirmationRequired = definition.requiresConfirmation;

        if (confirmationRequired) {
            const approved = await this.requestConfirmation([
                this.describeToolCall(name, args),
            ]);

            if (!approved) {
                return {
                    name,
                    success: false,
                    error: '用户拒绝了操作',
                    confirmationRequired: true,
                    confirmationState: 'rejected',
                };
            }
        }

        return this.runTool(definition, args, confirmationRequired ? 'approved' : 'not_required');
    }

    async executeBatch(calls: BatchToolCall[]): Promise<BatchExecutionOutcome> {
        const normalizedCalls = calls.map(call => ({
            name: call.name,
            arguments: call.arguments ?? {},
        }));

        const confirmationRequired = normalizedCalls.some(call => this.getDefinition(call.name).requiresConfirmation);
        if (confirmationRequired) {
            const approved = await this.requestConfirmation(
                normalizedCalls.map(call => this.describeToolCall(call.name, call.arguments))
            );

            if (!approved) {
                return {
                    results: normalizedCalls.map(call => ({
                        name: call.name,
                        success: false,
                        error: '用户拒绝了批量操作',
                        confirmationRequired: true,
                        confirmationState: 'rejected',
                    })),
                    summary: {
                        total: normalizedCalls.length,
                        succeeded: 0,
                        failed: normalizedCalls.length,
                    },
                    confirmationRequired: true,
                    confirmationState: 'rejected',
                };
            }
        }

        const results: ToolExecutionOutcome[] = [];
        for (const call of normalizedCalls) {
            const definition = this.getDefinition(call.name);
            results.push(await this.runTool(
                definition,
                call.arguments,
                confirmationRequired ? 'approved' : 'not_required'
            ));
        }

        const succeeded = results.filter(result => result.success).length;
        return {
            results,
            summary: {
                total: results.length,
                succeeded,
                failed: results.length - succeeded,
            },
            confirmationRequired,
            confirmationState: confirmationRequired ? 'approved' : 'not_required',
        };
    }

    getToolPromptCatalog(): string {
        return Array.from(this.tools.values())
            .map(tool => `- ${tool.name}: ${tool.prompt.description} 参数: ${tool.prompt.argumentsShape}`)
            .join('\n');
    }

    describeToolCall(name: string, args: Record<string, unknown> = {}): string {
        switch (name) {
            case 'workspace.read_file':
                return `读取工作区文件 ${String(args.path ?? '')}`;
            case 'workspace.write_file':
                return `写入工作区文件 ${String(args.path ?? '')}`;
            case 'workspace.list_directory':
                return `列出目录 ${String(args.path ?? '')}`;
            case 'workspace.find_files':
                return `按 glob 查找文件 ${String(args.pattern ?? '')}`;
            case 'workspace.search_text':
                return `全文搜索 ${String(args.pattern ?? '')}`;
            case 'workspace.stat_path':
                return `查看路径状态 ${String(args.path ?? '')}`;
            case 'editor.get_active_document':
                return '读取当前活动编辑器内容';
            case 'editor.get_selection':
                return '读取当前选区内容';
            case 'editor.replace_selection':
                return '替换当前选区内容';
            case 'editor.apply_text_edits':
                return `对文档应用 ${Array.isArray(args.edits) ? args.edits.length : 0} 项文本编辑`;
            case 'window.open_file':
                return `打开文件 ${String(args.path ?? '')}`;
            case 'commands.execute':
                return `执行 VS Code 命令 ${String(args.command ?? '')}`;
            default:
                return `${name}: ${JSON.stringify(args)}`;
        }
    }

    private async requestConfirmation(descriptions: string[]): Promise<boolean> {
        const preview = descriptions
            .slice(0, 8)
            .map((line, index) => `${index + 1}. ${line}`)
            .join('\n');
        const remainder = descriptions.length > 8
            ? `\n... 以及另外 ${descriptions.length - 8} 项`
            : '';

        const result = await vscode.window.showWarningMessage(
            `AI 请求执行以下操作：\n${preview}${remainder}\n\n是否允许？`,
            { modal: true },
            '允许',
            '拒绝'
        );
        return result === '允许';
    }

    private async runTool(
        definition: ToolDefinition,
        args: Record<string, unknown>,
        confirmationState: ToolExecutionOutcome['confirmationState']
    ): Promise<ToolExecutionOutcome> {
        try {
            const data = await definition.execute(args);
            return {
                name: definition.name,
                success: true,
                data,
                confirmationRequired: definition.requiresConfirmation,
                confirmationState,
            };
        } catch (error) {
            return {
                name: definition.name,
                success: false,
                error: this.getErrorMessage(error),
                confirmationRequired: definition.requiresConfirmation,
                confirmationState,
            };
        }
    }

    private registerTools() {
        this.register({
            name: 'workspace.read_file',
            description: '读取工作区中的文本文件。',
            requiresConfirmation: false,
            prompt: {
                description: '读取工作区内的文本文件内容。',
                argumentsShape: '{ "path": "相对路径或绝对路径" }',
            },
            validate: (args) => this.requireString(args, 'path'),
            execute: async (args) => {
                const uri = this.resolveWorkspaceUri(this.readStringArg(args, 'path'));
                const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                return {
                    path: this.toDisplayPath(uri),
                    content,
                };
            },
        });

        this.register({
            name: 'workspace.write_file',
            description: '写入工作区中的文本文件。',
            requiresConfirmation: true,
            prompt: {
                description: '写入文本文件，如有需要自动创建父目录。',
                argumentsShape: '{ "path": "相对路径或绝对路径", "content": "文本内容" }',
            },
            validate: (args) => this.requireString(args, 'path') ?? this.requireString(args, 'content'),
            execute: async (args) => {
                const uri = this.resolveWorkspaceUri(this.readStringArg(args, 'path'));
                await vscode.workspace.fs.createDirectory(this.dirnameUri(uri));
                await vscode.workspace.fs.writeFile(uri, Buffer.from(this.readStringArg(args, 'content'), 'utf8'));
                return {
                    path: this.toDisplayPath(uri),
                    bytes: Buffer.byteLength(this.readStringArg(args, 'content'), 'utf8'),
                };
            },
        });

        this.register({
            name: 'workspace.list_directory',
            description: '列出工作区目录内容。',
            requiresConfirmation: false,
            prompt: {
                description: '列出目录中的文件和子目录。',
                argumentsShape: '{ "path": "目录路径" }',
            },
            validate: (args) => this.requireString(args, 'path'),
            execute: async (args) => {
                const uri = this.resolveWorkspaceUri(this.readStringArg(args, 'path'));
                const entries = await vscode.workspace.fs.readDirectory(uri);
                return {
                    path: this.toDisplayPath(uri),
                    entries: entries.map(([name, kind]) => ({
                        name,
                        kind: this.fileTypeToLabel(kind),
                    })),
                };
            },
        });

        this.register({
            name: 'workspace.find_files',
            description: '按 glob 在工作区查找文件。',
            requiresConfirmation: false,
            prompt: {
                description: '按 glob 模式查找文件。',
                argumentsShape: '{ "pattern": "**/*.ts", "exclude": "**/node_modules/**", "maxResults": 50 }',
            },
            validate: (args) => this.requireString(args, 'pattern'),
            execute: async (args) => {
                const files = await vscode.workspace.findFiles(
                    this.readStringArg(args, 'pattern'),
                    this.readOptionalString(args, 'exclude'),
                    this.readOptionalNumber(args, 'maxResults')
                );
                return {
                    files: files.map(file => this.toDisplayPath(file)),
                };
            },
        });

        this.register({
            name: 'workspace.search_text',
            description: '在工作区中搜索文本。',
            requiresConfirmation: false,
            prompt: {
                description: '全文搜索文本并返回命中位置。',
                argumentsShape: '{ "pattern": "foo", "include": "**/*.ts", "exclude": "**/dist/**", "maxResults": 50 }',
            },
            validate: (args) => this.requireString(args, 'pattern'),
            execute: async (args) => {
                const maxResults = this.readOptionalNumber(args, 'maxResults') ?? 50;
                const include = this.readOptionalString(args, 'include') ?? '**/*';
                const exclude = this.readOptionalString(args, 'exclude');
                const pattern = this.readStringArg(args, 'pattern');
                const isRegExp = Boolean(args.isRegExp);
                const isCaseSensitive = Boolean(args.isCaseSensitive);
                const isWordMatch = Boolean(args.isWordMatch);
                const flags = isCaseSensitive ? 'g' : 'gi';
                const matcher = isRegExp
                    ? new RegExp(pattern, flags)
                    : new RegExp(
                        isWordMatch ? `\\b${escapeRegExp(pattern)}\\b` : escapeRegExp(pattern),
                        flags
                    );
                const files = await vscode.workspace.findFiles(include, exclude, Math.max(maxResults * 4, 100));
                const results: Array<Record<string, unknown>> = [];

                for (const file of files) {
                    if (results.length >= maxResults) {
                        break;
                    }

                    let content: string;
                    try {
                        content = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
                    } catch (error) {
                        continue;
                    }

                    const lines = content.split(/\r?\n/);
                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                        if (results.length >= maxResults) {
                            break;
                        }

                        const line = lines[lineIndex];
                        matcher.lastIndex = 0;
                        if (!matcher.test(line)) {
                            continue;
                        }

                        results.push({
                            path: this.toDisplayPath(file),
                            line: lineIndex + 1,
                            preview: line.trim(),
                        });
                    }
                }

                return {
                    matches: results,
                };
            },
        });

        this.register({
            name: 'workspace.stat_path',
            description: '查看工作区路径状态。',
            requiresConfirmation: false,
            prompt: {
                description: '返回路径的文件类型、大小和时间戳。',
                argumentsShape: '{ "path": "相对路径或绝对路径" }',
            },
            validate: (args) => this.requireString(args, 'path'),
            execute: async (args) => {
                const uri = this.resolveWorkspaceUri(this.readStringArg(args, 'path'));
                const stat = await vscode.workspace.fs.stat(uri);
                return {
                    path: this.toDisplayPath(uri),
                    type: this.fileTypeToLabel(stat.type),
                    size: stat.size,
                    ctime: stat.ctime,
                    mtime: stat.mtime,
                };
            },
        });

        this.register({
            name: 'editor.get_active_document',
            description: '读取当前活动编辑器内容。',
            requiresConfirmation: false,
            prompt: {
                description: '读取当前活动编辑器的元信息和内容。',
                argumentsShape: '{ "includeContent": true }',
            },
            validate: () => undefined,
            execute: async (args) => {
                const editor = this.requireActiveEditor();
                const document = editor.document;
                const includeContent = args.includeContent !== false;
                return {
                    path: document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.toString(),
                    languageId: document.languageId,
                    version: document.version,
                    isDirty: document.isDirty,
                    selection: editor.selections.map(selection => this.selectionToObject(selection)),
                    content: includeContent ? document.getText() : undefined,
                };
            },
        });

        this.register({
            name: 'editor.get_selection',
            description: '读取当前编辑器选区。',
            requiresConfirmation: false,
            prompt: {
                description: '读取当前活动编辑器的全部选区和文本。',
                argumentsShape: '{}',
            },
            validate: () => undefined,
            execute: async () => {
                const editor = this.requireActiveEditor();
                return {
                    path: editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : editor.document.uri.toString(),
                    selections: editor.selections.map(selection => ({
                        ...this.selectionToObject(selection),
                        text: editor.document.getText(selection),
                    })),
                };
            },
        });

        this.register({
            name: 'editor.replace_selection',
            description: '替换当前编辑器选区内容。',
            requiresConfirmation: true,
            prompt: {
                description: '用同一段文本替换当前所有选区。',
                argumentsShape: '{ "text": "replacement" }',
            },
            validate: (args) => this.requireString(args, 'text'),
            execute: async (args) => {
                const editor = this.requireActiveEditor();
                const text = this.readStringArg(args, 'text');
                const succeeded = await editor.edit(editBuilder => {
                    editor.selections.forEach(selection => editBuilder.replace(selection, text));
                });

                if (!succeeded) {
                    throw new Error('编辑器拒绝了选区替换。');
                }

                return {
                    path: editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : editor.document.uri.toString(),
                    selectionCount: editor.selections.length,
                };
            },
        });

        this.register({
            name: 'editor.apply_text_edits',
            description: '对文档应用结构化文本编辑。',
            requiresConfirmation: true,
            prompt: {
                description: '对活动编辑器或指定路径应用多段文本编辑。',
                argumentsShape: '{ "path": "可选", "edits": [{ "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 1 } }, "text": "new" }] }',
            },
            validate: (args) => {
                if (!Array.isArray(args.edits) || args.edits.length === 0) {
                    return 'editor.apply_text_edits.edits 必须是非空数组。';
                }

                for (const [index, edit] of args.edits.entries()) {
                    if (!this.isValidEdit(edit)) {
                        return `edits[${index}] 缺少合法的 range 或 text。`;
                    }
                }

                if (args.path !== undefined && typeof args.path !== 'string') {
                    return 'path 必须是字符串。';
                }

                return undefined;
            },
            execute: async (args) => {
                const targetUri = args.path
                    ? this.resolveWorkspaceUri(this.readStringArg(args, 'path'))
                    : this.requireActiveEditor().document.uri;
                const workspaceEdit = new vscode.WorkspaceEdit();
                const edits = args.edits as Array<Record<string, unknown>>;
                edits.forEach(edit => {
                    workspaceEdit.replace(targetUri, this.readRange(edit.range), this.readStringArg(edit, 'text'));
                });

                const applied = await vscode.workspace.applyEdit(workspaceEdit);
                if (!applied) {
                    throw new Error('VS Code 未应用这些文本编辑。');
                }

                return {
                    path: targetUri.scheme === 'file' ? targetUri.fsPath : targetUri.toString(),
                    editCount: edits.length,
                };
            },
        });

        this.register({
            name: 'window.open_file',
            description: '在编辑器中打开文件。',
            requiresConfirmation: false,
            prompt: {
                description: '打开工作区中的文件并聚焦编辑器。',
                argumentsShape: '{ "path": "相对路径或绝对路径", "preview": false }',
            },
            validate: (args) => this.requireString(args, 'path'),
            execute: async (args) => {
                const uri = this.resolveWorkspaceUri(this.readStringArg(args, 'path'));
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, {
                    preview: Boolean(args.preview),
                });
                return {
                    path: this.toDisplayPath(uri),
                    languageId: document.languageId,
                };
            },
        });

        this.register({
            name: 'commands.execute',
            description: '执行白名单中的 VS Code 命令。',
            requiresConfirmation: true,
            prompt: {
                description: '执行允许的 VS Code 内置命令。',
                argumentsShape: '{ "command": "workbench.action.quickOpen", "arguments": [] }',
            },
            validate: (args) => {
                const commandError = this.requireString(args, 'command');
                if (commandError) {
                    return commandError;
                }
                if (args.arguments !== undefined && !Array.isArray(args.arguments)) {
                    return 'commands.execute.arguments 必须是数组。';
                }
                return this.isCommandAllowed(this.readStringArg(args, 'command'))
                    ? undefined
                    : `命令未被允许: ${this.readStringArg(args, 'command')}`;
            },
            execute: async (args) => {
                const command = this.readStringArg(args, 'command');
                const commandArgs = Array.isArray(args.arguments) ? args.arguments : [];
                const result = await vscode.commands.executeCommand(command, ...commandArgs);
                return {
                    command,
                    result: this.serialize(result),
                };
            },
        });
    }

    private register(definition: ToolDefinition) {
        this.tools.set(definition.name, definition);
    }

    private getDefinition(name: string): ToolDefinition {
        const definition = this.tools.get(name);
        if (!definition) {
            throw new Error(`未知工具: ${name}`);
        }
        return definition;
    }

    private resolveWorkspaceUri(inputPath: string): vscode.Uri {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new Error('当前没有打开任何工作区，无法解析路径。');
        }

        const normalizedInput = inputPath.replace(/\\/g, '/');
        let targetUri: vscode.Uri;

        if (path.isAbsolute(inputPath)) {
            targetUri = vscode.Uri.file(path.normalize(inputPath));
        } else {
            const segments = normalizedInput.split('/').filter(Boolean);
            const matchedFolder = folders.find(folder => segments[0] === folder.name);
            if (matchedFolder) {
                targetUri = vscode.Uri.joinPath(matchedFolder.uri, ...segments.slice(1));
            } else {
                targetUri = vscode.Uri.joinPath(folders[0].uri, ...segments);
            }
        }

        if (!this.isUriWithinWorkspace(targetUri, folders)) {
            throw new Error(`路径超出当前工作区范围: ${inputPath}`);
        }

        return targetUri;
    }

    private isUriWithinWorkspace(uri: vscode.Uri, folders: readonly vscode.WorkspaceFolder[]): boolean {
        if (uri.scheme !== 'file') {
            return false;
        }

        const candidate = path.resolve(uri.fsPath);
        return folders.some(folder => {
            const root = path.resolve(folder.uri.fsPath);
            return candidate === root || candidate.startsWith(`${root}${path.sep}`);
        });
    }

    private dirnameUri(uri: vscode.Uri): vscode.Uri {
        return uri.with({
            path: uri.path.replace(/\/[^/]+$/, '') || '/',
        });
    }

    private toDisplayPath(uri: vscode.Uri): string {
        if (uri.scheme !== 'file') {
            return uri.toString();
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return uri.fsPath;
        }

        const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        return relativePath ? `${workspaceFolder.name}/${relativePath}` : workspaceFolder.name;
    }

    private fileTypeToLabel(kind: vscode.FileType): string {
        if (kind & vscode.FileType.Directory) {
            return 'directory';
        }
        if (kind & vscode.FileType.SymbolicLink) {
            return 'symlink';
        }
        return 'file';
    }

    private rangeToObject(range: vscode.Range) {
        return {
            start: {
                line: range.start.line,
                character: range.start.character,
            },
            end: {
                line: range.end.line,
                character: range.end.character,
            },
        };
    }

    private selectionToObject(selection: vscode.Selection) {
        return {
            anchor: {
                line: selection.anchor.line,
                character: selection.anchor.character,
            },
            active: {
                line: selection.active.line,
                character: selection.active.character,
            },
            isReversed: selection.isReversed,
        };
    }

    private readStringArg(args: Record<string, unknown>, key: string): string {
        const value = args[key];
        if (typeof value !== 'string') {
            throw new Error(`${key} 必须是字符串。`);
        }
        return value;
    }

    private readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
        const value = args[key];
        return typeof value === 'string' ? value : undefined;
    }

    private readOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
        const value = args[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    private requireString(args: Record<string, unknown>, key: string): string | undefined {
        return typeof args[key] === 'string' && String(args[key]).trim()
            ? undefined
            : `${key} 必须是非空字符串。`;
    }

    private requireActiveEditor(): vscode.TextEditor {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('当前没有活动编辑器。');
        }
        return editor;
    }

    private isValidEdit(value: unknown): value is Record<string, unknown> {
        if (!this.isPlainObject(value)) {
            return false;
        }
        return typeof value.text === 'string' && this.isPlainObject(value.range);
    }

    private readRange(value: unknown): vscode.Range {
        if (!this.isPlainObject(value)
            || !this.isPlainObject(value.start)
            || !this.isPlainObject(value.end)
            || typeof value.start.line !== 'number'
            || typeof value.start.character !== 'number'
            || typeof value.end.line !== 'number'
            || typeof value.end.character !== 'number') {
            throw new Error('range 格式不正确。');
        }

        return new vscode.Range(
            new vscode.Position(value.start.line, value.start.character),
            new vscode.Position(value.end.line, value.end.character)
        );
    }

    private isCommandAllowed(command: string): boolean {
        if (this.deniedCommandPrefixes.some(prefix => command.startsWith(prefix))) {
            return false;
        }

        const config = vscode.workspace.getConfiguration('deepseek');
        const extraAllowed = new Set<string>(config.get<string[]>('allowedCommands', []));
        return this.builtInAllowedCommands.has(command) || extraAllowed.has(command);
    }

    private serialize(value: unknown, depth = 0): unknown {
        if (depth > 4) {
            return '[MaxDepth]';
        }

        if (value === null || value === undefined) {
            return value;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }

        if (value instanceof Uint8Array) {
            return Array.from(value);
        }

        if (value instanceof vscode.Uri) {
            return value.toString();
        }

        if (value instanceof vscode.Position) {
            return {
                line: value.line,
                character: value.character,
            };
        }

        if (value instanceof vscode.Range) {
            return this.rangeToObject(value);
        }

        if (Array.isArray(value)) {
            return value.map(item => this.serialize(item, depth + 1));
        }

        if (typeof value === 'object') {
            const output: Record<string, unknown> = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                output[key] = this.serialize(nestedValue, depth + 1);
            }
            return output;
        }

        return String(value);
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
