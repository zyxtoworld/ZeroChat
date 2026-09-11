import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mediaSource = await readFile(new URL("../src/media.rs", import.meta.url), "utf8");
const chatStateSource = await readFile(
  new URL("../src/app_state/chat_state.rs", import.meta.url),
  "utf8",
);
const messageActionsSource = await readFile(
  new URL("../src/message_actions.rs", import.meta.url),
  "utf8",
);

test("speech playback releases its player and temporary file after media errors", () => {
  assert.match(
    mediaSource,
    /player\.is_ended\(\)\s*\|\|\s*player\.error\(\)\.is_some\(\)/,
    "speech playback polling must treat GTK media errors as a terminal state",
  );
  assert.match(
    mediaSource,
    /finish_if_current\(&message_id, serial\)/,
    "terminal playback states must clear the current player and temporary file",
  );
});

test("assistant speech preflight binds the normalized Provider request before dispatch", () => {
  assert.match(chatStateSource, /fn provider_request_binding_from_snapshot\(/);
  assert.match(
    chatStateSource,
    /let request_provider = provider_request\(&provider, &snapshot\.sync\);[\s\S]*provider_needs_client_key\(&request_provider\)[\s\S]*provider_proxy_access_key\(&request_provider, cloudflare_access_key\)/,
  );
  assert.match(chatStateSource, /pub\(crate\) fn prepare_message_speech\(/);
  assert.match(
    chatStateSource,
    /let binding = self\.provider_request_binding\([\s\S]*model_for_provider_audio_speech\(&binding\.provider\)/,
  );
  assert.match(
    messageActionsSource,
    /state\.prepare_message_speech\(&message_id, locale\)[\s\S]*state\.begin_speaking_message\(&message_id\)[\s\S]*spawn_ai_speech_request\(request, sender\)/,
  );
  assert.doesNotMatch(messageActionsSource, /prepare_message_speech_request/);
});
