// Allowed emails for magic-link sign-in. Edit this list to approve new users.
export const allowedEmails = [
  'gbaglioni93@gmail.com', 'dre.baglioni@gmail.com'
];

export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return allowedEmails.map((e) => e.toLowerCase()).includes(normalized);
}
