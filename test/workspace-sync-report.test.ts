import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsStore } from '@animalabs/chronicle';
import { WorkspaceModule } from '../src/modules/workspace/index.js';

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'af-ws-sync-report-'));
  const mountDir = join(root, 'mount');
  mkdirSync(mountDir, { recursive: true });
  const store = JsStore.openOrCreate({ path: join(root, 'workspace.chronicle') });
  const workspace = new WorkspaceModule({
    mounts: [{ name: 'archive', path: mountDir, mode: 'read-write', watch: 'never' }],
  });
  workspace.initStore(store);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { mountDir, workspace };
}

test('sync keeps exact totals while bounding path detail output', async (t) => {
  const { mountDir, workspace } = setup(t);
  for (let i = 0; i < 180; i++) {
    writeFileSync(
      join(mountDir, `document-${String(i).padStart(3, '0')}-with-a-descriptive-name.txt`),
      `content ${i}`,
    );
  }

  const result = await workspace.handleToolCall({
    id: 'sync-large-mount',
    name: 'sync',
    input: { mount: 'archive', maxReportedItems: 10, maxReportedChars: 900 },
  });
  assert.equal(result.success, true, String(result.error));

  const data = result.data as {
    results: Array<{
      synced: string[];
      totalSynced: number;
      omittedSynced: number;
    }>;
    totalSynced: number;
    totalSkipped: number;
    report: { reportedItems: number; omittedItems: number; truncated: boolean };
    note?: string;
  };
  assert.equal(data.totalSynced, 180);
  assert.equal(data.totalSkipped, 0);
  assert.equal(data.results[0]?.totalSynced, 180);
  assert.equal(data.results[0]?.synced.length, 10);
  assert.equal(data.results[0]?.omittedSynced, 170);
  assert.equal(data.report.reportedItems, 10);
  assert.equal(data.report.omittedItems, 170);
  assert.equal(data.report.truncated, true);
  assert.match(data.note ?? '', /totals are exact/i);
  assert.ok(JSON.stringify(data).length < 2_500, 'bounded report stays comfortably below inline caps');
});

test('sync report limits reject values that could recreate an output flood', async (t) => {
  const { workspace } = setup(t);
  const result = await workspace.handleToolCall({
    id: 'sync-over-limit',
    name: 'sync',
    input: { mount: 'archive', maxReportedChars: 16_001 },
  });
  assert.equal(result.success, false);
  assert.equal(result.isError, true);
  assert.match(String(result.error), /maxReportedChars.*0 to 16000/);
});
