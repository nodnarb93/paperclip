import { describe, expect, it } from "vitest";
import { parseIssuePathIdFromPath, parseIssueReferenceFromHref } from "./issue-reference";

describe("issue-reference", () => {
  it("extracts issue ids from company-scoped issue paths", () => {
    expect(parseIssuePathIdFromPath("/PAP/issues/PAP-1271")).toBe("PAP-1271");
    expect(parseIssuePathIdFromPath("/PAP/issues/pap-1272")).toBe("PAP-1272");
    expect(parseIssuePathIdFromPath("/issues/PAP-1179")).toBe("PAP-1179");
    expect(parseIssuePathIdFromPath("/issues/:id")).toBeNull();
  });

  // PATCH(nodnarb93): self-host issue URL rewriting (Patch 29)
  it("rewrites absolute self-host issue URLs to internal issue paths", () => {
    // Self-host hostnames are recognized so agent-written localhost links open
    // in whatever origin the operator is currently browsing through (tailnet,
    // LAN, etc.) rather than as new tabs to localhost.
    expect(parseIssuePathIdFromPath("http://localhost:3100/PAP/issues/PAP-1179")).toBe("PAP-1179");
    expect(parseIssuePathIdFromPath("http://127.0.0.1:3100/PAP/issues/PAP-1179")).toBe("PAP-1179");
    expect(parseIssuePathIdFromPath("http://0.0.0.0:3100/PAP/issues/PAP-1179")).toBe("PAP-1179");
    expect(parseIssuePathIdFromPath("https://localhost/PAP/issues/PAP-1179")).toBe("PAP-1179");
  });

  it("does not treat truly remote Paperclip issue URLs as internal", () => {
    // Genuine remote-instance references must preserve origin/port/hash so the
    // operator lands on the other instance, not the current one.
    expect(parseIssuePathIdFromPath("http://remote.example.test:3103/PAPA/issues/PAPA-115#comment-850083f3-24de-43e7-a8cd-bc01f7cc9f0d")).toBeNull();
    expect(parseIssuePathIdFromPath("https://prod.example.com/PAP/issues/PAP-1")).toBeNull();
    expect(parseIssuePathIdFromPath("https://desktop-ognems2.porcupine-logarithm.ts.net/PAP/issues/PAP-1")).toBeNull();
  });

  it("does not treat GitHub issue URLs as internal Paperclip issue links", () => {
    expect(parseIssuePathIdFromPath("https://github.com/paperclipai/paperclip/issues/1778")).toBeNull();
    expect(parseIssueReferenceFromHref("https://github.com/paperclipai/paperclip/issues/1778")).toBeNull();
  });

  it("ignores placeholder issue paths even when wrapped in a self-host URL", () => {
    expect(parseIssuePathIdFromPath("/issues/:id")).toBeNull();
    expect(parseIssuePathIdFromPath("http://localhost:3100/issues/:id")).toBeNull();
    expect(parseIssueReferenceFromHref("/issues/:id")).toBeNull();
  });

  it("normalizes bare identifiers, relative issue paths, and issue scheme links into internal links", () => {
    expect(parseIssueReferenceFromHref("pap-1271")).toEqual({
      issuePathId: "PAP-1271",
      href: "/issues/PAP-1271",
    });
    expect(parseIssueReferenceFromHref("/PAP/issues/pap-1180")).toEqual({
      issuePathId: "PAP-1180",
      href: "/issues/PAP-1180",
    });
    expect(parseIssueReferenceFromHref("issue://PAP-1310")).toEqual({
      issuePathId: "PAP-1310",
      href: "/issues/PAP-1310",
    });
    expect(parseIssueReferenceFromHref("issue://:PAP-1311")).toEqual({
      issuePathId: "PAP-1311",
      href: "/issues/PAP-1311",
    });
  });

  it("normalizes exact inline-code-like issue identifiers", () => {
    expect(parseIssueReferenceFromHref("PAP-1271")).toEqual({
      issuePathId: "PAP-1271",
      href: "/issues/PAP-1271",
    });
  });

  // PATCH(nodnarb93): self-host issue URL rewriting (Patch 29)
  it("rewrites self-host absolute issue URLs to relative internal hrefs", () => {
    // Relative href so the browser resolves against window.location.origin —
    // the rewritten link works for whichever origin the operator is currently
    // accessing the instance through.
    expect(parseIssueReferenceFromHref("http://localhost:3100/PAP/issues/PAP-1179")).toEqual({
      issuePathId: "PAP-1179",
      href: "/issues/PAP-1179",
    });
    expect(parseIssueReferenceFromHref("http://127.0.0.1:3100/PAP/issues/pap-1180")).toEqual({
      issuePathId: "PAP-1180",
      href: "/issues/PAP-1180",
    });
  });

  it("preserves truly remote Paperclip URLs so origin, port, and hash are not lost", () => {
    expect(parseIssueReferenceFromHref("http://remote.example.test:3103/PAPA/issues/PAPA-115#comment-850083f3-24de-43e7-a8cd-bc01f7cc9f0d")).toBeNull();
    expect(parseIssueReferenceFromHref("https://prod.example.com/PAP/issues/PAP-1")).toBeNull();
    expect(parseIssueReferenceFromHref("https://desktop-ognems2.porcupine-logarithm.ts.net/PAP/issues/PAP-1")).toBeNull();
  });

  it("ignores literal route placeholder paths", () => {
    expect(parseIssueReferenceFromHref("/issues/:id")).toBeNull();
    expect(parseIssueReferenceFromHref("http://localhost:3100/api/issues/:id")).toBeNull();
  });
});
