'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TagEditor from '../components/TagEditor';
import { supabase } from '../lib/supabaseClient';
import styles from './page.module.css';

type Photo = {
  id: string;
  image_url: string;
  created_at: string;
  storage_path?: string | null;
  source_url?: string | null;
  caption?: string | null;
  tags?: string[] | null;
  colors?: string[] | null;
  embedding?: number[] | null;
  content_type?: string | null;
  domain_tags?: string[] | null;
  has_people?: boolean | null;
  people_count?: number | null;
  is_screenshot?: boolean | null;
  vibe_tags?: string[] | null;
};

type Note = {
  id: string;
  body: string;
  created_at: string;
};

type FeedItem =
  | { kind: 'photo'; created_at: string; photo: Photo }
  | { kind: 'note'; created_at: string; note: Note };

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[al][bl];
}

function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / len;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function Home() {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [semanticPhotos, setSemanticPhotos] = useState<Photo[] | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [savingEditNote, setSavingEditNote] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pinnedNoteIds, setPinnedNoteIds] = useState<string[]>([]);
  const addPhotoIfNew = (photo: Photo) => {
    setPhotos((prev) => {
      if (prev.some((p) => p.id === photo.id)) return prev;
      return [photo, ...prev];
    });
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const latestCreatedAtRef = useRef<string | null>(null);
  const photosRef = useRef<Photo[]>([]);
  const dateFormatterShort = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [],
  );
  const dateFormatterLong = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('pv-theme') : null;
    if (saved === 'dark') {
      setIsDark(true);
    }

    if (typeof window !== 'undefined') {
      const storedPins = localStorage.getItem('pv-pinned-notes');
      if (storedPins) {
        try {
          setPinnedNoteIds(JSON.parse(storedPins));
        } catch {
          setPinnedNoteIds([]);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark-mode', isDark);
    localStorage.setItem('pv-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        const userId = data.session?.user?.id ?? null;
        setOwnerId(userId);
        setAuthChecked(true);
        if (!userId) {
          router.replace('/login');
        }
      })
      .catch((err) => {
        console.error('Auth check error:', err);
        setAuthChecked(true);
        router.replace('/login');
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      setOwnerId(userId);
      if (!userId) {
        router.replace('/login');
      }
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [router]);

  const sortedPhotos = useMemo(
    () =>
      [...photos].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [photos],
  );

  const searchQuery = search.trim();
  const searchLower = searchQuery.toLowerCase();
  const isNoteSearch = searchLower.startsWith('note:');
  const noteSearchQuery = isNoteSearch ? searchLower.replace(/^note:/, '').trim() : '';
  const isExactPhrase =
    searchQuery.length > 1 && searchQuery.startsWith('"') && searchQuery.endsWith('"');
  const exactTerm = isExactPhrase ? searchQuery.slice(1, -1).trim().toLowerCase() : '';

  const fuzzyMatches = useMemo(() => {
    const query = searchLower;
    if (isNoteSearch || isExactPhrase || query.length < 3) return [];

    const scored = sortedPhotos
      .map((photo) => {
        const tokens = [
          photo.caption ?? '',
          ...(photo.tags ?? []),
          ...(photo.colors ?? []),
          photo.content_type ?? '',
          ...(photo.domain_tags ?? []),
          ...(photo.vibe_tags ?? []),
          photo.has_people ? 'people' : '',
          photo.is_screenshot ? 'screenshot' : '',
        ].map((t) => t.toLowerCase());

        let best = 0;
        tokens.forEach((token) => {
          if (!token) return;
          if (token.includes(query)) {
            best = Math.max(best, 1);
          } else {
            best = Math.max(best, similarity(query, token));
          }
        });

        return { photo, score: best };
      })
      .filter((s) => s.score >= 0.42)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.photo);

    return scored;
  }, [isNoteSearch, searchLower, sortedPhotos]);

  const fallbackFiltered = useMemo(() => {
    const query = searchLower;
    if (!query) return sortedPhotos;
    if (isExactPhrase && !exactTerm) return sortedPhotos;

    const regex = isExactPhrase && exactTerm
      ? new RegExp(`\\b${escapeRegExp(exactTerm)}\\b`, 'i')
      : null;

    return sortedPhotos.filter((photo) => {
      const date = new Date(photo.created_at);
      const longDate = dateFormatterLong.format(date);
      const shortDate = dateFormatterShort.format(date);
      const haystack = [
        photo.caption ?? '',
        ...(photo.tags ?? []),
        ...(photo.colors ?? []),
        photo.content_type ?? '',
        ...(photo.domain_tags ?? []),
        ...(photo.vibe_tags ?? []),
        photo.has_people ? 'people' : '',
        photo.is_screenshot ? 'screenshot' : '',
        longDate,
        shortDate,
      ]
        .join(' ')
        .toLowerCase();

      if (regex) {
        return regex.test(haystack);
      }

      return haystack.includes(query);
    });
  }, [dateFormatterLong, dateFormatterShort, exactTerm, isExactPhrase, searchLower, sortedPhotos]);

  const hasSearch = Boolean(searchQuery);
  const noteSearchResults = useMemo(() => {
    if (!isNoteSearch) return [];
    if (!noteSearchQuery) return notes;
    const q = noteSearchQuery.toLowerCase();
    return notes
      .filter((n) => (n.body ?? '').toLowerCase().includes(q))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [isNoteSearch, noteSearchQuery, notes]);

  const isNotePinned = (id: string) => pinnedNoteIds.includes(id);

  const sortFeedItems = (items: FeedItem[]) =>
    items.sort((a, b) => {
      const aPinned = a.kind === 'note' && isNotePinned(a.note.id);
      const bPinned = b.kind === 'note' && isNotePinned(b.note.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const displayPhotos = useMemo(() => {
    if (!hasSearch || isNoteSearch) return sortedPhotos;
    if (isExactPhrase) {
      return fallbackFiltered.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    if (semanticPhotos && semanticPhotos.length) {
      return [...semanticPhotos].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    if (fuzzyMatches.length) {
      const ids = new Set<string>();
      const ordered: Photo[] = [];
      fuzzyMatches.forEach((p) => {
        if (!ids.has(p.id)) {
          ids.add(p.id);
          ordered.push(p);
        }
      });
      fallbackFiltered.forEach((p) => {
        if (!ids.has(p.id)) {
          ids.add(p.id);
          ordered.push(p);
        }
      });
      return ordered.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return fallbackFiltered.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [
    fallbackFiltered,
    fuzzyMatches,
    hasSearch,
    isExactPhrase,
    isNoteSearch,
    semanticPhotos,
    sortedPhotos,
  ]);

  const displayItems: FeedItem[] = useMemo(() => {
    if (hasSearch) {
      if (isNoteSearch) {
        return sortFeedItems(
          noteSearchResults.map((note) => ({
            kind: 'note' as const,
            created_at: note.created_at,
            note,
          })),
        );
      }
      return displayPhotos.map((photo) => ({
        kind: 'photo',
        created_at: photo.created_at,
        photo,
      }));
    }

    const items: FeedItem[] = [
      ...notes.map((note) => ({
        kind: 'note' as const,
        created_at: note.created_at,
        note,
      })),
      ...sortedPhotos.map((photo) => ({
        kind: 'photo' as const,
        created_at: photo.created_at,
        photo,
      })),
    ];

    return sortFeedItems(items);
  }, [displayPhotos, hasSearch, isNoteSearch, noteSearchResults, notes, sortFeedItems, sortedPhotos]);

  async function handleSaveNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = noteText.trim();
    if (!text) return;
    if (!ownerId) return;
    setSavingNote(true);
    try {
      const { data, error } = await supabase
        .from('notes')
        .insert({ body: text, owner_id: ownerId })
        .select()
        .single();
      if (error) {
        console.error('Error saving note:', error);
        alert('Error saving note (check Supabase "notes" table exists)');
        return;
      }
      if (data) {
        setNotes((prev) => [data as Note, ...prev]);
      }
      setNoteText('');
    } catch (err) {
      console.error('Note save error:', err);
      alert('Error saving note');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(note: Note) {
    if (!ownerId) return;
    try {
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', note.id)
        .eq('owner_id', ownerId);
      if (error) {
        console.error('Error deleting note:', error);
        alert('Error deleting note');
        return;
      }
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setPinnedNoteIds((prev) => {
        const next = prev.filter((id) => id !== note.id);
        if (typeof window !== 'undefined') {
          localStorage.setItem('pv-pinned-notes', JSON.stringify(next));
        }
        return next;
      });
      setSelectedNote((prev) => (prev?.id === note.id ? null : prev));
    } catch (err) {
      console.error('Delete note error:', err);
      alert('Error deleting note');
    }
  }

  const togglePinNote = (note: Note) => {
    setPinnedNoteIds((prev) => {
      const set = new Set(prev);
      if (set.has(note.id)) {
        set.delete(note.id);
      } else {
        set.add(note.id);
      }
      const next = Array.from(set);
      if (typeof window !== 'undefined') {
        localStorage.setItem('pv-pinned-notes', JSON.stringify(next));
      }
      return next;
    });
  };

  async function handleUpdateNote() {
    if (!selectedNote) return;
    const body = editNoteText.trim();
    if (!body) return;
    if (!ownerId) return;
    setSavingEditNote(true);
    try {
      const { data, error } = await supabase
        .from('notes')
        .update({ body })
        .eq('id', selectedNote.id)
        .eq('owner_id', ownerId)
        .select()
        .single();
      if (error) {
        console.error('Error updating note:', error);
        alert('Error updating note');
        return;
      }
      if (data) {
        setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? (data as Note) : n)));
        setSelectedNote(data as Note);
      }
    } catch (err) {
      console.error('Update note error:', err);
      alert('Error updating note');
    } finally {
      setSavingEditNote(false);
    }
  }

  useEffect(() => {
    if (!ownerId) return;
    setLoading(true);
    const loadPhotos = async () => {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .order('created_at', { ascending: false })
        .eq('owner_id', ownerId);

      if (error) {
        console.error('Error loading photos:', error);
      } else if (data) {
        const seen = new Set<string>();
        const unique = (data as Photo[]).filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        setPhotos(unique);
        if (data.length) {
          latestCreatedAtRef.current = data[0].created_at;
        }
      }
      setLoading(false);
    };

    loadPhotos();
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId) return;
    const loadNotes = async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('created_at', { ascending: false })
        .eq('owner_id', ownerId);

      if (error) {
        console.error('Error loading notes:', error);
      } else if (data) {
        setNotes(data as Note[]);
      }
    };

    loadNotes();
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId) return undefined;
    const channel = supabase
      .channel('photos-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'photos', filter: `owner_id=eq.${ownerId}` },
        (payload) => {
          const photo = payload.new as Photo;
          addPhotoIfNew(photo);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'photos', filter: `owner_id=eq.${ownerId}` },
        (payload) => {
          const updated = payload.new as Photo;
          setPhotos((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId]);

  useEffect(() => {
    if (photos.length) {
      latestCreatedAtRef.current = photos[0].created_at;
    }
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    const pollForEnrichment = async () => {
      if (!ownerId) return;
      const pending = photosRef.current.filter(
        (p) =>
          (!p.tags || p.tags.length === 0) &&
          (!p.caption || !p.caption.trim()),
      );
      if (!pending.length) return;

      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('owner_id', ownerId)
        .in(
          'id',
          pending.map((p) => p.id),
        );

      if (error) {
        console.error('Enrichment polling error:', error);
        return;
      }

      if (data && data.length) {
        const updates = new Map<string, Photo>();
        (data as Photo[]).forEach((p) => updates.set(p.id, p));

        setPhotos((prev) =>
          prev.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id)! } : p)),
        );
      }
    };

    const interval = setInterval(pollForEnrichment, 4000);
    return () => clearInterval(interval);
  }, [ownerId]);

  useEffect(() => {
    const pollForNew = async () => {
      if (!ownerId) return;
      if (document.visibilityState !== 'visible') return;
      const latest = latestCreatedAtRef.current;
      if (!latest) return;

      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .gt('created_at', latest)
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Polling error:', error);
        return;
      }

      if (data && data.length) {
        const existing = new Set(photosRef.current.map((p) => p.id));
        const newOnes = (data as Photo[]).filter((p) => !existing.has(p.id));
        if (newOnes.length) {
          setPhotos((prev) => [...newOnes, ...prev]);
        }
      }
    };

    const interval = setInterval(pollForNew, 4000);
    return () => clearInterval(interval);
  }, [ownerId]);

  useEffect(() => {
    const query = search.trim();
    if (!query || isNoteSearch || isExactPhrase || !ownerId) {
      setSemanticPhotos(null);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch('/api/semantic-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, ownerId }),
        });

        if (!res.ok) throw new Error('Semantic search failed');
        const json = await res.json();
        setSemanticPhotos(json.photos ?? null);
      } catch (err) {
        console.error('semantic search error:', err);
        setSemanticPhotos(null);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [isExactPhrase, isNoteSearch, ownerId, search]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.getAttribute('contenteditable') === 'true');

      if (isTypingTarget) return;

      if (event.key === '/') {
        event.preventDefault();
        setShowSearch(true);
      }

      if (event.key === '\\') {
        event.preventDefault();
        setShowSearch(false);
        setSearch('');
        setSemanticPhotos(null);
      }

      if (event.key === 'Escape') {
        setShowSearch(false);
        setSearch('');
        setSemanticPhotos(null);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFile(files[0], formRef.current);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      formRef.current?.requestSubmit();
    }
  };

  async function uploadFile(selectedFile: File, form?: HTMLFormElement | null) {
    if (!ownerId) {
      alert('You must be signed in to upload.');
      return;
    }
    setUploading(true);
    try {
      const storageFileName = `${Date.now()}-${selectedFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(storageFileName, selectedFile);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        alert('Error uploading file');
        return;
      }

      const { data: publicData } = supabase.storage
        .from('photos')
        .getPublicUrl(storageFileName);

      const publicUrl = publicData.publicUrl;

      const { data: inserted, error: insertError } = await supabase
        .from('photos')
        .insert({ image_url: publicUrl, storage_path: storageFileName, owner_id: ownerId })
        .select()
        .single();

      if (insertError || !inserted) {
        console.error('Insert error:', insertError);
        alert('Error saving photo record');
        return;
      }

      let updatedPhoto: Photo = inserted as Photo;

      try {
        const analyzeRes = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: publicUrl, photoId: updatedPhoto.id }),
        });

          if (analyzeRes.ok) {
            const json = await analyzeRes.json();
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
          } = json;

          updatedPhoto = {
            ...updatedPhoto,
            caption: caption ?? null,
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
          console.log('body:', await analyzeRes.text());
        }
      } catch (err) {
        console.error('Error calling analyze-image API:', err);
      }

      addPhotoIfNew(updatedPhoto);
    } finally {
      form?.reset();
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const selectedFile = fileInputRef.current?.files?.[0];
    if (!selectedFile) return;
    if (!ownerId) {
      alert('You must be signed in to upload.');
      return;
    }
    uploadFile(selectedFile, form);
  }

  async function handleDelete(photo: Photo) {
    if (!ownerId) return;
    try {
      const { error: deleteError } = await supabase
        .from('photos')
        .delete()
        .eq('id', photo.id)
        .eq('owner_id', ownerId);

      if (deleteError) {
        console.error('DB delete error:', deleteError);
        alert('Error deleting from database');
        return;
      }

      if (photo.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('photos')
          .remove([photo.storage_path]);

        if (storageError) {
          console.error('Storage delete error:', storageError);
          alert('Error deleting file from storage');
          return;
        }
      }

      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setSelectedPhoto((prev) => (prev?.id === photo.id ? null : prev));
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setOwnerId(null);
    router.replace('/login');
  };

  if (!authChecked) {
    return (
      <main className={styles.main}>
        <p className={styles.mutedText}>Checking session…</p>
      </main>
    );
  }

  if (authChecked && !ownerId) {
    return (
      <main className={styles.main}>
        <p className={styles.mutedText}>Redirecting to sign in…</p>
      </main>
    );
  }

  return (
    <main
      className={styles.main}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.container}>
        {showSearch && (
          <section className={styles.searchSection}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="SEARCH YOUR VAULT"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
          </section>
        )}

        <form ref={formRef} onSubmit={handleUpload} className={styles.uploadForm}>
          <input
            id="file-input"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <label
            htmlFor="file-input"
            className={`${styles.uploadButton} ${uploading ? styles.uploading : ''}`}
            title="Upload"
          >
            {uploading ? '+' : '+'}
          </label>

          <button type="submit" disabled={uploading} style={{ display: 'none' }} aria-hidden="true">
            Upload
          </button>
        </form>

        {loading ? (
          <p className={styles.mutedText}>Loading photos…</p>
        ) : displayPhotos.length === 0 ? (
          <p className={styles.mutedText}>No photos yet. Save something you like.</p>
        ) : (
          <div className={styles.grid}>
            {!hasSearch && (
              <div className={`${styles.card} ${styles.noteCard}`}>
                <form onSubmit={handleSaveNote} className={styles.noteForm}>
                  <div className={styles.noteLabel}>Notepad</div>
                  <textarea
                    className={styles.noteInput}
                    placeholder="Type a note…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={4}
                  />
                  <button
                    className={styles.noteSave}
                    type="submit"
                    disabled={savingNote || noteText.trim().length === 0}
                  >
                    {savingNote ? 'Saving…' : 'Save note'}
                  </button>
                </form>
              </div>
            )}

            {displayItems.map((item) => {
              if (item.kind === 'note') {
                const note = item.note;
                const pinned = isNotePinned(note.id);
                return (
                  <div
                    key={`note-${note.id}`}
                    className={`${styles.card} ${styles.noteCard}`}
                    onClick={() => {
                      setSelectedNote(note);
                      setEditNoteText(note.body);
                    }}
                  >
                    <div className={styles.noteActions}>
                      <button
                        type="button"
                        className={`${styles.notePin} ${pinned ? styles.notePinActive : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinNote(note);
                        }}
                        aria-label={pinned ? 'Unpin note' : 'Pin note'}
                      >
                        📌
                      </button>
                      <button
                        type="button"
                        className={styles.noteDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note);
                        }}
                        aria-label="Delete note"
                      >
                        ×
                      </button>
                    </div>
                    <div className={styles.noteBody}>{note.body}</div>
                    <div className={styles.noteDate}>
                      {dateFormatterShort.format(new Date(note.created_at))}
                    </div>
                  </div>
                );
              }

              const photo = item.photo;
              const isProcessing =
                !(photo.tags && photo.tags.length) &&
                !(photo.caption && photo.caption.trim());

              return (
                <div
                  key={photo.id}
                  className={styles.card}
                  style={{
                    border: 'none',
                    padding: 0,
                    marginTop: 0,
                  }}
                >
                  <div
                    className={styles.imageWrap}
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    {isProcessing && (
                      <div className={styles.processingBadge}>PROCESSING</div>
                    )}
                    <img
                      src={photo.image_url}
                      alt="Saved"
                      className={styles.cardImage}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className={styles.dateBadge}>
                      {dateFormatterShort.format(new Date(photo.created_at))}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(photo);
                      }}
                      className={styles.deleteButton}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isDragging && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropText}>Drop image to save</div>
        </div>
      )}

      <div className={styles.themeToggleFixed}>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={handleSignOut}
          style={{ marginBottom: '0.5cm' }}
        >
          SIGN OUT
        </button>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={() => setIsDark((prev) => !prev)}
        >
          {isDark ? 'LIGHT' : 'DARK'}
        </button>
      </div>

      {selectedPhoto && (
        <div className={styles.drawerOverlay} onClick={() => setSelectedPhoto(null)}>
          <div
            className={styles.drawerPanel}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className={styles.drawerBody}>
              <div className={styles.drawerImageWrap}>
                <img
                  src={selectedPhoto.image_url}
                  alt=""
                  className={styles.drawerImage}
                  loading="lazy"
                  decoding="async"
                />
                <button
                  className={styles.drawerClose}
                  type="button"
                  onClick={() => setSelectedPhoto(null)}
                  aria-label="Close details"
                >
                  ×
                </button>
              </div>

              <div className={styles.drawerDate}>
                {dateFormatterLong.format(new Date(selectedPhoto.created_at))}
              </div>

              {selectedPhoto.caption && (
                <div className={styles.drawerSection}>
                  <p className={styles.drawerCaption}>{selectedPhoto.caption}</p>
                </div>
              )}

              {selectedPhoto.colors && selectedPhoto.colors.length > 0 && (
                <div className={styles.drawerSection}>
                  <div className={styles.inlineList}>{selectedPhoto.colors.join(' ')}</div>
                </div>
              )}

              <div className={styles.drawerSection}>
                <TagEditor
                  photo={selectedPhoto}
                  ownerId={ownerId!}
                  onChange={(tags, embedding) => {
                    setPhotos((prev) =>
                      prev.map((p) =>
                        p.id === selectedPhoto.id ? { ...p, tags, embedding: embedding ?? p.embedding } : p,
                      ),
                    );
                    setSelectedPhoto((prev) => (prev ? { ...prev, tags, embedding: embedding ?? prev.embedding } : prev));
                  }}
                />
              </div>

              {selectedPhoto.source_url && (
                <div className={styles.drawerSection}>
                  <div className={styles.metaText}>Source</div>
                  <a
                    href={selectedPhoto.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.sourceLink}
                  >
                    {selectedPhoto.source_url}
                  </a>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {selectedNote && (
        <div className={styles.drawerOverlay} onClick={() => setSelectedNote(null)}>
          <div
            className={styles.drawerPanel}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className={styles.drawerBody}>
              <div className={styles.drawerDate}>
                {dateFormatterLong.format(new Date(selectedNote.created_at))}
              </div>

              <div className={styles.drawerSection}>
                <div className={styles.noteLabel}>Notepad</div>
                <textarea
                  className={styles.noteInput}
                  placeholder="Edit note (markdown supported)..."
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  rows={10}
                />
                <div className={styles.noteDrawerActions}>
                  <button
                    type="button"
                    className={styles.noteSave}
                    disabled={savingEditNote || !editNoteText.trim()}
                    onClick={handleUpdateNote}
                  >
                    {savingEditNote ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={styles.noteDelete}
                    onClick={() => handleDeleteNote(selectedNote)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
