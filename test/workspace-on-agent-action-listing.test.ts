/**
 * 'on-agent-action' mounts have no watcher. The option promised "sync from
 * filesystem after each agent tool call" but nothing implemented it: after the
 * one-time initial sync, files created outside the workspace tools (e.g. by a
 * resident's shell) never appeared in ls/glob/grep, while read_image — which
 * reads disk — could open them by exact path. Binary files (renders, scans)
 * were never listed at all, since the tree is text-only.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsStore } from '@animalabs/chronicle';
import { WorkspaceModule } from '../src/modules/workspace/index.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  'base64',
);

function setup(t: TestContext, watch: 'on-agent-action' | 'never') {
  const root = mkdtempSync(join(tmpdir(), 'af-oaa-listing-'));
  const mountDir = join(root, 'mount');
  mkdirSync(mountDir, { recursive: true });
  writeFileSync(join(mountDir, 'readme.md'), 'hello\n');
  const store = JsStore.openOrCreate({ path: join(root, 'ws.chronicle') });
  const workspace = new WorkspaceModule({
    mounts: [{ name: 'work', path: mountDir, mode: 'read-write', watch }],
  });
  workspace.initStore(store);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const call = async (name: string, input: Record<string, unknown>) => {
    const res = await workspace.handleToolCall({ id: `c-${name}`, name, input });
    assert.equal(res.isError, undefined, JSON.stringify(res));
    return res.data as Record<string, any>;
  };
  return { mountDir, call };
}

test('on-agent-action: ls/glob/grep see files a shell created after the first listing', async (t) => {
  const { mountDir, call } = setup(t, 'on-agent-action');

  // First access does the initial sync.
  assert.deepEqual((await call('ls', { path: 'work' })).entries, [{ name: 'readme.md', type: 'file' }]);

  // A shell creates a directory with a text manifest and a rendered image.
  mkdirSync(join(mountDir, 'renders'));
  writeFileSync(join(mountDir, 'renders', 'manifest.txt'), 'page-001.png\n');
  writeFileSync(join(mountDir, 'renders', 'page-001.png'), PNG);

  assert.deepEqual((await call('ls', { path: 'work' })).entries, [
    { name: 'readme.md', type: 'file' },
    { name: 'renders', type: 'directory' },
  ]);
  assert.deepEqual((await call('ls', { path: 'work/renders' })).entries, [
    { name: 'manifest.txt', type: 'file' },
    { name: 'page-001.png', type: 'file', binary: true },
  ]);
  assert.deepEqual((await call('glob', { pattern: '**/*.png' })).matches, ['work/renders/page-001.png']);
  const grep = await call('grep', { pattern: 'page-001' });
  assert.equal(JSON.stringify(grep).includes('renders/manifest.txt'), true, JSON.stringify(grep));

  // Deletions disappear too.
  unlinkSync(join(mountDir, 'renders', 'page-001.png'));
  unlinkSync(join(mountDir, 'renders', 'manifest.txt'));
  assert.deepEqual((await call('ls', { path: 'work/renders' })).entries, []);
});

test('on-agent-action: changed text content is re-read before grep', async (t) => {
  const { mountDir, call } = setup(t, 'on-agent-action');
  await call('ls', { path: 'work' });
  writeFileSync(join(mountDir, 'readme.md'), 'hello again, longer now\n');
  const grep = await call('grep', { pattern: 'again' });
  assert.equal(JSON.stringify(grep).includes('readme.md'), true, JSON.stringify(grep));
});

test("'never' mounts stay virtual: no re-read after the initial sync", async (t) => {
  const { mountDir, call } = setup(t, 'never');
  await call('ls', { path: 'work' });
  writeFileSync(join(mountDir, 'later.md'), 'x\n');
  assert.deepEqual((await call('ls', { path: 'work' })).entries, [{ name: 'readme.md', type: 'file' }]);
});
