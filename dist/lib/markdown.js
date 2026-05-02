"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATEX_TOKEN_COLORS = exports.TOKEN_COLORS = void 0;
exports.tokenizeCode = tokenizeCode;
exports.parseMarkdown = parseMarkdown;
exports.getSegmentFg = getSegmentFg;
exports.getSegmentAttrs = getSegmentAttrs;
exports.getLangColor = getLangColor;
exports.truncateText = truncateText;
exports.getTokenFg = getTokenFg;
exports.renderLatex = renderLatex;
exports.getLatexTokenFg = getLatexTokenFg;
exports.getLatexBg = getLatexBg;
exports.getLatexFg = getLatexFg;
const CODE_LANG_COLORS = {
    js: "#f7df1e", ts: "#3178c6", javascript: "#f7df1e", typescript: "#3178c6",
    python: "#3572A5", py: "#3572A5", rust: "#dea584", go: "#00ADD8",
    bash: "#4EAA25", sh: "#4EAA25", shell: "#4EAA25", json: "#292929",
    html: "#e34c26", css: "#563d7c", sql: "#e38c00", yaml: "#cb171e",
    xml: "#0060ac", dockerfile: "#384d54",
};
function isBlank(s) {
    return s === undefined || s === null || s === "";
}
const KEYWORDS = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "switch", "case", "break", "continue", "new", "typeof", "instanceof", "this",
    "class", "extends", "super", "import", "export", "default", "from", "async",
    "await", "try", "catch", "finally", "throw", "void", "null", "undefined",
    "true", "false", "in", "of", "yield", "static", "get", "set", "public",
    "private", "protected", "readonly", "abstract", "declare", "namespace",
    "interface", "type", "enum", "implements", "constructor", "where", "as",
    "fn", "pub", "impl", "mod", "struct", "trait", "use", "match", "loop",
    "ref", "mut", "move", "box", "self", "Self", "Some", "None", "Ok", "Err",
]);
const TYPES = new Set([
    "string", "number", "boolean", "object", "Array", "Promise", "void", "any",
    "unknown", "never", "null", "undefined", "symbol", "bigint", "function",
    "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128",
    "f32", "f64", "usize", "isize", "str", "bool", "char", "Vec", "Option",
    "Result", "HashMap", "HashSet", "String",
]);
const PY_KW = new Set([
    "print", "len", "range", "str", "int", "float", "list", "dict", "set",
    "tuple", "True", "False", "None", "self", "def", "lambda", "pass",
    "with", "as", "assert", "del", "elif", "except", "global", "is",
    "nonlocal", "raise", "from", "class", "yield", "async", "await", "and",
    "or", "not", "for", "while", "break", "continue", "if", "else", "try",
    "finally", "open", "input", "map", "filter", "zip", "enumerate", "sorted",
]);
const BUILTINS = new Set([
    "console", "process", "require", "module", "exports", "JSON", "Math",
    "Date", "Object", "Array", "Map", "Set", "Error", "Promise", "fetch",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Buffer",
]);
function tokenize(code, lang) {
    const tokens = [];
    let i = 0;
    const src = code;
    while (i < src.length) {
        if ((lang === "js" || lang === "ts") && src[i] === "/" && src[i + 1] === "/") {
            let j = i;
            while (j < src.length && src[j] !== "\n")
                j++;
            tokens.push({ type: "comment", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if ((lang === "js" || lang === "ts") && src[i] === "/" && src[i + 1] === "*") {
            let j = i + 2;
            while (j + 1 < src.length && !(src[j] === "*" && src[j + 1] === "/"))
                j++;
            j += 2;
            tokens.push({ type: "comment", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if ((lang === "python" || lang === "bash" || lang === "rust" || lang === "sql") && src[i] === "#") {
            let j = i;
            while (j < src.length && src[j] !== "\n")
                j++;
            tokens.push({ type: "comment", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
            const q = src[i];
            let j = i + 1;
            while (j < src.length) {
                if (src[j] === "\\" && j + 1 < src.length) {
                    j += 2;
                    continue;
                }
                if (src[j] === q) {
                    j++;
                    break;
                }
                if (src[j] === "\n" && q !== "`")
                    break;
                j++;
            }
            tokens.push({ type: "string", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if (/[0-9]/.test(src[i]) && (i === 0 || !/[a-zA-Z_]/.test(src[i - 1]))) {
            let j = i;
            while (j < src.length && /[0-9.xXa-fA-FuUlL_]/.test(src[j]))
                j++;
            tokens.push({ type: "number", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if (/[a-zA-Z_$]/.test(src[i])) {
            let j = i;
            while (j < src.length && /[a-zA-Z0-9_$]/.test(src[j]))
                j++;
            const word = src.slice(i, j);
            const next = src[j];
            const isFn = next === "(";
            let type = "plain";
            if (KEYWORDS.has(word))
                type = "keyword";
            else if (lang === "python" && PY_KW.has(word))
                type = "keyword";
            else if (TYPES.has(word) || (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()))
                type = "type";
            else if (BUILTINS.has(word) && isFn)
                type = "function";
            else if (isFn)
                type = "function";
            tokens.push({ type, value: word });
            i = j;
            continue;
        }
        if (/[+\-*/%=<>!&|^~?:]/.test(src[i])) {
            let j = i;
            while (j < src.length && /[+\-*/%=<>!&|^~?:]/.test(src[j]))
                j++;
            tokens.push({ type: "operator", value: src.slice(i, j) });
            i = j;
            continue;
        }
        if (/[{}[\]().,;@#]/.test(src[i])) {
            tokens.push({ type: "punctuation", value: src[i] });
            i++;
            continue;
        }
        tokens.push({ type: "plain", value: src[i] });
        i++;
    }
    return tokens;
}
function langFromString(lang) {
    const l = lang.toLowerCase();
    if (/^(js|javascript)$/.test(l))
        return "js";
    if (/^(ts|typescript)$/.test(l))
        return "ts";
    if (/^python$/i.test(l) || l === "py")
        return "python";
    if (/^bash|shell|sh$/.test(l))
        return "bash";
    if (/^go|golang$/i.test(l))
        return "go";
    if (/^rust$/i.test(l))
        return "rust";
    if (/^sql$/i.test(l))
        return "sql";
    if (/^yaml$/i.test(l))
        return "yaml";
    if (/^json$/i.test(l))
        return "json";
    if (/^html$/i.test(l))
        return "html";
    if (/^css$/i.test(l))
        return "css";
    return "plain";
}
function tokenizeCode(code, lang) {
    return tokenize(code, langFromString(lang));
}
// Decode HTML entities
function decodeHtmlEntities(text) {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}
// Markdown parser
function parseMarkdown(raw) {
    const segments = [];
    const lines = raw.split("\n");
    // Strip HTML span tags but preserve inner content
    const cleanedLines = [];
    for (const line of lines) {
        const cleaned = decodeHtmlEntities(line.replace(/<\/?span[^>]*>/g, ""));
        if (cleaned.trim())
            cleanedLines.push(cleaned);
        else if (line.trim() === "")
            cleanedLines.push(line);
    }
    let i = 0;
    const flushText = (buf) => {
        if (!buf)
            return;
        const parts = splitInline(buf);
        for (const p of parts) {
            if (p.startsWith("**") && p.endsWith("**")) {
                segments.push({ type: "bold", content: p.slice(2, -2) });
            }
            else if (p.startsWith("`") && p.endsWith("`") && !p.startsWith("``")) {
                segments.push({ type: "code", content: p.slice(1, -1) });
            }
            else if (p.startsWith("_") && p.endsWith("_")) {
                segments.push({ type: "italic", content: p.slice(1, -1) });
            }
            else if (p.startsWith("http://") || p.startsWith("https://")) {
                segments.push({ type: "link", content: p });
            }
            else {
                segments.push({ type: "text", content: p });
            }
        }
    };
    while (i < cleanedLines.length) {
        const line = cleanedLines[i];
        if (/^```/.test(line)) {
            const lang = line.slice(3).trim();
            const codeLines = [];
            i++;
            while (i < cleanedLines.length && !/^```/.test(cleanedLines[i])) {
                codeLines.push(cleanedLines[i]);
                i++;
            }
            const code = codeLines.join("\n");
            const useHighlight = langFromString(lang) !== "plain";
            segments.push({ type: useHighlight ? "highlightedCode" : "codeBlock", content: code, lang });
            i++;
            continue;
        }
        // LaTeX block detection in line-based parsing
        // Check for display math $$...$$ on its own line
        if (/^\$\$/.test(line)) {
            const latexLines = [];
            const closingLine = line.slice(2).trim();
            if (closingLine)
                latexLines.push(closingLine);
            i++;
            while (i < cleanedLines.length && !/^\$\$/.test(cleanedLines[i])) {
                latexLines.push(cleanedLines[i]);
                i++;
            }
            const content = latexLines.join("\n").replace(/\$\$/, "").trim();
            segments.push({ type: "latexBlock", content });
            i++;
            continue;
        }
        // Check for inline math $...$ within the line (not $$)
        const latexInline = line.match(/^(.*?)\$([^\n$]+)\$(.*)$/);
        if (latexInline) {
            const before = latexInline[1];
            const math = latexInline[2];
            const after = latexInline[3];
            if (before) {
                const subSegs = parseMarkdown(before + "\n").filter(s => s.type !== "text" || s.content.trim());
                subSegs.forEach(s => segments.push(s));
            }
            segments.push({ type: "latex", content: math });
            if (after) {
                const subSegs = parseMarkdown(after).filter(s => s.type !== "text" || s.content.trim());
                subSegs.forEach(s => segments.push(s));
            }
            i++;
            continue;
        }
        if (/^### /.test(line)) {
            segments.push({ type: "h3", content: line.replace(/^### /, "") });
            i++;
            continue;
        }
        if (/^## /.test(line)) {
            segments.push({ type: "h2", content: line.replace(/^## /, "") });
            i++;
            continue;
        }
        if (/^# /.test(line)) {
            segments.push({ type: "h1", content: line.replace(/^# /, "") });
            i++;
            continue;
        }
        if (/^---+$/.test(line.trim()) || /^_+$/.test(line.trim())) {
            segments.push({ type: "hr", content: "─".repeat(24) });
            i++;
            continue;
        }
        if (/^> /.test(line)) {
            segments.push({ type: "blockquote", content: line.replace(/^> /, "") });
            i++;
            continue;
        }
        if (/^[-*+] /.test(line)) {
            segments.push({ type: "list", content: line.replace(/^[-*+] /, "• ") });
            i++;
            continue;
        }
        if (/^\d+\. /.test(line)) {
            segments.push({ type: "list", content: line.replace(/^\d+\. /, (_, num) => `${num}. `) });
            i++;
            continue;
        }
        // Table row — detect by pipe syntax
        if (/^\|/.test(line)) {
            const tableLines = [];
            // Collect all consecutive table rows
            while (i < cleanedLines.length && /^\|/.test(cleanedLines[i])) {
                tableLines.push(cleanedLines[i]);
                i++;
            }
            const parsed = parseTable(tableLines);
            if (parsed) {
                segments.push({ type: "table", content: parsed.raw, headers: parsed.headers, rows: parsed.rows, alignments: parsed.alignments });
                continue;
            }
            // Not a valid table, fall through as text
            i -= tableLines.length;
        }
        const last = segments[segments.length - 1];
        if (last && last.type === "text" && !isBlank(line)) {
            last.content += (last.content.endsWith(" ") ? "" : " ") + line;
        }
        else if (!isBlank(line)) {
            segments.push({ type: "text", content: line });
        }
        i++;
    }
    // Only flush if the last segment is text — never re-process special segments
    const last = segments[segments.length - 1];
    if (last && last.type === "text") {
        flushText(segments.pop()?.content ?? "");
    }
    return segments.filter((s) => s.content !== undefined);
}
function parseTable(lines) {
    if (lines.length < 1)
        return null;
    // Parse header row: strip leading/trailing pipes and split on |
    const headerLine = lines[0];
    const headers = headerLine.split("|").slice(1, -1).map((c) => c.trim()).filter((c) => c.length > 0);
    if (headers.length === 0)
        return null;
    // If second line is a separator row (contains only -, :, |, spaces), parse alignments
    let alignments = [];
    if (lines.length >= 2) {
        const sepLine = lines[1];
        const sepCells = sepLine.split("|").slice(1, -1);
        for (const cell of sepCells) {
            const trimmed = cell.trim();
            if (/^:-+:$/.test(trimmed))
                alignments.push("center");
            else if (/^-+:$/.test(trimmed))
                alignments.push("right");
            else if (/^:-+$/.test(trimmed))
                alignments.push("left");
            else
                alignments.push(null);
        }
    }
    // Parse data rows (skip separator if present)
    const dataStart = alignments.length > 0 ? 2 : 1;
    const rows = [];
    for (let r = dataStart; r < lines.length; r++) {
        const cells = lines[r].split("|").slice(1, -1).map((c) => c.trim());
        if (cells.length > 0)
            rows.push(cells);
    }
    return { raw: lines.join("\n"), headers, rows, alignments };
}
function splitInline(text) {
    const parts = [];
    let buf = "";
    let i = 0;
    while (i < text.length) {
        if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
            if (buf) {
                parts.push(buf);
                buf = "";
            }
            let j = i + 3;
            while (j < text.length && !(text[j] === "`" && text[j + 1] === "`" && text[j + 2] === "`"))
                j++;
            parts.push("```" + text.slice(i + 3, j) + "```");
            i = j + 3;
            continue;
        }
        if (text[i] === "`") {
            let j = i + 1;
            while (j < text.length && text[j] !== "`")
                j++;
            if (buf) {
                parts.push(buf);
                buf = "";
            }
            parts.push("`" + text.slice(i + 1, j) + "`");
            i = j + 1;
            continue;
        }
        if (text[i] === "*" && text[i + 1] === "*") {
            let j = i + 2;
            while (j < text.length - 1 && !(text[j] === "*" && text[j + 1] === "*"))
                j++;
            if (buf) {
                parts.push(buf);
                buf = "";
            }
            parts.push("**" + text.slice(i + 2, j + 1) + "**");
            i = j + 2;
            continue;
        }
        if (text[i] === "_" && text[i + 1] !== "_") {
            let j = i + 1;
            while (j < text.length && text[j] !== "_")
                j++;
            if (buf) {
                parts.push(buf);
                buf = "";
            }
            parts.push("_" + text.slice(i + 1, j) + "_");
            i = j + 1;
            continue;
        }
        buf += text[i];
        i++;
    }
    if (buf)
        parts.push(buf);
    return parts;
}
function getSegmentFg(seg, theme, selected) {
    switch (seg.type) {
        case "h1": return theme.primary;
        case "h2": return theme.primary;
        case "h3": return theme.primary;
        case "codeBlock": return theme.success;
        case "highlightedCode": return theme.foreground;
        case "code": return theme.warning;
        case "bold": return selected ? theme.primary : theme.foreground;
        case "italic": return selected ? theme.muted : theme.foreground;
        case "link": return theme.info;
        case "list": return theme.foreground;
        case "blockquote": return theme.muted;
        case "hr": return theme.border;
        case "table": return theme.foreground;
        default: return selected ? theme.foreground : theme.muted;
    }
}
function getSegmentAttrs(seg) {
    if (seg.type === "bold" || seg.type === "h1" || seg.type === "h2" || seg.type === "h3")
        return 1;
    if (seg.type === "italic")
        return 2;
    if (seg.type === "codeBlock" || seg.type === "highlightedCode")
        return 1;
    return 0;
}
function getLangColor(lang, theme) {
    if (lang && CODE_LANG_COLORS[lang.toLowerCase()]) {
        return CODE_LANG_COLORS[lang.toLowerCase()];
    }
    return theme.success;
}
function truncateText(text, maxLen) {
    if (text.length <= maxLen)
        return text;
    return text.slice(0, maxLen - 1) + "…";
}
exports.TOKEN_COLORS = {
    keyword: "#c586c0",
    string: "#ce9178",
    comment: "#6a9955",
    number: "#b5cea8",
    function: "#dcdcaa",
    type: "#4ec9b0",
    operator: "#d4d4d4",
    punctuation: "#808080",
    plain: "#d4d4d4",
};
function getTokenFg(type) {
    return exports.TOKEN_COLORS[type] ?? exports.TOKEN_COLORS.plain;
}
// LaTeX math rendering (display and inline)
function parseLatexBlock(src, startIdx) {
    if (src[startIdx] !== "$")
        return null;
    const isBlock = src[startIdx + 1] === "$";
    if (isBlock && src[startIdx + 2] === "$")
        return null; // skip $$$
    const closeLen = isBlock ? 2 : 1;
    let i = startIdx + closeLen;
    let contentStart = i;
    // Find the closing $$
    while (i < src.length) {
        if (src[i] === "$" && src[i + 1] === "$" && closeLen === 2) {
            const content = src.slice(contentStart, i).trim();
            return { content, isBlock: true, endIdx: i + 2 };
        }
        if (src[i] === "$" && closeLen === 1 && (i === 0 || src[i - 1] !== "$")) {
            // Don't close on $$ (block opener)
            if (src[i + 1] === "$") {
                i++;
                continue;
            }
            const content = src.slice(contentStart, i).trim();
            // Inline math can't contain newlines in simple implementation
            if (content.includes("\n"))
                return null;
            return { content, isBlock: false, endIdx: i + 1 };
        }
        i++;
    }
    return null;
}
const LATEX_COMMANDS = new Set([
    "frac", "sqrt", "sum", "int", "prod", "lim", "log", "ln", "exp", "sin", "cos", "tan",
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    "hat", "bar", "vec", "dot", "ddot", "tilde", "overrightarrow", "leftarrow", "rightarrow",
    "partial", "nabla", "infty", "pm", "times", "div", "cdot", "leq", "geq", "neq", "approx",
    "equiv", "subset", "supset", "in", "notin", "cup", "cap", "forall", "exists", "perp",
    "therefore", "because", "cdots", "vdots", "ddots", "quad", "qquad",
    "text", "textbf", "textit", "客户服务",
]);
const GREEK_MAP = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
    eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
    nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
    upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
    Sigma: "Σ", Upsilon: "Θ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
function renderLatex(latex, isBlock) {
    const tokens = [];
    let i = 0;
    const src = latex;
    while (i < src.length) {
        // Command: \name or \name{}
        if (src[i] === "\\" && /[a-zA-Z_]/.test(src[i + 1] ?? "")) {
            let j = i + 1;
            while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]))
                j++;
            const cmd = src.slice(i + 1, j);
            const isKnown = LATEX_COMMANDS.has(cmd);
            tokens.push({ type: isKnown ? "command" : "argument", value: "\\" + cmd });
            // Handle optional argument in braces
            if (src[j] === "{") {
                let depth = 0;
                let k = j;
                while (k < src.length) {
                    if (src[k] === "{")
                        depth++;
                    else if (src[k] === "}") {
                        depth--;
                        if (depth === 0)
                            break;
                    }
                    k++;
                }
                tokens.push({ type: "group", value: src.slice(j, k + 1) });
                j = k + 1;
            }
            // Handle superscript/subscript directly after command
            if (src[j] === "^" || src[j] === "_") {
                const supSub = src[j];
                let k = j + 1;
                if (src[k] === "{") {
                    let depth = 0;
                    while (k < src.length) {
                        if (src[k] === "{")
                            depth++;
                        else if (src[k] === "}") {
                            depth--;
                            if (depth === 0)
                                break;
                        }
                        k++;
                    }
                    tokens.push({ type: "symbol", value: supSub + src.slice(j + 1, k + 1) });
                    j = k + 1;
                }
                else if (/[a-zA-Z0-9]/.test(src[k])) {
                    tokens.push({ type: "symbol", value: supSub + src[k] });
                    j = k + 1;
                }
                else {
                    j++;
                }
            }
            i = j;
            continue;
        }
        // Group { }
        if (src[i] === "{") {
            let depth = 0;
            let j = i;
            while (j < src.length) {
                if (src[j] === "{")
                    depth++;
                else if (src[j] === "}") {
                    depth--;
                    if (depth === 0)
                        break;
                }
                j++;
            }
            tokens.push({ type: "group", value: src.slice(i, j + 1) });
            i = j + 1;
            continue;
        }
        // Symbol
        if (/[\_\^\{\}\[\]\(\)]/.test(src[i])) {
            tokens.push({ type: "symbol", value: src[i] });
            i++;
            continue;
        }
        // Number
        if (/[0-9.]/.test(src[i])) {
            let j = i;
            while (j < src.length && /[0-9.]/.test(src[j]))
                j++;
            tokens.push({ type: "number", value: src.slice(i, j) });
            i = j;
            continue;
        }
        // Whitespace
        if (/\s/.test(src[i])) {
            let j = i;
            while (j < src.length && /\s/.test(src[j]))
                j++;
            tokens.push({ type: "text", value: src.slice(i, j) });
            i = j;
            continue;
        }
        // Other char
        tokens.push({ type: "text", value: src[i] });
        i++;
    }
    return { tokens, greek: new Map(Object.entries(GREEK_MAP)) };
}
exports.LATEX_TOKEN_COLORS = {
    command: "#c586c0", // purple — known commands like \frac, \sum
    argument: "#9cdcfe", // light blue — unknown commands
    group: "#ce9178", // orange — {...} groups
    symbol: "#d4d4d4", // white — _ ^ { } etc.
    number: "#b5cea8", // light green
    text: "#808080", // gray — plain text inside text{}
};
function getLatexTokenFg(type) {
    return exports.LATEX_TOKEN_COLORS[type] ?? "#d4d4d4";
}
function getLatexBg(isBlock) {
    return isBlock ? "#1a1a2e" : "transparent";
}
function getLatexFg(isBlock) {
    return isBlock ? "#4ec9b0" : "#9cdcfe";
}
