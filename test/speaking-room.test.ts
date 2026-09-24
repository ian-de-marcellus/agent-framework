/**
 * Sticky speaking room (AgentConfig.speakingRoom): a resident's ordinary
 * speech lands in its chosen room every turn; only its own channel_focus /
 * channel_open moves it, and the choice survives restarts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFramework } from '../src/framework.js';

const idleMembrane = {} as unknown as import('@animalabs/membrane').Membrane;

async function make(storePath: string, agents: Array<{ name: string; speakingRoom?: { initialChannel: string } }>) {
  return AgentFramework.create({
    storePath,
    membrane: idleMembrane,
    agents: agents.map((a) => ({ model: 'test-model', systemPrompt: 'test', ...a })),
    modules: [],
    syncIntervalMs: 0,
    maintenanceIntervalMs: 0,
  });
}

describe('sticky speaking room', () => {
  it('seeds from initialChannel, persists changes, and reloads them after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-speaking-room-'));
    const store = join(dir, 'store');
    try {
      let fw = await make(store, [{ name: 'resident', speakingRoom: { initialChannel: 'discord:g:salon' } }]);
      assert.equal(fw.getSpeakingRoom('resident'), 'discord:g:salon');
      (fw as unknown as { setSpeakingRoom(a: string, c: string): void }).setSpeakingRoom('resident', 'discord:g:library');
      await fw.stop();

      fw = await make(store, [{ name: 'resident', speakingRoom: { initialChannel: 'discord:g:salon' } }]);
      assert.equal(fw.getSpeakingRoom('resident'), 'discord:g:library', 'the resident’s own move survives restart');
      await fw.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates the room from the retired attention sidecar once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-speaking-room-migrate-'));
    const store = join(dir, 'store');
    // An existing store from before the migration (no speaking-rooms.json yet).
    await (await make(store, [{ name: 'resident' }])).stop();
    writeFileSync(join(store, 'attention-queue.json'), JSON.stringify({
      version: 1,
      residents: { resident: { mode: 'live', speakingChannel: 'discord:g:hearthside', drainAll: false, envelopes: [] } },
    }));
    try {
      const fw = await make(store, [{ name: 'resident', speakingRoom: { initialChannel: 'discord:g:salon' } }]);
      assert.equal(fw.getSpeakingRoom('resident'), 'discord:g:hearthside');
      const saved = JSON.parse(readFileSync(join(store, 'speaking-rooms.json'), 'utf8'));
      assert.deepEqual(saved.rooms, { resident: 'discord:g:hearthside' });
      await fw.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('agents without speakingRoom keep upstream locus behavior', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-speaking-room-none-'));
    try {
      const fw = await make(join(dir, 'store'), [{ name: 'plain' }]);
      assert.equal(fw.getSpeakingRoom('plain'), null);
      await fw.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
