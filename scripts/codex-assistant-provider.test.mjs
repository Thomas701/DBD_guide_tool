import assert from "node:assert/strict";
import test from "node:test";

import { isSecurityChallenge } from "./chatgpt-browser-provider.mjs";
import { lastAgentMessage } from "./codex-assistant-provider.mjs";

test("extrait le dernier message assistant du flux JSONL Codex", () => {
  const output = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Première réponse" } }),
    JSON.stringify({ type: "turn.completed" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Réponse finale" } })
  ].join("\n");

  assert.equal(lastAgentMessage(output), "Réponse finale");
});

test("détecte la vérification de sécurité française de Cloudflare", () => {
  assert.equal(isSecurityChallenge("auth.openai.com\nVérification de sécurité en cours\nVérifiez que vous êtes humain"), true);
  assert.equal(isSecurityChallenge("ChatGPT\nComment puis-je vous aider ?"), false);
});
