// See docs/code-comments.md
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const TOOL_WITH_REASON = /^(?:@ts-(?:expect-error|ignore|nocheck)|(?:eslint|oxlint)-disable(?:-next-line|-line)?)\s+.*\S/;
const TOOL_BARE = /^(?:@ts-check|(?:eslint|oxlint)-enable)\b/;
const DISABLE = /^(?:eslint|oxlint)-disable(?:-next-line|-line)?\b/;
const POINTER = /^See\s+([^\s#]+?)(#\S*)?\.?$/;

const rootCache = new Map();

function repoRoot(filename, cwd) {
  let dir = dirname(filename);
  if (rootCache.has(dir)) return rootCache.get(dir);
  let found = cwd;
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, "bunfig.toml"))) {
      found = current;
      break;
    }
    if (dirname(current) === current) break;
  }
  rootCache.set(dir, found);
  return found;
}

function text(comment) {
  const value = comment.type === "Block" ? comment.value.replace(/^\*+/, "").replace(/\n\s*\*/g, "\n") : comment.value;
  return value.trim();
}

function looksLikePath(target) {
  return target.includes("/") || /\.\w+$/.test(target);
}

function isFileInside(root, target) {
  if (isAbsolute(target)) return false;
  const path = resolve(root, target);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function classify(comment, root) {
  if (comment.type === "Shebang" || comment.type === "Hashbang") return { ok: true };
  const body = text(comment);
  if (comment.type === "Line" && /^\/\s*<reference\s[^>]*\/>$/.test(comment.value.trim())) return { ok: true };
  if (DISABLE.test(body)) {
    const reason = body.split(/\s--(?:\s|$)/)[1];
    return reason && reason.trim() ? { ok: true } : { ok: false, messageId: "disableWithoutReason" };
  }
  if (TOOL_WITH_REASON.test(body) || TOOL_BARE.test(body)) return { ok: true };
  if (/^@ts-(?:expect-error|ignore|nocheck)\b/.test(body)) return { ok: false, messageId: "directiveWithoutReason" };
  const pointer = POINTER.exec(body);
  if (pointer && looksLikePath(pointer[1])) {
    return isFileInside(root, pointer[1]) ? { ok: true } : { ok: false, messageId: "missingTarget", data: { target: pointer[1] } };
  }
  return { ok: false, messageId: "prose" };
}

const commentsPointToDocs = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      prose:
        "Comments are not allowed except a pointer (`See docs/<file>.md#anchor`) or a tool directive. Move the explanation to a document and point to it, or remove it (docs/code-comments.md).",
      missingTarget:
        "This comment points to `{{target}}`, which does not exist in the repository. Fix the path or write the document (docs/code-comments.md).",
      directiveWithoutReason: "A `@ts-` directive needs a reason after it (docs/code-comments.md).",
      disableWithoutReason: "A lint disable directive needs a reason after ` -- ` (docs/code-comments.md).",
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const root = repoRoot(context.filename ?? context.getFilename(), context.cwd ?? process.cwd());
        for (const comment of sourceCode.getAllComments()) {
          const verdict = classify(comment, root);
          if (!verdict.ok) context.report({ loc: comment.loc, messageId: verdict.messageId, data: verdict.data });
        }
      },
    };
  },
};

export default {
  meta: { name: "local" },
  rules: { "comments-point-to-docs": commentsPointToDocs },
};
