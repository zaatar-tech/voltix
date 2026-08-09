// Small offline TS/TSX highlighter for the self-authored snippets on this site.
// Single left-to-right pass over ordered alternatives, so a match is emitted once
// and never re-scanned (avoids the double-substitution bugs of chained replaces).
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
  'new', 'async', 'await', 'if', 'else', 'for', 'of', 'in', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'interface', 'type', 'enum', 'class', 'extends', 'implements', 'this', 'super', 'void',
  'as', 'yield', 'delete', 'keyof', 'readonly',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

// Order matters: comments and strings first so their contents aren't re-tokenized.
const TOKEN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 comment
    '(`(?:\\\\.|\\$\\{[^}]*\\}|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")', // 2 string
    '(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)', // 3 number
    '([A-Za-z_$][\\w$]*)', // 4 identifier (classified below)
  ].join('|'),
  'g',
);

export function hl(code: string): string {
  let out = '';
  let last = 0;
  for (let m = TOKEN.exec(code); m; m = TOKEN.exec(code)) {
    out += esc(code.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      out += `<span class="tok-c">${esc(m[1])}</span>`;
    } else if (m[2]) {
      out += `<span class="tok-s">${esc(m[2])}</span>`;
    } else if (m[3]) {
      out += `<span class="tok-n">${esc(m[3])}</span>`;
    } else {
      const word = m[4];
      const after = code[last];
      if (KEYWORDS.has(word)) out += `<span class="tok-k">${word}</span>`;
      else if (LITERALS.has(word)) out += `<span class="tok-n">${word}</span>`;
      else if (/[A-Z]/.test(word[0])) out += `<span class="tok-t">${esc(word)}</span>`;
      else if (after === '(') out += `<span class="tok-f">${esc(word)}</span>`;
      else out += esc(word);
    }
  }
  out += esc(code.slice(last));
  return out;
}
