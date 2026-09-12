export type ContactDecision = {
  allowed: boolean;
  reason: "blocked" | "allowlisted" | "allow_all" | "not_allowed";
};

export class ContactPolicy {
  private readonly allowedNames: Set<string>;
  private readonly blockedNames: Set<string>;

  constructor(
    allowlist: readonly string[],
    blocklist: readonly string[],
    private readonly allowAll: boolean,
  ) {
    this.allowedNames = new Set(allowlist);
    this.blockedNames = new Set(blocklist);
  }

  decide(nickname: string): ContactDecision {
    if (this.blockedNames.has(nickname)) {
      return { allowed: false, reason: "blocked" };
    }
    if (this.allowedNames.has(nickname)) {
      return { allowed: true, reason: "allowlisted" };
    }
    if (this.allowAll) {
      return { allowed: true, reason: "allow_all" };
    }
    return { allowed: false, reason: "not_allowed" };
  }
}
