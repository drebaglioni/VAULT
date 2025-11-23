import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseServerClient";

type Photo = {
  id: string;
  image_url: string;
  created_at: string;
  caption?: string | null;
  tags?: string[] | null;
  colors?: string[] | null;
  embedding?: number[] | null;
};

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { query, ownerId } = await req.json();
    const text = (query || "").trim();

    if (!text) {
      return new Response("Missing query", { status: 400 });
    }

    if (!ownerId) {
      return new Response("Missing ownerId", { status: 400 });
    }

    const embedRes = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    const queryEmbedding = embedRes.data?.[0]?.embedding;
    if (!queryEmbedding) {
      return new Response("Embedding failed", { status: 500 });
    }

    const { data, error } = await supabaseAdmin
      .from("photos")
      .select("*")
      .eq("owner_id", ownerId);
    if (error) {
      console.error("Supabase fetch error:", error);
      return new Response("Error fetching photos", { status: 500 });
    }

    const scored =
      data
        ?.filter((p: Photo) => Array.isArray(p.embedding))
        .map((p: Photo) => ({
          photo: p,
          score: cosineSimilarity(queryEmbedding, p.embedding as number[]),
        })) ?? [];

    const MIN_SCORE = 0.28;
    const MAX_RESULTS = 40;

    const top = scored
      .filter((s) => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((s) => s.photo);

    return Response.json({ photos: top });
  } catch (err) {
    console.error("semantic-search error:", err);
    return new Response("Error performing semantic search", { status: 500 });
  }
}
