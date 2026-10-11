import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// The only file in the app that imports `react-markdown`. Everything that
// renders model-authored prose and the public docs pages go through here, so
// the plugin set, the element overrides, and the `.bh-md` scope are decided
// once. Two copies drift, and the drift shows up as a table that renders on one
// page and not on another.
//
// There is deliberately **no `rehype-raw`**. Model-authored prose is written by
// a language model that may have just read a page anybody could have written,
// and react-markdown dropping raw HTML is the entire reason this content is
// safe to put in the DOM. It also runs every `href` and `src` through `micromark-util-sanitize-uri`,
// which is what refuses `javascript:` and `data:` URLs. Adding `rehype-raw`
// would remove both properties at once.

/** GFM only: tables, task lists, strikethrough. What a *document* wants. */
const DOCUMENT_PLUGINS = [remarkGfm];

/** GFM plus hard line breaks. What free-form *prose* wants — see `breaks`. */
const PROSE_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * A markdown table, rendered as the `.table` the theme already styles.
 *
 * A bare `<table>` inherits almost nothing from `theme.scss` — the table rules
 * there are scoped to `.table` — so without this a table would parse correctly
 * and still render as unbordered text.
 * @param props - The props react-markdown passes to the element.
 * @returns The rendered table.
 */
function MarkdownTable(props: React.ComponentPropsWithoutRef<"table">) {
  return <table {...props} className="table table-sm" />;
}

/**
 * A markdown link, opened in a new tab with no opener.
 *
 * The href came from a model, so the tab it opens must not be able to reach
 * back into ours through `window.opener`.
 * @param props - The props react-markdown passes to the element.
 * @returns The rendered anchor.
 */
function ExternalMarkdownLink(props: React.ComponentPropsWithoutRef<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

/**
 * Whether an href is a same-origin app path the router should own.
 *
 * Protocol-relative (`//evil.example`) and bare hashes stay on a plain `<a>` —
 * only rooted paths like `/docs/why` become in-app navigations.
 * @param href - The link target from the markdown.
 * @returns Whether to render a react-router `Link`.
 */
function isInternalAppPath(href: string | undefined): href is string {
  return !!href && href.startsWith("/") && !href.startsWith("//");
}

/**
 * A markdown link for trusted documents (the public docs): in-app paths stay
 * inside the SPA; everything else still leaves in a new tab with no opener.
 * @param props - The props react-markdown passes to the element.
 * @returns The rendered link.
 */
function InternalMarkdownLink(props: React.ComponentPropsWithoutRef<"a">) {
  const { href, children, className, title } = props;
  if (isInternalAppPath(href)) {
    // Only the props a router `Link` understands — react-markdown also passes a
    // `node` handle that must not land on a DOM element or a Link.
    return (
      <Link to={href} className={className} title={title}>
        {children}
      </Link>
    );
  }
  return <ExternalMarkdownLink {...props} />;
}

const EXTERNAL_COMPONENTS = { table: MarkdownTable, a: ExternalMarkdownLink };
const INTERNAL_COMPONENTS = { table: MarkdownTable, a: InternalMarkdownLink };

/**
 * Render markdown into the terminal theme.
 * @param props.children - The markdown source.
 * @param props.breaks - Treat a single newline as a line break. Free prose a
 *   person or a model typed — a message, an answer — is written with hard
 *   newlines, so reflowing it into one paragraph loses information. A document
 *   means what markdown says it means. It is the same split GitHub makes
 *   between a comment box and a `.md` file.
 * @param props.internalLinks - When true, rooted paths (`/docs/…`) navigate
 *   in-app via react-router. Off by default: model-authored hrefs must not own
 *   the tab, so they keep opening externally with `noopener`.
 * @param props.className - Extra classes for the wrapper.
 * @param props.testId - A `data-testid` for the wrapper.
 * @returns The rendered markdown.
 */
export default function MarkdownBlock({
  children,
  breaks = false,
  internalLinks = false,
  className,
  testId,
}: {
  children: string;
  breaks?: boolean;
  internalLinks?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={className ? `bh-md ${className}` : "bh-md"}
      data-testid={testId}
    >
      <Markdown
        remarkPlugins={breaks ? PROSE_PLUGINS : DOCUMENT_PLUGINS}
        components={internalLinks ? INTERNAL_COMPONENTS : EXTERNAL_COMPONENTS}
      >
        {children}
      </Markdown>
    </div>
  );
}
