import { defineConfig } from "vitepress";
import llmstxt, {
  copyOrDownloadAsMarkdownButtons,
} from "vitepress-plugin-llms";

const SITE_URL = "https://www.botholomew.com";
const REPO_URL = "https://github.com/evantahler/botholomew";

export const LLM_LANDING_PAGE = `# Botholomew

> An AI agent for knowledge work.

This is the Botholomew documentation site. Two LLM-friendly documentation formats are available:

- [llms.txt](/llms.txt) — Table of contents with links to all documentation pages
- [llms-full.txt](/llms-full.txt) — Complete documentation bundle (all pages in one file)

## Per-Page Markdown

Each documentation page is available in Markdown format by appending \`.md\` to the URL.
For example: \`/architecture.md\`, \`/configuration.md\`

## Pages

- Introduction: /index.md
- Get started: /getting-started.md
- Architecture: /architecture.md
- The TUI: /tui.md
- Configuration: /configuration.md
- Virtual filesystem: /virtual-filesystem.md
- Context & hybrid search: /context-and-search.md
- Persistent context: /persistent-context.md
- Tasks & schedules: /tasks-and-schedules.md
- Automation: /automation.md
- Skills: /skills.md
- Tools: /tools.md
- MCPX integration: /mcpx.md
- Doc captures: /captures.md
- Owl character sheet: /owl-character-sheet.md
- Changelog: /changelog.md
`;

export function toMarkdownUrl(url: string): string {
  const cleanUrl = (url.split("?")[0] ?? "").split("#")[0] ?? "";
  if (cleanUrl.endsWith(".md")) return cleanUrl;
  if (cleanUrl.endsWith("/index.html"))
    return cleanUrl.replace(/\/index\.html$/, "/index.md");
  if (cleanUrl.endsWith(".html")) return cleanUrl.replace(/\.html$/, ".md");
  if (cleanUrl.endsWith("/")) return `${cleanUrl}index.md`;
  return `${cleanUrl}.md`;
}

function addLlmMiddleware(server: {
  middlewares: {
    use: (fn: (req: any, res: any, next: () => void) => void) => void;
  };
}) {
  server.middlewares.use((req, res, next) => {
    const accept = req.headers["accept"] ?? "";
    if (!accept.includes("text/markdown")) return next();

    const url = (req.url ?? "/").split("?")[0] ?? "/";

    if (url === "/" || url === "/index.html") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.end(LLM_LANDING_PAGE);
      return;
    }

    res.writeHead(302, { Location: toMarkdownUrl(url) });
    res.end();
  });
}

export default defineConfig({
  title: "Botholomew",
  description: "An AI agent for knowledge work.",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/plans/**", "**/tapes/**"],

  transformHead({ pageData }) {
    const mdUrl = `/${pageData.relativePath}`;
    return [["link", { rel: "alternate", type: "text/markdown", href: mdUrl }]];
  },

  sitemap: { hostname: SITE_URL },

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#4a7c59" }],
    [
      "link",
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
    ],
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400..700,50&display=swap",
      },
    ],
    ["meta", { property: "og:title", content: "Botholomew" }],
    [
      "meta",
      {
        property: "og:description",
        content: "An AI agent for knowledge work.",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:url", content: SITE_URL }],
    [
      "link",
      {
        rel: "alternate",
        type: "text/plain",
        href: "/llms.txt",
        title: "LLM documentation index",
      },
    ],
    [
      "link",
      {
        rel: "alternate",
        type: "text/plain",
        href: "/llms-full.txt",
        title: "Full LLM documentation",
      },
    ],
  ],

  markdown: {
    languageAlias: {
      tape: "bash",
      cron: "bash",
    },
    config: (md) => {
      md.use(copyOrDownloadAsMarkdownButtons);
    },
  },

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Get started", link: "/getting-started" },
      { text: "Docs", link: "/architecture" },
      { text: "Changelog", link: "/changelog" },
      { text: "GitHub", link: REPO_URL },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Install & quickstart", link: "/getting-started" },
        ],
      },
      {
        text: "Core concepts",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "The TUI", link: "/tui" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
      {
        text: "Knowledge work",
        items: [
          { text: "Virtual filesystem", link: "/virtual-filesystem" },
          {
            text: "Context & hybrid search",
            link: "/context-and-search",
          },
          { text: "Persistent context", link: "/persistent-context" },
        ],
      },
      {
        text: "Execution",
        items: [
          { text: "Tasks & schedules", link: "/tasks-and-schedules" },
          { text: "Automation", link: "/automation" },
        ],
      },
      {
        text: "Customization",
        items: [
          { text: "Skills", link: "/skills" },
          { text: "Tools", link: "/tools" },
          { text: "MCPX integration", link: "/mcpx" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Doc captures", link: "/captures" },
          { text: "Owl character sheet", link: "/owl-character-sheet" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: REPO_URL }],
    editLink: {
      pattern:
        "https://github.com/evantahler/botholomew/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © Evan Tahler",
    },
  },

  vite: {
    plugins: [
      llmstxt({
        generateLLMFriendlyDocsForEachPage: true,
        domain: SITE_URL,
      }),
      {
        name: "llm-markdown-routing",
        configureServer: addLlmMiddleware,
        configurePreviewServer: addLlmMiddleware,
      },
    ],
  },
});
