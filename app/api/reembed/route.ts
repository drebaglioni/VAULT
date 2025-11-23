import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseServerClient";

type PhotoRow = {
  id: string;
  caption?: string | null;
  tags?: string[] | null;
  colors?: string[] | null;
};

function buildDescription(photo: PhotoRow) {
  return `
Caption: ${photo.caption || ""}
Tags: ${(photo.tags || []).join(", ")}
Colors: ${(photo.colors || []).join(", ")}
  `.trim();
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { photoId } = await req.json();
    if (!photoId) {
      return new Response("Missing photoId", { status: 400 });
    }

    const { data: photo, error: fetchError } = await supabaseAdmin
      .from("photos")
      .select("id, caption, tags, colors")
      .eq("id", photoId)
      .single();

    if (fetchError || !photo) {
      console.error("reembed fetch error:", fetchError);
      return new Response("Photo not found", { status: 404 });
    }

    const description = buildDescription(photo as PhotoRow);

    const embedRes = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: description,
    });

    const embedding = embedRes.data?.[0]?.embedding;
    if (!embedding) {
      return new Response("Embedding failed", { status: 500 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("photos")
      .update({ embedding })
      .eq("id", photoId);

    if (updateError) {
      console.error("reembed update error:", updateError);
      return new Response("Failed to save embedding", { status: 500 });
    }

    return Response.json({ embedding });
  } catch (err) {
    console.error("reembed error:", err);
    return new Response("Error re-embedding photo", { status: 500 });
  }
}
