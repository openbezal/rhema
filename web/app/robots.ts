import type { MetadataRoute } from "next";
import { SITE } from "./_lib/site";

export const dynamic = "force-static";

// We explicitly allow every documented AI/search crawler. Rhema is open-source
// software for churches — getting cited by AI engines (ChatGPT, Perplexity,
// Claude, Gemini, Copilot) is *the* discovery mechanism, so we welcome them.
//
// Source of truth: Cloudflare AI Crawl Control bot reference + each operator's
// own documentation (OpenAI, Anthropic, Perplexity, Google, etc.).
//
// User agents are matched case-insensitively per RFC 9309, but we use the
// canonical casing each vendor publishes.

const TRADITIONAL_SEARCH = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "YandexBot",
  "Applebot",
];

const AI_TRAINING = [
  "GPTBot", // OpenAI training
  "Google-Extended", // Gemini / Bard training
  "Google-CloudVertexBot", // Vertex AI
  "ClaudeBot", // Anthropic training
  "anthropic-ai", // legacy Anthropic, harmless to keep
  "Applebot-Extended", // Apple AI training
  "Meta-ExternalAgent", // Meta AI training
  "FacebookBot", // Meta general
  "Amazonbot", // Amazon
  "Bytespider", // ByteDance
  "CCBot", // Common Crawl (used by many models)
  "Cohere-AI", // Cohere training
  "Diffbot", // Diffbot data extraction
];

const AI_SEARCH_INDEX = [
  "OAI-SearchBot", // ChatGPT search index
  "Claude-SearchBot", // Claude search index
  "PerplexityBot", // Perplexity index
  "DuckAssistBot", // DuckDuckGo AI search
  "Meta-ExternalFetcher", // Meta AI fetcher
];

const AI_USER_INITIATED = [
  "ChatGPT-User", // ChatGPT browsing on user prompt
  "OAI-AdsBot", // OpenAI ads validation
  "Claude-User", // Claude user-initiated fetch
  "Claude-Web", // legacy, harmless to keep
  "Perplexity-User", // Perplexity user-initiated
  "MistralAI-User", // Mistral Le Chat
];

export default function robots(): MetadataRoute.Robots {
  const allowed = [
    ...TRADITIONAL_SEARCH,
    ...AI_TRAINING,
    ...AI_SEARCH_INDEX,
    ...AI_USER_INITIATED,
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...allowed.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
