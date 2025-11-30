// Token allowlist for extension/API access. Add entries with the user's token and ownerId.
export const tokenOwners: { token: string; ownerId: string }[] = [
  { token: 'kb2RJVeoF_7fY-zK4ZUv-DG', ownerId: '8694ca67-e244-4ad3-b5f0-9d8ac6551e92' },
  { token: 'RVmm-LL2kQcT6fHGPXb4ui@', ownerId: '6cf55fd2-64f7-41ee-af7e-e37019119bfb' },
];

export function ownerIdForToken(token?: string | null): string | null {
  if (!token) return null;
  const found = tokenOwners.find(
    (entry) => entry.token.trim().toLowerCase() === token.trim().toLowerCase(),
  );
  return found ? found.ownerId : null;
}
