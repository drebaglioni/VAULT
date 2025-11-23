'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { isEmailAllowed } from '@/lib/allowedEmails';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        router.replace('/');
      }
    };
    checkSession();
  }, [router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    if (!isEmailAllowed(email)) {
      setStatus('idle');
      setError('This email is not approved for access.');
      return;
    }

    const redirectTo =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : undefined);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (signInError) {
      setError(signInError.message);
      setStatus('error');
      return;
    }

    setStatus('sent');
  };

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Your Vault</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            <span>EMAIL</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={styles.input}
            />
          </label>

          <button type="submit" disabled={status === 'sending'} className={styles.submit}>
            {status === 'sending' ? 'SENDING…' : 'SEND MAGIC LINK'}
          </button>
        </form>

        <div className={styles.footer}>
          {status === 'sent' && <span className={styles.success}>Check your email for the link.</span>}
          {error && <span className={styles.error}>{error}</span>}
          {status === 'idle' && (
            <span className={styles.hint}>We’ll send a one-time link to your inbox.</span>
          )}
        </div>
      </div>
    </main>
  );
}
