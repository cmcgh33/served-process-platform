export function privacyServerName(fullName: string | null | undefined): string {
  if (!fullName) return "Your Process Server";
  const trimmed = fullName.trim();
  if (!trimmed || trimmed.includes("@")) return "Your Process Server";
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return "Your Process Server";
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial}.`;
}
