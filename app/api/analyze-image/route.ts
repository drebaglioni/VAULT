import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseServerClient";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { imageUrl, photoId } = await req.json();

    if (!imageUrl || !photoId) {
      return new Response("Missing imageUrl or photoId", { status: 400 });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-5.1",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Respond ONLY with JSON:
{
  "caption": string,
  "tags": string[],
  "colors": string[],
  "content_type": "fashion" | "food" | "interior" | "art" | "landscape" | "screenshot" | "people" | "object" | "meme",
  "domain_tags": string[],
  "has_people": boolean,
  "people_count": number,
  "is_screenshot": boolean,
  "vibe_tags": string[]
}

Guidance:
- Only use "fashion" if clothing or outfits are a primary subject.
- Use "screenshot" when there is obvious UI/app/browser chrome.
- Prefer 1-3 vibe_tags chosen from: ["cozy","minimal","brutalist","retro","streetwear","sporty","luxury","analog","cinematic","playful","serious","techy"].
- Prefer 3-8 domain_tags that describe what is in the image (e.g. outfit, sneakers, jersey, runway, mirror selfie).
- Keep arrays small and focused. Avoid null; use empty arrays/strings/false when absent.
- Output valid JSON only.
              `,
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0].message.content;
    const parsed = content ? JSON.parse(content) : {};
    const caption = parsed.caption ?? "";
    const tags = parsed.tags ?? [];
    const colors = parsed.colors ?? [];
    const content_type = parsed.content_type ?? "";
    const domain_tags = parsed.domain_tags ?? [];
    const has_people = parsed.has_people ?? false;
    const people_count = parsed.people_count ?? 0;
    const is_screenshot = parsed.is_screenshot ?? false;
    const vibe_tags = parsed.vibe_tags ?? [];

    const description = `
Caption: ${caption || ""}
Content type: ${content_type || ""}
Domain tags: ${(domain_tags || []).join(", ")}
Vibes: ${(vibe_tags || []).join(", ")}
Tags: ${(tags || []).join(", ")}
Colors: ${(colors || []).join(", ")}
Has people: ${has_people ? `yes (${people_count || 0})` : "no"}
Is screenshot: ${is_screenshot ? "yes" : "no"}
    `.trim();

    let embedding: number[] | null = null;

    try {
      const embedRes = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: description,
      });
      embedding = embedRes.data?.[0]?.embedding ?? null;
    } catch (err) {
      console.error("embedding error:", err);
    }

    const { error: updateError } = await supabaseAdmin
      .from("photos")
      .update({
        caption,
        tags,
        colors,
        content_type,
        domain_tags,
        has_people,
        people_count,
        is_screenshot,
        vibe_tags,
        embedding,
      })
      .eq("id", photoId);

    if (updateError) {
      console.error("supabase update error:", updateError);
    }

    return Response.json({
      caption,
      tags,
      colors,
      content_type,
      domain_tags,
      has_people,
      people_count,
      is_screenshot,
      vibe_tags,
      embedding,
    });
  } catch (err) {
    console.error("analyze-image error:", err);
    return new Response("Error analyzing image", { status: 500 });
  }
}
