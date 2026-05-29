import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Plugin, PluggableList } from "unified";
import type { Element, Root, RootContent, Text } from "hast";
import { cn } from "../../lib/cn";
import "./Markdown.css";

/**
 * Renders model/user markdown as clean, styled HTML — code fences, lists,
 * tables, headings, inline code, links, the lot. remark-gfm adds GitHub
 * niceties (tables, task lists, strikethrough, autolinks).
 *
 * `highlight` keeps search-result hit highlighting working: a tiny rehype
 * plugin walks the rendered tree and wraps query matches in <mark> AFTER
 * markdown → HTML, so highlighting survives across formatting (and never
 * corrupts the markdown source the way a pre-pass string replace would).
 *
 * Links open in a new tab with rel=noreferrer — these are model-authored,
 * treat them as untrusted.
 */
type Props = {
  text: string;
  /** Active search query to highlight, or null/empty for plain reading. */
  highlight?: string | null;
  /** Extra class on the wrapper (callers reuse their existing text styles). */
  className?: string;
};

export function Markdown({ text, highlight, className }: Props) {
  const query = highlight?.trim() || "";
  // Rebuild the plugin list only when the query changes — react-markdown
  // re-parses on every render otherwise it's cheap, but the plugin closure
  // captures `query` so it must be memoized against it.
  const rehypePlugins = useMemo<PluggableList>(
    () => (query ? [[highlightQuery, { query }]] : []),
    [query],
  );

  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ── Search-hit highlight (rehype) ──────────────────────────────────────────
   Splits text nodes on the query and wraps matches in <mark class="md-match">.
   Hand-walks the hast tree to stay dep-free (no unist-util-visit). Skips
   nodes inside <code>/<pre> so highlighting never breaks code formatting. */
const highlightQuery: Plugin<[{ query: string }], Root> = (options) => {
  const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");

  const walk = (node: Root | Element, insideCode: boolean) => {
    const next: RootContent[] = [];
    for (const child of node.children) {
      if (child.type === "text" && !insideCode) {
        const parts = (child as Text).value.split(re);
        if (parts.length <= 1) {
          next.push(child);
          continue;
        }
        parts.forEach((part, i) => {
          if (part === "") return;
          if (i % 2 === 1) {
            next.push({
              type: "element",
              tagName: "mark",
              properties: { className: ["md-match"] },
              children: [{ type: "text", value: part }],
            });
          } else {
            next.push({ type: "text", value: part });
          }
        });
      } else {
        if (child.type === "element") {
          const tag = child.tagName;
          walk(child, insideCode || tag === "code" || tag === "pre");
        }
        next.push(child);
      }
    }
    node.children = next;
  };

  return (tree) => {
    walk(tree, false);
  };
};
