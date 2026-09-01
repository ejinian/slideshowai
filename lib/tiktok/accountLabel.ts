// Pure + client-safe: how a connected TikTok account is named everywhere
// (picker rows, posted badges, schedule chips). @username beats the display
// name (it's what the creator recognizes); the open_id tail is the last-resort
// name for connections made before identity caching existed.

export interface AccountIdentity {
  displayName?: string | null;
  username?: string | null;
  openId: string;
}

export function accountLabel(a: AccountIdentity): string {
  if (a.username) return `@${a.username}`;
  if (a.displayName) return a.displayName;
  return `Account …${a.openId.slice(-4)}`;
}
