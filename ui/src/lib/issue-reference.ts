type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const BARE_ISSUE_IDENTIFIER_RE = /^[A-Z][A-Z0-9]+-\d+$/i;
const ISSUE_SCHEME_RE = /^issue:\/\/:?([^?#\s]+)(?:[?#].*)?$/i;
const ISSUE_REFERENCE_TOKEN_RE = /issue:\/\/:?[^\s<>()]+|https?:\/\/[^\s<>()]+|\/(?:[^\s<>()/]+\/)*issues\/[A-Z][A-Z0-9]+-\d+(?=$|[\s<>)\],.;!?:])|\b[A-Z][A-Z0-9]+-\d+\b/gi;

// PATCH(nodnarb93): self-host issue URL rewriting (Patch 29) — upstream #4558
// (commit 8145141c) stopped rewriting absolute http(s) issue URLs to internal
// routes so true remote references (e.g. prod from staging) preserve their
// origin. But in single-instance setups that are reachable via multiple
// origins (tailnet hostname + LAN IP + localhost), agents commonly embed
// "http://localhost:3100/<prefix>/issues/<id>" URLs in comments (built from
// PAPERCLIP_API_URL). Those then open in a new tab pointing at localhost
// regardless of which origin the operator is currently browsing through.
//
// Treat absolute URLs whose hostname is a known self-host literal as internal,
// stripping the origin so the rewritten link is relative and resolves to
// whatever origin the operator's browser is currently on (tailnet, LAN, or
// localhost). True remote URLs (any other hostname) keep upstream's behavior.
const SELF_HOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function selfHostIssuePathnameOrNull(absoluteUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!SELF_HOST_HOSTNAMES.has(parsed.hostname.toLowerCase())) return null;
  return parsed.pathname;
}

export function parseIssuePathIdFromPath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const pathname = pathOrUrl.trim();
  if (!pathname) return null;

  let pathToParse = pathname;
  if (/^https?:\/\//i.test(pathname)) {
    const selfHostPath = selfHostIssuePathnameOrNull(pathname);
    if (!selfHostPath) return null;
    pathToParse = selfHostPath;
  }

  const segments = pathToParse.split("/").filter(Boolean);
  const issueIndex = segments.findIndex((segment) => segment === "issues");
  if (issueIndex === -1 || issueIndex === segments.length - 1) return null;
  const issuePathId = decodeURIComponent(segments[issueIndex + 1] ?? "");
  if (!issuePathId || issuePathId.startsWith(":")) return null;
  return BARE_ISSUE_IDENTIFIER_RE.test(issuePathId) ? issuePathId.toUpperCase() : issuePathId;
}

export function parseIssueReferenceFromHref(href: string | null | undefined) {
  if (!href) return null;
  const trimmed = href.trim();
  const issueSchemeMatch = trimmed.match(ISSUE_SCHEME_RE);
  if (issueSchemeMatch?.[1]) {
    const issuePathId = decodeURIComponent(issueSchemeMatch[1]);
    return {
      issuePathId,
      href: `/issues/${encodeURIComponent(issuePathId)}`,
    };
  }

  const pathId = parseIssuePathIdFromPath(href);
  if (pathId) {
    return {
      issuePathId: pathId,
      href: `/issues/${encodeURIComponent(pathId)}`,
    };
  }

  if (!BARE_ISSUE_IDENTIFIER_RE.test(trimmed)) return null;
  const normalized = trimmed.toUpperCase();
  return {
    issuePathId: normalized,
    href: `/issues/${encodeURIComponent(normalized)}`,
  };
}

function splitTrailingPunctuation(token: string) {
  let core = token;
  let trailing = "";

  while (core.length > 0) {
    const lastChar = core.at(-1);
    if (!lastChar || !/[),.;!?:\]]/.test(lastChar)) break;
    if (lastChar === ")") {
      const openCount = (core.match(/\(/g) ?? []).length;
      const closeCount = (core.match(/\)/g) ?? []).length;
      if (closeCount <= openCount) break;
    }
    if (lastChar === "]") {
      const openCount = (core.match(/\[/g) ?? []).length;
      const closeCount = (core.match(/\]/g) ?? []).length;
      if (closeCount <= openCount) break;
    }
    trailing = `${lastChar}${trailing}`;
    core = core.slice(0, -1);
  }

  return { core, trailing };
}

function createIssueLinkNode(value: string, href: string, childType: "text" | "inlineCode" = "text"): MarkdownNode {
  return {
    type: "link",
    url: href,
    children: [{ type: childType, value }],
  };
}

function linkifyIssueReferencesInText(value: string): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  let matched = false;

  for (const match of value.matchAll(ISSUE_REFERENCE_TOKEN_RE)) {
    const raw = match[0];
    if (!raw) continue;

    const start = match.index ?? 0;
    const end = start + raw.length;
    const { core, trailing } = splitTrailingPunctuation(raw);
    const issueRef = parseIssueReferenceFromHref(core);
    if (!issueRef) continue;

    matched = true;
    if (start > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, start) });
    }
    nodes.push(createIssueLinkNode(core, issueRef.href));
    if (trailing) {
      nodes.push({ type: "text", value: trailing });
    }
    cursor = end;
  }

  if (!matched) return null;
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function rewriteMarkdownTree(node: MarkdownNode) {
  if (!Array.isArray(node.children) || node.children.length === 0) return;
  if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "definition" || node.type === "html") {
    return;
  }

  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "inlineCode" && typeof child.value === "string") {
      const issueRef = parseIssueReferenceFromHref(child.value);
      if (issueRef) {
        nextChildren.push(createIssueLinkNode(child.value, issueRef.href, "inlineCode"));
        continue;
      }
    }

    if (child.type === "text" && typeof child.value === "string") {
      const linked = linkifyIssueReferencesInText(child.value);
      if (linked) {
        nextChildren.push(...linked);
        continue;
      }
    }

    rewriteMarkdownTree(child);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

export function remarkLinkIssueReferences() {
  return (tree: MarkdownNode) => {
    rewriteMarkdownTree(tree);
  };
}
