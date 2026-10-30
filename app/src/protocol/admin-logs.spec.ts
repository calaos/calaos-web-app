import { describe, expect, it } from 'vitest';
import {
    LOG_SOURCE_IDS,
    logEntryLine,
    logQueryParams,
    logQueryProblem,
    logsFileName,
    logsText,
    priorityName,
    toLogPage,
    toLogSources,
} from './admin-logs';

describe('logs codec', () => {
    it('reads the sources, dropping entries without an id', () => {
        expect(toLogSources({ sources: [{ id: 'kernel', label: 'Kernel' }, { label: 'x' }] })).toEqual([
            { id: 'kernel', label: 'Kernel' },
        ]);
        expect(LOG_SOURCE_IDS).toHaveLength(16);
    });

    it('reads a page with its typed fields', () => {
        const page = toLogPage({
            entries: [
                { cursor: 's=1', ts: '2026-10-25T08:12:03.412Z', source: 'calaos-server', unit: 'calaos-server.service', priority: 4, pid: 812, message: 'cn_pass=***' },
                { cursor: 's=2', ts: '2026-10-25T08:12:04.000Z', source: 'kernel', unit: 'kernel', priority: 6, message: 'x', cut: true },
            ],
            truncated: false,
            complete: false,
            next_cursor: 's=2',
        });
        expect(page.entries[0]).toEqual({
            cursor: 's=1',
            ts: '2026-10-25T08:12:03.412Z',
            source: 'calaos-server',
            unit: 'calaos-server.service',
            priority: 4,
            pid: 812,
            message: 'cn_pass=***',
            cut: false,
        });
        expect(page.entries[1]).toMatchObject({ pid: null, cut: true });
        expect(page).toMatchObject({ truncated: false, complete: false, nextCursor: 's=2' });
    });

    it('reads a null next_cursor and survives garbage', () => {
        expect(toLogPage({ entries: [], next_cursor: null }).nextCursor).toBeNull();
        expect(toLogPage('x')).toEqual({ entries: [], truncated: false, complete: true, nextCursor: null });
        expect(toLogPage({ entries: [{ priority: 42 }] }).entries[0].priority).toBe(6);
    });

    it('builds params with JSON types and without empty fields', () => {
        expect(
            logQueryParams({ sources: ['kernel', 'ssh'], priority: 3, lines: 50, text: '', cursor: 'c', direction: 'forward' }),
        ).toEqual({ sources: ['kernel', 'ssh'], priority: 3, lines: 50, cursor: 'c', direction: 'forward' });
        expect(logQueryParams({ priority: 'warning', since: '2026-10-25T08:00:00Z' })).toEqual({
            priority: 'warning',
            since: '2026-10-25T08:00:00Z',
        });
        expect(logQueryParams({})).toEqual({});
    });

    it('flags what calaos_server refuses', () => {
        expect(logQueryProblem({})).toBe('');
        expect(logQueryProblem({ sources: Array(9).fill('kernel') })).toBe('sources');
        expect(logQueryProblem({ sources: ['nginx'] })).toBe('sources');
        expect(logQueryProblem({ priority: 8 })).toBe('priority');
        expect(logQueryProblem({ text: 'x'.repeat(257) })).toBe('text');
        expect(logQueryProblem({ lines: 0 })).toBe('lines');
        expect(logQueryProblem({ cursor: 'é' })).toBe('cursor');
        expect(logQueryProblem({ since: '2026-10-25T09:00:00Z', until: '2026-10-25T08:00:00Z' })).toBe('since');
        expect(logQueryProblem({ direction: 'forward' })).toBe('direction');
        expect(logQueryProblem({ direction: 'forward', cursor: 'c' })).toBe('');
    });

    it('names priorities', () => {
        expect(priorityName(0)).toBe('emerg');
        expect(priorityName(4)).toBe('warning');
        expect(priorityName(9)).toBe('debug');
    });

    it('writes the shown rows as text, one per entry', () => {
        const page = toLogPage({
            entries: [
                { cursor: 'a', ts: '2026-10-25T08:12:03.412Z', source: 'calaos-server', unit: 'u', priority: 3, pid: 812, message: 'one\ntwo' },
                { cursor: 'b', ts: '2026-10-25T08:12:04.000Z', source: 'kernel', unit: 'kernel', priority: 6, message: 'x', cut: true },
            ],
        });
        expect(logEntryLine(page.entries[0])).toBe('2026-10-25T08:12:03.412Z calaos-server[812] err: one\n    two');
        expect(logsText(page.entries)).toBe(
            '2026-10-25T08:12:03.412Z calaos-server[812] err: one\n    two\n2026-10-25T08:12:04.000Z kernel info: x […]\n',
        );
        expect(logsText([])).toBe('');
        expect(logsFileName(new Date(2026, 9, 5, 7, 3))).toBe('calaos-logs-20261005-0703.txt');
    });
});
