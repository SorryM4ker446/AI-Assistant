import { z } from "zod";
import { ApiError } from "@/lib/server/api-error";

export const webSearchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(10).optional().default(5),
});

export type WebSearchInput = z.infer<typeof webSearchInput>;

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  score: number | null;
  source: "tavily";
};

export type WebSearchOutput = {
  query: string;
  results: WebSearchResultItem[];
  responseTime?: number;
  requestId?: string;
};

const TAVILY_SEARCH_URL = process.env.TAVILY_SEARCH_URL?.trim() || "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 12_000;

type TavilySearchResponse = {
  query?: string;
  response_time?: number;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
};

function normalizeSnippet(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function runWebSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "TAVILY_API_KEY is not configured.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: input.query.trim(),
        max_results: input.maxResults ?? 5,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError({
        code: "TIMEOUT",
        message: "Tavily search timed out.",
      });
    }

    throw new ApiError({
      code: "UPSTREAM_FAILED",
      message: "Failed to reach Tavily search.",
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;

  if (!response.ok) {
    const detailText = await response.text().catch(() => "");
    throw new ApiError({
      code: response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "UPSTREAM_FAILED",
      message: response.status === 401 || response.status === 403
        ? "Tavily search is not authorized."
        : "Tavily search failed.",
      status: response.status === 401 || response.status === 403 ? 401 : 502,
      details: {
        status: response.status,
        requestId,
        body: detailText.slice(0, 500),
      },
    });
  }

  const payload = (await response.json()) as TavilySearchResponse;
  const results = (payload.results ?? [])
    .filter((item) => item.url && item.title)
    .slice(0, input.maxResults ?? 5)
    .map((item) => ({
      title: item.title?.trim() || item.url || "Untitled",
      url: item.url as string,
      snippet: normalizeSnippet(item.content),
      score: typeof item.score === "number" ? Number(item.score.toFixed(3)) : null,
      source: "tavily" as const,
    }));

  return {
    query: payload.query?.trim() || input.query.trim(),
    results,
    ...(typeof payload.response_time === "number" ? { responseTime: payload.response_time } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
