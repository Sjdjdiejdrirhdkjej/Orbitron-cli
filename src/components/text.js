export function truncate(text, width) {
  const str = String(text ?? '');
  if (width <= 0) return '';
  return str.length > width ? str.slice(0, Math.max(0, width - 1)) + '…' : str;
}

export function repeat(ch, count) {
  return count > 0 ? ch.repeat(count) : '';
}

export function pad(text, width) {
  const clean = truncate(text, width);
  return clean + repeat(' ', Math.max(0, width - clean.length));
}

export function wrapText(text, width) {
  const plain = String(text ?? '');
  if (width <= 1) return [plain];
  return plain.split(/\r?\n/).flatMap((line) => {
    if (!line.length) return [''];
    const chunks = [];
    let rest = line;
    while (rest.length > width) {
      chunks.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (rest) chunks.push(rest);
    return chunks;
  });
}

/**
 * Detect language from file extension.
 * Returns a short language key used by colourLine.
 */
export function langFromExt(ext) {
  const map = {
    js: 'js', ts: 'js', jsx: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', pyw: 'py',
    json: 'json', jsonc: 'json',
    html: 'html', htm: 'html',
    css: 'css', scss: 'css', less: 'css',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    md: 'md', markdown: 'md',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php',
    txt: 'text', text: 'text',
  };
  return map[ext?.toLowerCase()] ?? 'text';
}

/**
 * Colourise a single line of code based on language key.
 * Zero-dependency — uses only kleur primitives.
 */
export function colourLine(line, lang) {
  if (lang === 'py') {
    return line
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/#.*/, (m) => kleur.gray(m))
      .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|raise|pass|break|continue|and|or|not|in|is|lambda|yield|global|nonlocal|True|False|None|async|await)\b/g, (m) => kleur.cyan(m));
  }
  if (lang === 'js' || lang === 'ts') {
    return line
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/`[^`]*`/g, (m) => kleur.green(m))
      .replace(/\/\/.*/, (m) => kleur.gray(m))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => kleur.gray(m))
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|switch|case|default|break|continue|void|delete|in|of|null|undefined|true|false|interface|type|enum|implements|extends|static|readonly|abstract|private|public|protected)\b/g, (m) => kleur.cyan(m));
  }
  if (lang === 'json') {
    return line
      .replace(/"([^"]+)":?/g, (_, k) => kleur.yellow(`"${k}"`) + (line.includes(':') ? kleur.gray(':') : ''))
      .replace(/\b(true|false|null)\b/g, (m) => kleur.magenta(m))
      .replace(/\b\d+(\.\d+)?([eE][+-]?\d+)?\b/g, (m) => kleur.magenta(m));
  }
  if (lang === 'html') {
    return line
      .replace(/<\/?[\w\-]+/g, (m) => kleur.cyan(m))
      .replace(/>[^<]*/g, (m) => kleur.gray(m))
      .replace(/\s([\w\-]+)=/g, (_, a) => ` ${kleur.yellow(a)}=`)
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m));
  }
  if (lang === 'css') {
    return line
      .replace(/[.#][\w\-]+/g, (m) => kleur.cyan(m))
      .replace(/[\w\-]+:(?!\s)/g, (m) => kleur.yellow(m))
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => kleur.gray(m));
  }
  if (lang === 'sh') {
    return line
      .replace(/#.*/, (m) => kleur.gray(m))
      .replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|source|alias|echo|read|local|readonly|declare|shift|set|unset|test)\b/g, (m) => kleur.cyan(m))
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m));
  }
  if (lang === 'md') {
    return line
      .replace(/#{1,6}\s.*/, (m) => kleur.cyan().bold(m))
      .replace(/```[\w]*\s*/, (m) => kleur.cyan(m))
      .replace(/\*\*[^*]+\*\*/g, (m) => kleur.bold(m))
      .replace(/\*[^*]+\*/g, (m) => kleur.italic(m))
      .replace(/`[^`]+`/g, (m) => kleur.bgBlack().white(m))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, (_, t) => kleur.underline().cyan(t));
  }
  if (lang === 'yaml') {
    return line
      .replace(/^(\s*)(\S[\w\-]*):/, (_, indent, k) => `${indent}${kleur.yellow(k)}:`)
      .replace(/: \s*(".*?"|'.*?')/g, (_, v) => `: ${kleur.green(v)}`)
      .replace(/#.*/, (m) => kleur.gray(m));
  }
  return line;
}