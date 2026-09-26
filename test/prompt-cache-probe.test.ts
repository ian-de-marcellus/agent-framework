/**
 * Prompt-cache probe: the host tells the framework whether an agent's
 * provider cache is cold or warm; the agent hands that to a cache-aware
 * context strategy right before each inference compile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFramework } from '../src/framework.js';
import { MockMembrane, createMockResponse } from './helpers/mock-membrane.js';
import type { ContentBlock } from '@animalabs/membrane';
import type { Module, ProcessEvent, ProcessState, EventResponse } from '../src/types/index.js';

async function withFramework(fn: (fw: AgentFramework, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-cache-probe-'));
  const fw = await AgentFramework.create({
    storePath: join(dir, 'store'),
    membrane: new MockMembrane().asMembrane(),
    agents: [{ name: 'assistant', model: 'test-model', systemPrompt: 'test' }],
    modules: [],
  });
  try { await fn(fw, dir); } finally { await fw.stop(); rmSync(dir, { recursive: true, force: true }); }
}

function fakeStrategy(agent: unknown) {
  const seen: Array<string | undefined> = [];
  let deferred = false;
  const s = { setPromptCacheState: (x: 'cold' | 'warm' | undefined) => { seen.push(x); }, isRefoldDeferred: () => deferred };
  (agent as { getContextManager(): { getStrategy?: unknown } }).getContextManager().getStrategy = () => s;
  return { seen, setDeferred: (d: boolean) => { deferred = d; } };
}

test('the probe reaches the strategy through the agent; unknown when the probe throws', async () => {
  await withFramework(async (fw) => {
    const agent = fw.getAgent('assistant')! as unknown as { applyPromptCacheState(): void };
    const { seen, setDeferred } = fakeStrategy(agent);
    let state: 'cold' | 'warm' | undefined = 'cold';
    fw.setPromptCacheProbe((name) => { assert.equal(name, 'assistant'); if (state === undefined) throw new Error('x'); return state; });
    agent.applyPromptCacheState();
    state = 'warm';
    agent.applyPromptCacheState();
    state = undefined; // the probe throws → unknown
    agent.applyPromptCacheState();
    assert.deepEqual(seen, ['cold', 'warm', undefined]);
    assert.equal(fw.isRefoldDeferred('assistant'), false);
    setDeferred(true);
    assert.equal(fw.isRefoldDeferred('assistant'), true);
    assert.equal(fw.isRefoldDeferred('nobody'), false);
  });
});

test('no probe, or a strategy without the hook: nothing breaks', async () => {
  await withFramework(async (fw) => {
    const agent = fw.getAgent('assistant')! as unknown as { applyPromptCacheState(): void; promptCacheProbe?: unknown };
    agent.applyPromptCacheState(); // strategy may lack setPromptCacheState
    fw.setPromptCacheProbe(undefined);
    assert.equal(agent.promptCacheProbe, undefined);
    assert.equal(fw.isRefoldDeferred('assistant'), false);
  });
});

test('a real turn reads the probe before its inference compile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-cache-probe-turn-'));
  const membrane = new MockMembrane();
  membrane.pushResponse(createMockResponse([{ type: 'text', text: 'hi' }] as ContentBlock[]));
  const wake: Module = {
    name: 'wake',
    async start() {},
    async stop() {},
    getTools() { return []; },
    async handleToolCall() { return { success: false, error: 'none' }; },
    async onProcess(event: ProcessEvent, _s: ProcessState): Promise<EventResponse> {
      if (event.type !== 'external-message') return {};
      return { addMessages: [{ participant: 'Ian', content: [{ type: 'text', text: 'hello' }] }], requestInference: true };
    },
  } as unknown as Module;
  const fw = await AgentFramework.create({
    storePath: join(dir, 'store'), membrane: membrane.asMembrane(),
    agents: [{ name: 'assistant', model: 'test-model', systemPrompt: 'test' }], modules: [wake],
  });
  try {
    const { seen } = fakeStrategy(fw.getAgent('assistant')!);
    let asked = 0;
    fw.setPromptCacheProbe(() => { asked++; return 'cold'; });
    fw.pushEvent({ type: 'external-message', source: 'test', content: 'go', metadata: {} } as unknown as ProcessEvent);
    await fw.runUntilIdle();
    assert.ok(membrane.calls.length >= 1, 'a turn ran');
    assert.ok(asked >= 1 && seen.includes('cold'), `probe read before the compile (asked ${asked}, seen ${JSON.stringify(seen)})`);
  } finally {
    await fw.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
