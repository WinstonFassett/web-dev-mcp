import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, truncateSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const VERSION = '0.1.0';
export function computeSessionId(target) {
    return createHash('sha256').update(target).digest('hex').slice(0, 6);
}
export function getLogDir(target, options) {
    if (options.logDir)
        return options.logDir;
    // Default to .web-dev-mcp/ in current directory instead of /tmp to avoid permissions issues
    return join(process.cwd(), '.web-dev-mcp');
}
export function initSession(options, serverUrl, mcpPath) {
    const target = options.target;
    const sessionId = computeSessionId(target);
    const logDir = getLogDir(target, options);
    const mcpUrl = `${serverUrl}${mcpPath}/sse`;
    mkdirSync(logDir, { recursive: true });
    const channels = ['console', 'errors', 'dev-events'];
    if (options.network)
        channels.push('network');
    const files = {};
    for (const ch of channels) {
        files[ch] = join(logDir, `${ch}.ndjson`);
    }
    // Truncate all NDJSON files on session start
    for (const filePath of Object.values(files)) {
        writeFileSync(filePath, '');
    }
    const info = {
        sessionId,
        logDir,
        files,
        channels,
        serverUrl,
        mcpUrl,
        targetUrl: target,
        startedAt: Date.now(),
    };
    writeFileSync(join(logDir, 'session.json'), JSON.stringify(info, null, 2) + '\n');
    return { info, logDir, files, channels, startedAt: info.startedAt, checkpointTs: null };
}
export function truncateChannelFiles(files, channels) {
    const countsBefore = {};
    const toTruncate = channels ?? Object.keys(files);
    for (const ch of toTruncate) {
        const filePath = files[ch];
        if (!filePath)
            continue;
        if (existsSync(filePath)) {
            const content = readFileSync(filePath, 'utf-8');
            countsBefore[ch] = content.trim() ? content.trim().split('\n').length : 0;
            truncateSync(filePath, 0);
        }
        else {
            countsBefore[ch] = 0;
            writeFileSync(filePath, '');
        }
    }
    return countsBefore;
}
//# sourceMappingURL=session.js.map