import { invoke } from "@tauri-apps/api/core";

import {
  saveCachedHistorySearchIndex,
  type HistorySearchChunk,
} from "./devChatHistoryContext";
import type { AppSettings } from "./store";

interface EmbedTextResponse {
  embeddings: number[][];
}

interface HistoryEmbeddingBackend {
  endpoint: string;
  model: string;
  apiKey: string;
}

interface EnsureHistoryEmbeddingsOptions {
  maxChunks?: number;
}

const DEFAULT_HISTORY_EMBEDDING_MODEL = "text-embedding-3-small";
const HISTORY_EMBEDDING_BATCH_SIZE = 16;

function isLocalEndpoint(endpoint: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(endpoint);
}

function isBundledLocalRuntime(endpoint: string): boolean {
  const match = endpoint.match(/:(\d{4,5})(?:\/|$)/);
  if (!match) return false;
  const port = Number(match[1]);
  return port === 8011 || (port >= 18200 && port <= 18249);
}

function resolveHistoryEmbeddingBackend(settings: AppSettings): HistoryEmbeddingBackend | null {
  const endpoint = settings.llmEndpoint?.trim() ?? "";
  const apiKey = (settings.llmApiKey?.trim() || settings.apiKey?.trim()) ?? "";

  if (endpoint) {
    const isLocal = isLocalEndpoint(endpoint);
    if (isLocal && isBundledLocalRuntime(endpoint)) {
      return null;
    }
    if (!isLocal && !apiKey) {
      return null;
    }

    return {
      endpoint,
      model: DEFAULT_HISTORY_EMBEDDING_MODEL,
      apiKey,
    };
  }

  if (settings.useOwnKey && apiKey) {
    return {
      endpoint: "",
      model: DEFAULT_HISTORY_EMBEDDING_MODEL,
      apiKey,
    };
  }

  return null;
}

function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number");
}

async function embedTexts(
  texts: string[],
  backend: HistoryEmbeddingBackend,
): Promise<number[][]> {
  const response = await invoke<EmbedTextResponse>("embed_text", {
    req: {
      input: texts,
      endpoint: backend.endpoint || null,
      model: backend.model,
      api_key: backend.apiKey || null,
      dimensions: null,
    },
  });

  return response.embeddings.filter(validEmbedding);
}

export async function embedHistoryQuery(
  query: string,
  settings: AppSettings,
): Promise<number[] | undefined> {
  const backend = resolveHistoryEmbeddingBackend(settings);
  if (!backend) return undefined;

  try {
    const [embedding] = await embedTexts([query], backend);
    return embedding;
  } catch {
    return undefined;
  }
}

export async function ensureHistorySearchEmbeddings(
  index: HistorySearchChunk[],
  settings: AppSettings,
  options: EnsureHistoryEmbeddingsOptions = {},
): Promise<HistorySearchChunk[]> {
  if (typeof indexedDB === "undefined") {
    return index;
  }

  const backend = resolveHistoryEmbeddingBackend(settings);
  if (!backend) {
    return index;
  }

  const missing = index.filter((chunk) => !validEmbedding(chunk.embedding));
  const target = options.maxChunks ? missing.slice(0, options.maxChunks) : missing;
  if (target.length === 0) {
    return index;
  }

  const embeddingByChunkId = new Map<string, number[]>();

  try {
    for (let start = 0; start < target.length; start += HISTORY_EMBEDDING_BATCH_SIZE) {
      const batch = target.slice(start, start + HISTORY_EMBEDDING_BATCH_SIZE);
      const embeddings = await embedTexts(batch.map((chunk) => chunk.text), backend);
      if (embeddings.length !== batch.length) {
        return index;
      }

      for (const [offset, chunk] of batch.entries()) {
        const embedding = embeddings[offset];
        if (embedding) {
          embeddingByChunkId.set(chunk.chunkId, embedding);
        }
      }
    }
  } catch {
    return index;
  }

  if (embeddingByChunkId.size === 0) {
    return index;
  }

  const next = index.map((chunk) => {
    const embedding = embeddingByChunkId.get(chunk.chunkId);
    return embedding ? { ...chunk, embedding } : chunk;
  });
  await saveCachedHistorySearchIndex(next);
  return next;
}
