// Loaded with a dynamic import by the console page only: xterm.js is most of
// the console's weight and no other screen needs it.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface ConsoleTerminal {
    terminal: Terminal;
    fit(): void;
    dispose(): void;
}

export function createTerminal(host: HTMLElement): ConsoleTerminal {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
    const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, 'Ubuntu Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
        fontSize: 14,
        lineHeight: 1.15,
        scrollback: 5000,
        theme: {
            background: token('--c-bg', '#000000'),
            foreground: token('--c-text', '#f2f2f2'),
            cursor: token('--c-accent', '#38b0d3'),
            cursorAccent: token('--c-bg', '#000000'),
            selectionBackground: 'rgba(56, 176, 211, 0.35)',
        },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    return {
        terminal,
        fit: () => fitAddon.fit(),
        dispose: () => terminal.dispose(),
    };
}
