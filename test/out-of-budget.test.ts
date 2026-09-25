/**
 * A turn whose thinking consumes the whole output budget ends at max_tokens
 * with no reply and no tool call. It must not vanish: the agent gets a quiet
 * (non-waking) note, and the host log says so. (Fable, 2026-09-25.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentBlock } from '@animalabs/membrane';
import { AgentFramework } from '../src/index.js';
import type { Module, ProcessEvent, EventResponse, ToolDefinition, ToolResult } from '../src/index.js';
import { MockMembrane, createMockResponse } from './helpers/mock-membrane.js';

class WakeModule implements Module {
  readonly name = 'waker';
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getTools(): ToolDefinition[] { return []; }
  async handleToolCall(): Promise<ToolResult> { return { success: false, error: 'none', isError: true }; }
  async onProcess(event: ProcessEvent): Promise<EventResponse> {
    if (event.type !== 'external-message') return {};
    return { addMessages: [{ participant: 'Ian', content: [{ type: 'text', text: 'hello' }] }], requestInference: true };
  }
}

async function runTurn(response: ReturnType<typeof createMockResponse>) {
  const dir = mkdtempSync(join(tmpdir(), 'out-of-budget-'));
  const membrane = new MockMembrane();
  membrane.pushResponse(response);
  const framework = await AgentFramework.create({
    storePath: join(dir, 'store'),
    membrane: membrane.asMembrane(),
    agents: [{ name: 'Fable', model: 'test-model', systemPrompt: 'test', maxTokens: 16384 }],
    modules: [new WakeModule()],
  });
  framework.pushEvent({ type: 'external-message', source: 'test', content: 'go', metadata: {} } as unknown as ProcessEvent);
  await (framework as unknown as { runUntilIdle(): Promise<void> }).runUntilIdle();
  const messages = framework.getAgent('Fable')!.getContextManager().getAllMessages() as Array<{
    content: Array<{ type: string; text?: string }>; metadata?: Record<string, unknown>;
  }>;
  const calls = membrane.calls.length;
  await framework.stop();
  rmSync(dir, { recursive: true, force: true });
  return { messages, calls };
}

test('thinking to max_tokens with no reply leaves a quiet out-of-budget note', async () => {
  const { messages, calls } = await runTurn(createMockResponse(
    [{ type: 'thinking', thinking: 'on and on', signature: 'sig' }] as unknown as ContentBlock[],
    'max_tokens',
  ));
  const note = messages.find((m) => m.metadata?.kind === 'out-of-budget');
  assert.ok(note, 'the agent is told');
  assert.match(note!.content[0]!.text ?? '', /used its whole output budget while thinking.*nothing was sent/);
  assert.equal(calls, 1, 'the note does not wake the agent');
});

test('max_tokens after visible text: no note (the reply was truncated, not absent)', async () => {
  const { messages } = await runTurn(createMockResponse(
    [{ type: 'text', text: 'a long answer that got cut' }] as unknown as ContentBlock[],
    'max_tokens',
  ));
  assert.equal(messages.find((m) => m.metadata?.kind === 'out-of-budget'), undefined);
});

test('an ordinary end_turn: no note', async () => {
  const { messages } = await runTurn(createMockResponse([{ type: 'text', text: 'hi' }] as unknown as ContentBlock[]));
  assert.equal(messages.find((m) => m.metadata?.kind === 'out-of-budget'), undefined);
});
