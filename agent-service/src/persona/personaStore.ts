import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_PROFILE_CHARACTERS = 20_000;

export type PersonaBundle = {
  contactName: string;
  globalProfile: string | null;
  contactProfile: string | null;
  contactProfilePath: string | null;
};

function readMarkdown(path: string): string | null {
  try {
    const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim();
    if (!content) return null;
    if (content.length > MAX_PROFILE_CHARACTERS) {
      throw new Error(
        `Persona file is too large: ${path} (${content.length} characters, max ${MAX_PROFILE_CHARACTERS})`,
      );
    }
    return content;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

export function normalizeContactName(value: string): string {
  return value.trim().normalize("NFC");
}

export function extractContactName(markdown: string): string | null {
  const patterns = [
    /^\s*抖音昵称\s*[:：]\s*(.+?)\s*$/mu,
    /^\s*douyin_nickname\s*:\s*(.+?)\s*$/imu,
  ];
  for (const pattern of patterns) {
    const match = markdown.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const unquoted = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)'|`([\s\S]*)`)$/, "$1$2$3");
    const normalized = normalizeContactName(unquoted);
    if (normalized) return normalized;
  }
  return null;
}

export class PersonaStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  load(contactName: string): PersonaBundle {
    const normalizedContact = normalizeContactName(contactName);
    const globalProfile = readMarkdown(join(this.directory, "global.md"));
    const contactsDirectory = join(this.directory, "contacts");
    const matchingProfiles: Array<{ content: string; path: string }> = [];

    let entries: string[] = [];
    try {
      entries = readdirSync(contactsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT") throw error;
    }

    for (const filename of entries) {
      const profilePath = join(contactsDirectory, filename);
      const content = readMarkdown(profilePath);
      if (!content) continue;
      const configuredName = extractContactName(content);
      if (configuredName === normalizedContact) {
        matchingProfiles.push({ content, path: profilePath });
      }
    }

    if (matchingProfiles.length > 1) {
      throw new Error(
        `Multiple persona files match Douyin contact "${contactName}": ${matchingProfiles
          .map((profile) => profile.path)
          .join(", ")}`,
      );
    }

    const contactProfile = matchingProfiles[0] ?? null;
    return {
      contactName: normalizedContact,
      globalProfile,
      contactProfile: contactProfile?.content ?? null,
      contactProfilePath: contactProfile?.path ?? null,
    };
  }
}
