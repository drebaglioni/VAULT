// app/api/save-remote-photo/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseServerClient';
import { ownerIdForToken } from '@/lib/tokens';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const { imageUrl, sourceUrl, note, ownerId, token } = await req.json();

    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json(
        { error: 'imageUrl is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const resolvedOwner =
      typeof ownerId === 'string' && ownerId.trim().length > 0
        ? ownerId
        : ownerIdForToken(token);

    if (!resolvedOwner) {
      return NextResponse.json(
        { error: 'ownerId or valid token is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Download the image bytes
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      console.error('Failed to fetch remote image:', imageRes.status);
      return NextResponse.json(
        { error: 'Failed to fetch remote image' },
        { status: 400, headers: corsHeaders }
      );
    }

    const arrayBuffer = await imageRes.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // Guess a file extension from content-type if possible
    const contentType = imageRes.headers.get('content-type') || '';
    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    if (contentType.includes('webp')) ext = 'webp';
    if (contentType.includes('gif')) ext = 'gif';

    const fileName = `remote-${Date.now()}.${ext}`;

    // 2. Upload to Supabase storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('photos')
      .upload(fileName, bytes, {
        contentType: contentType || 'image/jpeg',
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Error uploading file to storage' },
        { status: 500, headers: corsHeaders }
      );
    }

    // 3. Get the public URL
    const { data: publicData } = supabaseAdmin.storage
      .from('photos')
      .getPublicUrl(fileName);

    const publicUrl = publicData.publicUrl;

    // 4. Insert initial row in photos table
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('photos')
      .insert({
        image_url: publicUrl,
        caption: note || null,
        source_url: sourceUrl || null,
        owner_id: resolvedOwner,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { error: 'Error inserting photo row' },
        { status: 500, headers: corsHeaders }
      );
    }

    const photoId = inserted.id;

    // 5. Call analyze-image to enrich with caption/tags/colors/embedding (wait for it)
    let enrichedPhoto = inserted;
    try {
      const host = req.headers.get('host');
      const forwardedProto = req.headers.get('x-forwarded-proto');
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        (host ? `${forwardedProto || 'http'}://${host}` : null) ||
        'http://localhost:3000';

      const analyzeUrl = new URL('/api/analyze-image', baseUrl).toString();

      const analyzeRes = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: publicUrl, photoId }),
      });

      if (analyzeRes.ok) {
        const {
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
        } = await analyzeRes.json();

        enrichedPhoto = {
          ...inserted,
          caption: note || caption || null,
          tags: tags ?? null,
          colors: colors ?? null,
          content_type: content_type ?? null,
          domain_tags: domain_tags ?? null,
          has_people: has_people ?? null,
          people_count: people_count ?? null,
          is_screenshot: is_screenshot ?? null,
          vibe_tags: vibe_tags ?? null,
          embedding: embedding ?? null,
        };
      } else {
        console.error('analyze-image API returned status', analyzeRes.status);
      }
    } catch (err) {
      console.error('Error calling analyze-image from save-remote:', err);
    }

    // Always try to persist enriched fields if we have them
    if (enrichedPhoto !== inserted) {
      const { caption, tags, colors, content_type, domain_tags, has_people, people_count, is_screenshot, vibe_tags, embedding } = enrichedPhoto;
      const { error: updateError } = await supabaseAdmin
        .from('photos')
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
        .eq('id', photoId);

      if (updateError) {
        console.error('Update error (enrich):', updateError);
      }
    }

    return NextResponse.json(
      { success: true, photo: enrichedPhoto },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('Error in /api/save-remote-photo:', err);
    return NextResponse.json(
      { error: 'Error saving remote photo' },
      { status: 500, headers: corsHeaders }
    );
  }
}
