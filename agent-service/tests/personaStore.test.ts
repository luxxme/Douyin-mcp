import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractContactName,
  PersonaStore,
} from "../src/persona/personaStore.js";

test("extracts Chinese and YAML-style Douyin nicknames", () => {
  assert.equal(extractContactName("# 好友\n抖音昵称：🌈陈皮皮"), "🌈陈皮皮");
  assert.equal(extractContactName('---\ndouyin_nickname: "小e"\n---'), "小e");
});

test("loads global and exact per-contact Markdown profiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "douyin-persona-"));
  const contacts = join(directory, "contacts");
  mkdirSync(contacts);
  writeFileSync(join(directory, "global.md"), "全局口吻：简短", "utf8");
  writeFileSync(
    join(contacts, "friendly-name.md"),
    "抖音昵称：🌈陈皮皮\n关系：朋友",
    "utf8",
  );

  try {
    const persona = new PersonaStore(directory).load("🌈陈皮皮");
    assert.equal(persona.globalProfile, "全局口吻：简短");
    assert.match(persona.contactProfile ?? "", /关系：朋友/);
    assert.match(persona.contactProfilePath ?? "", /friendly-name\.md$/);
    assert.equal(new PersonaStore(directory).load("其他人").contactProfile, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
