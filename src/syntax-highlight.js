/**
 * Lightweight syntax highlighting for terminal output using kleur.
 * Zero external dependencies — uses only kleur primitives.
 * Supports: JavaScript/TypeScript, Python, JSON, HTML/CSS, Bash, Markdown.
 */

import kleur from 'kleur';

// ─── Colour palette for syntax tokens ───────────────────────────────────────

const C = {
  keyword:  kleur.cyan,     // if, else, return, const, let, var, function, class, import, export, from, async, await
  string:   kleur.green,    // double-quoted and single-quoted strings
  number:   kleur.magenta,  // numeric literals
  comment:  kleur.gray,     // single-line and block comments
  func:     kleur.yellow,   // function names, method calls
  prop:     kleur.blue,     // object properties, keys
  operator: kleur.red,     // operators: = + - * / < > ! & | ^ ? :
  punct:    kleur.white,    // punctuation: ( ) { } [ ] ; , .
  bool:     kleur.magenta,  // true, false, null, undefined
  type:     kleur.cyan,     // TypeScript types, class names
  tag:      kleur.red,      // HTML/JSX tags
  attr:     kleur.yellow,   // HTML attributes
  url:      kleur.underline().cyan,  // URLs
};

// ─── Language detection ───────────────────────────────────────────────────────

const LANG_RE = /^(```|~~~)\s*(\w*)/;

function detectLang(lang) {
  if (!lang) return 'text';
  const l = lang.toLowerCase();
  if (l === 'js' || l === 'jsx' || l === 'ts' || l === 'tsx') return 'js';
  if (l === 'py' || l === 'python') return 'py';
  if (l === 'sh' || l === 'bash' || l === 'shell' || l === 'zsh') return 'sh';
  if (l === 'html' || l === 'xml' || l === 'svg') return 'html';
  if (l === 'css' || l === 'scss' || l === 'less') return 'css';
  if (l === 'json' || l === 'jsonc') return 'json';
  if (l === 'md' || l === 'markdown') return 'md';
  if (l === 'yaml' || l === 'yml') return 'yaml';
  if (l === 'rust' || l === 'rs') return 'rust';
  if (l === 'go') return 'go';
  if (l === 'sql') return 'sql';
  return 'text';
}

// ─── Escaping ─────────────────────────────────────────────────────────────────

function esc(str) {
  return str.replace(/[\x1b\[\d;]/g, ''); // strip ANSI before measuring width
}

// ─── Core tokenizer ───────────────────────────────────────────────────────────

/**
 * Tokenise a line of code into typed spans for coloured rendering.
 * Returns an array of { text, type } objects.
 */
export function tokeniseLine(line, lang) {
  if (lang === 'json') return tokeniseJSON(line);
  if (lang === 'html' || lang === 'css') return tokeniseHTML(line, lang);
  if (lang === 'py') return tokenisePython(line);
  if (lang === 'sh') return tokeniseShell(line);
  if (lang === 'md') return tokeniseMarkdown(line);
  return tokeniseGeneric(line);
}

function token(span, type) {
  return { text: span, type };
}

// ─── Generic JS/TS tokeniser ───────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  'if', 'else', 'return', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'const', 'let', 'var', 'function', 'class', 'extends', 'new', 'this', 'super',
  'import', 'export', 'from', 'default', 'as', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield',
  'static', 'get', 'set', 'of', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'enum', 'interface', 'type', 'namespace', 'module', 'declare', 'abstract', 'implements',
]);

const JS_BUILTINS = new Set([
  'console', 'process', 'require', 'module', 'exports', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'Promise', 'fetch', 'Buffer', 'Math', 'JSON', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'Date', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
]);

function tokeniseGeneric(line) {
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Single-line comment
    if (src[i] === '/' && src[i + 1] === '/') {
      spans.push(token(src.slice(i), 'comment'));
      break;
    }

    // Block comment start (inline only, no state machine)
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end !== -1) {
        spans.push(token(src.slice(i, end + 2), 'comment'));
        i = end + 2;
        continue;
      }
    }

    // String: double or single quote
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i];
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) i += 2;
        else i++;
      }
      if (i < src.length) i++; // include closing quote
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Number
    if (/[0-9]/.test(src[i]) && (i === 0 || /\W/.test(src[i - 1]))) {
      const start = i;
      while (i < src.length && /[0-9.xXa-fA-FeE_]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'number'));
      continue;
    }

    // Word (keyword, builtin, identifier)
    if (/[a-zA-Z_$]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) i++;
      const word = src.slice(start, i);

      if (JS_KEYWORDS.has(word)) {
        spans.push(token(word, 'keyword'));
      } else if (JS_BUILTINS.has(word)) {
        spans.push(token(word, 'func'));
      } else if (i < src.length && src[i] === '(') {
        spans.push(token(word, 'func'));
      } else {
        // Check for dot-accessed property
        const next = src.slice(i).match(/^\s*(\.\s*[a-zA-Z_$][a-zA-Z0-9_$]*)+/);
        if (next) {
          spans.push(token(word, 'type'));
        } else {
          spans.push(token(word, 'default'));
        }
      }
      continue;
    }

    // Operators and punctuation
    if (/[=+\-*/%<>!&|^~?:]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[=+\-*/%<>!&|^~?:]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'operator'));
      continue;
    }

    // Whitespace and other
    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    // Punctuation
    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── Python tokeniser ─────────────────────────────────────────────────────────

const PY_KEYWORDS = new Set([
  'if', 'elif', 'else', 'return', 'for', 'while', 'break', 'continue',
  'def', 'class', 'lambda', 'with', 'as', 'import', 'from', 'try', 'except',
  'finally', 'raise', 'pass', 'yield', 'async', 'await', 'True', 'False', 'None',
  'and', 'or', 'not', 'in', 'is', 'global', 'nonlocal', 'assert', 'del',
]);

function tokenisePython(line) {
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Comment
    if (src[i] === '#') {
      spans.push(token(src.slice(i), 'comment'));
      break;
    }

    // String: triple-quote or double/single quote
    if ((src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"') ||
        (src[i] === "'" && src[i + 1] === "'" && src[i + 2] === "'")) {
      const start = i;
      const tq = src[i] + src[i + 1] + src[i + 2];
      i += 3;
      while (i < src.length - 2) {
        if (src[i] === '\\' && i + 1 < src.length) { i += 2; continue; }
        if (src.slice(i, i + 3) === tq) { i += 3; break; }
        i++;
      }
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) i += 2;
        else i++;
      }
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Number
    if (/[0-9]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[0-9.xXa-fA-FeE_]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'number'));
      continue;
    }

    // Word
    if (/[a-zA-Z_]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (PY_KEYWORDS.has(word)) {
        spans.push(token(word, 'keyword'));
      } else if (i < src.length && src[i] === '(') {
        spans.push(token(word, 'func'));
      } else {
        spans.push(token(word, word[0] === word[0].toUpperCase() ? 'type' : 'default'));
      }
      continue;
    }

    // Operators
    if (/[=+\-*/%<>!&|^~?:]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[=+\-*/%<>!&|^~?:]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'operator'));
      continue;
    }

    // Whitespace
    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── JSON tokeniser ───────────────────────────────────────────────────────────

function tokeniseJSON(line) {
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // String
    if (src[i] === '"') {
      const start = i;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) i += 2;
        else i++;
      }
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Number
    if (/[-0-9]/.test(src[i])) {
      const start = i;
      if (src[i] === '-') i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (i < src.length && src[i] === '.') { i++; while (i < src.length && /[0-9]/.test(src[i])) i++; }
      if (i < src.length && /[eE]/.test(src[i])) { i++; if (src[i] === '+' || src[i] === '-') i++; while (i < src.length && /[0-9]/.test(src[i])) i++; }
      spans.push(token(src.slice(start, i), 'number'));
      continue;
    }

    // Keyword
    if (src[i] === 't' && src.slice(i, i + 4) === 'true') { spans.push(token('true', 'bool')); i += 4; continue; }
    if (src[i] === 'f' && src.slice(i, i + 5) === 'false') { spans.push(token('false', 'bool')); i += 5; continue; }
    if (src[i] === 'n' && src.slice(i, i + 4) === 'null') { spans.push(token('null', 'bool')); i += 4; continue; }

    // Operator
    if (src[i] === ':' || src[i] === ',') { spans.push(token(src[i], 'operator')); i++; continue; }

    // Whitespace
    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── HTML/CSS tokeniser ───────────────────────────────────────────────────────

function tokeniseHTML(line, lang) {
  if (lang === 'css') return tokeniseCSS(line);

  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Tag
    if (src[i] === '<' && i + 1 < src.length && /[a-zA-Z!/]/.test(src[i + 1])) {
      const start = i;
      while (i < src.length && src[i] !== '>') i++;
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'tag'));
      continue;
    }

    // String
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\' && i + 1 < src.length) i += 2; else i++; }
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Word
    if (/[a-zA-Z0-9_-]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_:-]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'default'));
      continue;
    }

    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

function tokeniseCSS(line) {
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Comment
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      spans.push(token(src.slice(i, end !== -1 ? end + 2 : src.length), 'comment'));
      i = end !== -1 ? end + 2 : src.length;
      continue;
    }

    // String
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\' && i + 1 < src.length) i += 2; else i++; }
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Number with unit
    if (/[0-9]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      while (i < src.length && /[a-zA-Z%pxemk]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'number'));
      continue;
    }

    // Property name
    if (/[a-zA-Z-]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9-_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (i < src.length && src[i] === ':') {
        spans.push(token(word, 'prop'));
      } else {
        spans.push(token(word, 'default'));
      }
      continue;
    }

    if (/[=+\-*/%<>!&|^~?:.#]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[=+\-*/%<>!&|^~?:.#]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'operator'));
      continue;
    }

    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── Shell/Bash tokeniser ─────────────────────────────────────────────────────

const SH_COMMANDS = new Set([
  'ls', 'cd', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'echo', 'grep', 'find',
  'git', 'npm', 'node', 'bun', 'python', 'pip', 'curl', 'wget', 'chmod', 'chown',
  'ssh', 'scp', 'rsync', 'docker', 'kubectl', 'apt', 'yum', 'brew', 'cargo',
  'go', 'rustc', 'make', 'cmake', 'jq', 'awk', 'sed', 'cut', 'sort', 'uniq',
  'head', 'tail', 'less', 'more', 'vim', 'nano', 'nano', 'tar', 'zip', 'unzip',
]);

function tokeniseShell(line) {
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Comment
    if (src[i] === '#') {
      spans.push(token(src.slice(i), 'comment'));
      break;
    }

    // String
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\' && i + 1 < src.length) i += 2; else i++; }
      if (i < src.length) i++;
      spans.push(token(src.slice(start, i), 'string'));
      continue;
    }

    // Variable: $VAR or ${VAR}
    if (src[i] === '$') {
      const start = i;
      if (src[i + 1] === '{') {
        i += 2;
        while (i < src.length && src[i] !== '}') i++;
        if (i < src.length) i++;
        spans.push(token(src.slice(start, i), 'func'));
      } else if (/[a-zA-Z_]/.test(src[i + 1])) {
        i++;
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) i++;
        spans.push(token(src.slice(start, i), 'func'));
      } else {
        i++;
        spans.push(token(src[i - 1], 'operator'));
      }
      continue;
    }

    // Word
    if (/[a-zA-Z0-9_/.-]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_/.-]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (SH_COMMANDS.has(word)) {
        spans.push(token(word, 'func'));
      } else if (i < src.length && src[i] === '=') {
        spans.push(token(word, 'prop'));
      } else {
        spans.push(token(word, 'default'));
      }
      continue;
    }

    // Operator
    if (/[=+\-*/%<>!&|^~?|;]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[=+\-*/%<>!&|^~?|;]/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'operator'));
      continue;
    }

    if (/\s/.test(src[i])) {
      const start = i;
      while (i < src.length && /\s/.test(src[i])) i++;
      spans.push(token(src.slice(start, i), 'whitespace'));
      continue;
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── Markdown line tokeniser ───────────────────────────────────────────────────

function tokeniseMarkdown(line) {
  // Code spans inside markdown
  const spans = [];
  let i = 0;
  const src = line;

  while (i < src.length) {
    // Inline code
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end !== -1) {
        spans.push(token(src.slice(i, end + 1), 'comment'));
        i = end + 1;
        continue;
      }
    }

    // Bold/italic markers
    if (src.slice(i, i + 3) === '**' || src.slice(i, i + 3) === '___') {
      spans.push(token(src[i] + src[i + 1], 'keyword'));
      i += 2;
      continue;
    }
    if (src[i] === '*' || src[i] === '_') {
      spans.push(token(src[i], 'keyword'));
      i++;
      continue;
    }

    // Link [text](url)
    if (src[i] === '[') {
      const close = src.indexOf(']', i);
      const paren = close !== -1 ? src.indexOf('(', close + 1) : -1;
      if (close !== -1 && paren !== -1 && src[paren + 1]) {
        spans.push(token(src.slice(i, paren + 1), 'default'));
        i = paren + 1;
        const close2 = src.indexOf(')', i);
        if (close2 !== -1) {
          spans.push(token(src[i - 1] + src.slice(i, close2 + 1), 'url'));
          i = close2 + 1;
          continue;
        }
      }
    }

    spans.push(token(src[i], 'punct'));
    i++;
  }

  return spans;
}

// ─── Apply colour to token type ────────────────────────────────────────────────

const TYPE_STYLE = {
  keyword:  C.keyword,
  string:   C.string,
  number:   C.number,
  comment:  C.comment,
  func:     C.func,
  prop:     C.prop,
  operator: C.operator,
  punct:    C.punct,
  bool:     C.bool,
  type:     C.type,
  tag:      C.tag,
  attr:     C.attr,
  url:      C.url,
  default:  (s) => s,
  whitespace: (s) => s,
};

function applyStyle(spans) {
  return spans.map(({ text, type }) => {
    const style = TYPE_STYLE[type] ?? TYPE_STYLE.default;
    return typeof style === 'function' ? style(text) : text;
  }).join('');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Highlight a single code line, returning coloured string.
 */
export function highlightLine(line, lang = 'text') {
  return applyStyle(tokeniseLine(line, lang));
}

/**
 * Highlight multiple code lines, returning array of coloured strings.
 */
export function highlightLines(lines, lang = 'text') {
  return lines.map(line => highlightLine(line, lang));
}

/**
 * Full code block highlight with surrounding fences and lang label.
 * Returns the full rendered string (without trailing newline).
 */
export function highlightBlock(rawBlock, lang) {
  const detected = detectLang(lang);
  const lines = rawBlock.split('\n');
  const renderedLines = lines.map(line => highlightLine(line, detected));
  return renderedLines.join('\n');
}