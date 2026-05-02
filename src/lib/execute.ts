// ─── Inline code execution ────────────────────────────────────────────────────
// Supports: js, ts, python, bash, sh, go, rust, sql, json
// Uses Bun's process APIs for file I/O and subprocess management

import type { Message } from "../store/chat-store";
import { writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

declare const Bun: any;

// Supported languages and their run commands
const EXECUTORS: Record<string, { cmd: string; args: (code: string, file: string) => string[] }> = {
  js: { cmd: "node", args: (_code, file) => [file] },
  ts: { cmd: "npx", args: (_code, file) => ["ts-node", file] },
  python: { cmd: "python3", args: (_code, file) => [file] },
  py: { cmd: "python3", args: (_code, file) => [file] },
  bash: { cmd: "bash", args: (_code, file) => [file] },
  sh: { cmd: "bash", args: (_code, file) => [file] },
  shell: { cmd: "bash", args: (_code, file) => [file] },
  go: { cmd: "go", args: (_code, file) => ["run", file] },
  rust: { cmd: "rustc", args: (_code, file) => ["run", file] },
  sql: { cmd: "sqlite3", args: (_code, _file) => [] },
  json: { cmd: "python3", args: (_code, _file) => ["-c", "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))"] },
};

const EXECUTABLE_LANGS = new Set(["js", "ts", "python", "py", "bash", "sh", "shell", "go", "rust", "sql", "json"]);

export function canExecute(lang: string): boolean {
  return EXECUTABLE_LANGS.has(lang.toLowerCase());
}

export interface CodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Execute code and return structured result
export async function executeCode(code: string, lang: string): Promise<CodeResult> {
  const langKey = lang.toLowerCase();
  const executor = EXECUTORS[langKey];
  if (!executor) {
    return { stdout: "", stderr: `No executor for language: ${lang}`, exitCode: 1, durationMs: 0 };
  }

  const start = Date.now();
  const ext =
    langKey === "python" || langKey === "py" ? "py" :
    langKey === "js" ? "js" :
    langKey === "ts" ? "ts" :
    langKey === "go" ? "go" :
    langKey === "rust" ? "rs" :
    (langKey === "bash" || langKey === "sh" || langKey === "shell") ? "sh" : "txt";
  const filename = `${tmpdir()}/orbitron_exec_${Date.now()}.${ext}`;

  try {
    await writeFile(filename, code, { mode: 0o600 });

    if (langKey === "sql") {
      // SQLite inline — run via python
      const pythonCode = `import sqlite3, tempfile, os, sys
sql = """${code.replace(/"""/g, '\\"\\"\\"')}"""
with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
    dbpath = f.name
conn = sqlite3.connect(dbpath)
try:
    cur = conn.cursor()
    cur.execute(sql)
    rows = cur.fetchall()
    for row in rows:
        print(row)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
finally:
    conn.close()
    os.unlink(dbpath)
`;
      const pyFile = `${tmpdir()}/orbitron_sql_${Date.now()}.py`;
      await writeFile(pyFile, pythonCode, { mode: 0o600 });
      const proc = Bun.spawn({ cmd: "python3", args: [pyFile], stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout as any).text();
      const stderr = await new Response(proc.stderr as any).text();
      await proc.exit;
      try { Bun.unlink(pyFile); } catch {}
      return { stdout, stderr, exitCode: proc.exitCode, durationMs: Date.now() - start };
    }

    const args = executor.args(code, filename);
    const proc = Bun.spawn({ cmd: executor.cmd, args, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as any).text(),
      new Response(proc.stderr as any).text(),
    ]);
    const exitCode = await proc.exit;
    return { stdout, stderr, exitCode, durationMs: Date.now() - start };
  } finally {
    try { await unlink(filename); } catch {}
  }
}

// Execute code from a message — adds a thinking message then the result
export async function handleRunCode(
  code: string,
  lang: string,
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => void
): Promise<void> {
  const trimmedLang = lang?.trim() || "";
  if (!canExecute(trimmedLang)) {
    addMessage({
      role: "assistant",
      content: `No executor for \`${trimmedLang}\`. Supported: ${[...EXECUTABLE_LANGS].join(", ")}`,
    });
    return;
  }

  addMessage({ role: "assistant", content: `⏳ Running \`${trimmedLang}\` code…` });

  try {
    const result = await executeCode(code, trimmedLang);

    const lines: string[] = [];
    lines.push(`\n─── ${trimmedLang} output (${formatDuration(result.durationMs)} · exit ${result.exitCode}) ───`);
    if (result.stdout) lines.push(result.stdout.trim());
    if (result.stderr) lines.push(`stderr: ${result.stderr.trim()}`);
    if (!result.stdout && !result.stderr) lines.push("(no output)");

    addMessage({
      role: "assistant",
      content: lines.join("\n"),
    });
  } catch (err) {
    addMessage({
      role: "assistant",
      content: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// Extract the last code block from a message's content
export function extractLastCodeBlock(content: string): { code: string; lang: string } | null {
  const match = content.match(/```(\w*)\n([\s\S]*?)```/);
  if (!match) return null;
  return { code: match[2], lang: match[1] || "plain" };
}

// Find and execute the last code block in the conversation history
export async function runLastCodeBlock(
  messages: Message[],
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => void
): Promise<void> {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const extracted = extractLastCodeBlock(msg.content);
    if (extracted) {
      await handleRunCode(extracted.code, extracted.lang, addMessage);
      return;
    }
  }
  addMessage({ role: "assistant", content: "No code block found in recent messages." });
}