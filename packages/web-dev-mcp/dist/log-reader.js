import { readFileSync, existsSync } from 'node:fs';
export function queryLogs(files, query) {
    const filePath = files[query.channel];
    if (!filePath || !existsSync(filePath)) {
        return { events: [], total: 0, returned: 0, next_cursor: 0 };
    }
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim()) {
        return { events: [], total: 0, returned: 0, next_cursor: 0 };
    }
    const lines = content.trim().split('\n');
    const total = lines.length;
    const limit = Math.min(query.limit ?? 50, 200);
    const sinceId = query.sinceId ?? 0;
    const events = [];
    for (const line of lines) {
        if (!line.trim())
            continue;
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (event.id <= sinceId)
            continue;
        if (query.level) {
            const payload = event.payload;
            if (payload.level && payload.level !== query.level)
                continue;
            if (payload.type && payload.type !== query.level)
                continue;
        }
        if (query.search) {
            const serialized = JSON.stringify(event.payload);
            if (!serialized.toLowerCase().includes(query.search.toLowerCase()))
                continue;
        }
        events.push(event);
        if (events.length >= limit)
            break;
    }
    const lastEvent = events[events.length - 1];
    return {
        events,
        total,
        returned: events.length,
        next_cursor: lastEvent ? lastEvent.id : sinceId,
    };
}
export function getDiagnostics(files, session, query, devEventsWriter) {
    const since_ts = query.since_checkpoint && session.checkpointTs
        ? session.checkpointTs
        : query.since_ts;
    const consoleResult = queryLogs(files, {
        channel: 'console',
        sinceId: since_ts ? findFirstIdAfterTs(files.console, since_ts) : 0,
        limit: query.limit,
        level: query.level,
        search: query.search
    });
    const errorsResult = queryLogs(files, {
        channel: 'errors',
        sinceId: since_ts ? findFirstIdAfterTs(files.errors, since_ts) : 0,
        limit: query.limit,
        level: query.level,
        search: query.search
    });
    const networkResult = queryLogs(files, {
        channel: 'network',
        sinceId: since_ts ? findFirstIdAfterTs(files.network, since_ts) : 0,
        limit: query.limit,
        search: query.search
    });
    const summary = {
        error_count: 0,
        warning_count: 0,
        failed_requests: 0,
        has_unhandled_rejections: false
    };
    for (const event of consoleResult.events) {
        const payload = event.payload;
        if (payload.level === 'error')
            summary.error_count++;
        if (payload.level === 'warn')
            summary.warning_count++;
    }
    for (const event of errorsResult.events) {
        const payload = event.payload;
        summary.error_count++;
        if (payload.type === 'unhandled-rejection') {
            summary.has_unhandled_rejections = true;
        }
    }
    for (const event of networkResult.events) {
        const payload = event.payload;
        if (payload.status >= 400) {
            summary.failed_requests++;
        }
    }
    const buildStatus = devEventsWriter
        ? devEventsWriter.getStatus(since_ts)
        : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false };
    return {
        build: buildStatus,
        logs: {
            console: consoleResult.events,
            errors: errorsResult.events,
            network: networkResult.events
        },
        summary,
        checkpoint_ts: session.checkpointTs
    };
}
function findFirstIdAfterTs(filePath, ts) {
    if (!filePath || !existsSync(filePath))
        return 0;
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim())
        return 0;
    const lines = content.trim().split('\n');
    for (const line of lines) {
        if (!line.trim())
            continue;
        try {
            const event = JSON.parse(line);
            if (event.ts > ts)
                return event.id - 1;
        }
        catch {
            continue;
        }
    }
    return 0;
}
//# sourceMappingURL=log-reader.js.map