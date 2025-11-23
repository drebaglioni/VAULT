'use client';

import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type TaggablePhoto = {
  id: string;
  tags?: string[] | null;
};

export default function TagEditor({
  photo,
  ownerId,
  onChange,
}: {
  photo: TaggablePhoto;
  ownerId: string;
  onChange?: (tags: string[] | null, embedding?: number[] | null) => void;
}) {
  const [tags, setTags] = useState<string[]>(photo.tags ?? []);
  const [input, setInput] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTags(photo.tags ?? []);
  }, [photo]);

  const persistTags = async (next: string[] | null) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('photos')
        .update({ tags: next })
        .eq('id', photo.id)
        .eq('owner_id', ownerId);
      if (error) {
        console.error('Error updating tags:', error);
        alert('Error updating tags');
        return;
      }

      let embedding: number[] | null | undefined = undefined;
      try {
        const res = await fetch('/api/reembed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: photo.id }),
        });
        if (res.ok) {
          const json = await res.json();
          embedding = json.embedding ?? null;
        }
      } catch (err) {
        console.error('Reembed error:', err);
      }

      onChange?.(next, embedding);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (!value) return;

    const newTags = [...tags, value.toLowerCase()];
    setTags(newTags);
    setInput('');
    await persistTags(newTags);
  };

  const handleRemove = async (tag: string) => {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    await persistTags(newTags.length ? newTags : null);
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline',
              marginRight: 10,
              fontSize: 11,
              color: hovered === tag ? '#c00000' : '#000',
              cursor: 'pointer',
              textDecoration: hovered === tag ? 'underline' : 'none',
              textDecorationColor: hovered === tag ? 'var(--accent)' : 'transparent',
              borderBottom: '1px solid transparent',
              transition: 'none',
            }}
            onMouseEnter={() => setHovered(tag)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleRemove(tag)}
            role="button"
            tabIndex={0}
          >
            {tag} {hovered === tag ? '×' : ''}
          </span>
        ))}
      </div>

      <form onSubmit={handleAdd}>
        <input
          type="text"
          value={input}
          placeholder="Add a tag…"
          onChange={(e) => setInput(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 0,
            border: '1px solid #000',
            fontSize: 12,
            background: '#f7f7f7',
            boxShadow: 'none',
            outline: 'none',
          }}
          disabled={saving}
        />
      </form>
    </div>
  );
}
