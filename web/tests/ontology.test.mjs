import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan, selectedActions, selectedBytes, idForPath, defaultPolicy, exactGroups, similarGroups,
  selectAction, chooseKeeper, protectInPlan, approvalFor, approvalMatches, planDigest, assertManifest,
  validRecommendation, executeAction, snapshot, validPath, SIMILAR, localRecommendation } from '../src/ontology.mjs';
import { textHash } from '../src/hashing.mjs';

const scope = { id: 'scope-test', name: 'Test', mode: 'readwrite' };
const asset = (name, options = {}) => ({ id: idForPath(scope.id, [name]), scopeId: scope.id, path: [name], name,
  mime: 'image/jpeg', size: 1024, modified: 100, hash: textHash('identical'), width: 100, height: 100,
  sharpness: 3, protected: false, perceptualHash: null, ...options });
const planFor = (assets, options = {}) => compilePlan(scope, assets, { ...defaultPolicy, protectScreenshots: false, ...options });
const duplicates = () => [asset('a.jpg'), asset('b.jpg'), asset('c.jpg')];

test('exact duplicates count only removable copies and always keep a valid copy', () => {
  const plan = planFor(duplicates()); assert.equal(selectedActions(plan).length, 2); assert.equal(selectedBytes(plan), 2048);
  const targets = new Set(plan.actions.map(a => a.target.assetId));
  assert.ok(plan.actions.every(a => !targets.has(a.keeper.assetId)));
});
test('same size is not sufficient and malformed hashes are not evidence', () => {
  assert.equal(planFor([asset('a'), asset('b', { hash: textHash('different') })]).actions.length, 0);
  assert.equal(exactGroups([asset('a', { hash: null }), asset('b', { hash: null }), asset('c', { hash: 'bad' }), asset('d', { hash: 'bad' })]).length, 0);
});
test('protected files are never targets; screenshot policy preserves matching names', () => {
  const input = [asset('a', { protected: true }), asset('b', { protected: true }), asset('c')];
  const plan = planFor(input); assert.equal(plan.actions.length, 1); assert.equal(plan.actions[0].target.assetId, input[2].id);
  const screenshot = asset('Screenshot_001.png');
  const protectedPlan = compilePlan(scope, [screenshot, asset('other')], defaultPolicy);
  assert.equal(protectedPlan.actions[0].keeper.assetId, screenshot.id);
});
test('similar photos are unselected even with a high confidence model response', () => {
  const assets = [asset('a', { perceptualHash: '0000000000000000' }), asset('b', { hash: textHash('b'), perceptualHash: '0000000000000001' })];
  const group = similarGroups(assets)[0];
  const plan = compilePlan(scope, assets, defaultPolicy, new Map([[group.id, { decision: 'RECOMMEND_KEEPER', keeperAssetId: assets[0].id, confidence: .9999, source: 'jev-gateway' }]]));
  assert.equal(plan.actions[0].relation, SIMILAR); assert.equal(selectedActions(plan).length, 0);
});
test('similarity is checked against an anchor, not transitively', () => {
  const assets = [asset('a', { sharpness: 3, perceptualHash: '0000000000000000' }),
    asset('b', { sharpness: 2, hash: textHash('b'), perceptualHash: '000000000000003f' }),
    asset('c', { sharpness: 1, hash: textHash('c'), perceptualHash: '0000000000000fff' })];
  assert.deepEqual(similarGroups(assets).map(g => g.members.map(a => a.name)), [['a', 'b']]);
});
test('exact groups cannot participate in similarity keeper chains', () => {
  const assets = [asset('a', { perceptualHash: '0000000000000000' }), asset('b', { perceptualHash: '0000000000000000' }), asset('c', { hash: textHash('c'), perceptualHash: '0000000000000001' })];
  assert.equal(planFor(assets).actions.length, 1);
});
test('scope mismatches, duplicate IDs and traversal paths are rejected', () => {
  assert.throws(() => planFor([asset('a', { scopeId: 'other' })]));
  assert.throws(() => planFor([asset('a'), asset('a')]));
  for (const path of [[], ['..'], ['.'], ['a/b'], ['a\\b'], [''], ['a\0b']]) assert.equal(validPath(path), false);
  assert.throws(() => planFor([asset('a', { path: ['..', 'a'] })]));
});
test('model responses cannot reference outside files or invalid confidence', () => {
  const group = exactGroups(duplicates())[0];
  for (const confidence of [NaN, Infinity, -1, 1.01]) assert.equal(validRecommendation(group, { decision: 'RECOMMEND_KEEPER', keeperAssetId: group.members[0].id, confidence }), false);
  assert.equal(validRecommendation(group, { decision: 'RECOMMEND_KEEPER', keeperAssetId: 'outside', confidence: .99 }), false);
  assert.equal(validRecommendation(group, { decision: 'KEEP_ALL', keeperAssetId: group.members[0].id }), false);
});
test('manual keeper selection resets that group and respects protection', () => {
  const assets = [asset('a', { protected: true }), asset('b'), asset('c')], plan = planFor(assets);
  const changed = chooseKeeper(plan, plan.groups[0].id, assets[1].id);
  assert.equal(changed.version, 2); assert.equal(changed.actions.length, 1);
  assert.equal(changed.actions[0].target.assetId, assets[2].id); assert.equal(changed.actions[0].selected, false);
});
test('protection clears a selected action', () => {
  const plan = planFor(duplicates()), target = plan.actions[0].target.assetId;
  const changed = protectInPlan(plan, target, true);
  assert.ok(!selectedActions(changed).some(a => a.target.assetId === target)); assertManifest(changed);
});
test('approval binds selected actions, snapshot content and plan version', () => {
  const plan = planFor(duplicates()), approval = approvalFor(plan);
  assert.ok(approvalMatches({ ...plan, status: 'APPROVED' }, approval));
  assert.equal(approvalMatches(selectAction(plan, plan.actions[0].id, false), approval), false);
  assert.equal(approvalMatches({ ...plan, version: 2 }, approval), false);
  assert.equal(approvalMatches({ ...plan, actions: plan.actions.map(a => ({ ...a, target: { ...a.target, hash: textHash('changed') } })) }, approval), false);
});
test('read-only plans cannot be approved and approved plans cannot be edited', () => {
  const plan = planFor(duplicates());
  assert.throws(() => approvalFor({ ...plan, mode: 'readonly' }));
  assert.throws(() => selectAction({ ...plan, status: 'APPROVED' }, plan.actions[0].id, false));
});
test('recompilation creates independent action IDs and digest survives JSON serialization', () => {
  const a = planFor(duplicates()), b = planFor(duplicates());
  assert.notEqual(a.actions[0].id, b.actions[0].id); assert.equal(planDigest(a), planDigest(JSON.parse(JSON.stringify(a))));
});
test('manifest rejects fabricated evidence or a keeper also scheduled for deletion', () => {
  const plan = planFor(duplicates()), action = plan.actions[0];
  assert.throws(() => assertManifest({ ...plan, actions: [{ ...action, evidenceId: 'fake' }] }));
  assert.throws(() => assertManifest({ ...plan, actions: [action, { ...action, id: 'evil', target: action.keeper, keeper: action.target }] }));
});
test('KEEP_ALL from model produces no similar deletion candidates', () => {
  const assets = [asset('a', { perceptualHash: '0000000000000000' }), asset('b', { hash: textHash('b'), perceptualHash: '0000000000000001' })];
  const group = similarGroups(assets)[0];
  assert.equal(compilePlan(scope, assets, defaultPolicy, new Map([[group.id, { decision: 'KEEP_ALL', keeperAssetId: null, confidence: .8 }]])).actions.length, 0);
  assert.equal(localRecommendation(group).source, 'local-rules');
});

async function execution(change = () => {}) {
  const plan = { ...planFor(duplicates()), status: 'APPROVED' };
  const approval = { planId: plan.id, version: plan.version, digest: planDigest(plan) }, action = plan.actions[0];
  const records = new Map(), assets = new Map(plan.groups.flatMap(g => g.members).map(a => [a.id, snapshot(a)]));
  const files = { grant: true, protected: false, deleteCount: 0, unavailable: false,
    async hasGrant() { return this.grant; }, async isProtected() { return this.protected; },
    async inspect(snap) { return this.unavailable ? { state: 'unavailable', reason: 'provider unavailable' } : assets.has(snap.assetId) ? { state: 'present', snapshot: assets.get(snap.assetId) } : { state: 'missing' }; },
    async delete(snap) { this.deleteCount++; assets.delete(snap.assetId); },
  };
  const ledger = { async get(id) { return records.get(id); }, async put(result) { records.set(result.actionId, result); } };
  await change({ plan, approval, action, files, assets, records, ledger });
  return { result: await executeAction(plan, approval, action, files, ledger), files, assets, records, action };
}
test('successful deletion removes only a target and accounts for its logical bytes', async () => {
  const { result, files, assets, action } = await execution();
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.reclaimedBytes, 1024); assert.equal(files.deleteCount, 1);
  assert.ok(assets.has(action.keeper.assetId)); assert.ok(!assets.has(action.target.assetId));
});
for (const [label, mutate] of [
  ['changed target with same size', ({ assets, action }) => assets.set(action.target.assetId, { ...action.target, hash: textHash('edited') })],
  ['changed keeper', ({ assets, action }) => assets.set(action.keeper.assetId, { ...action.keeper, modified: 200 })],
  ['missing keeper', ({ assets, action }) => assets.delete(action.keeper.assetId)],
  ['revoked authorization', ({ files }) => { files.grant = false; }],
  ['protection after approval', ({ files }) => { files.protected = true; }],
  ['unavailable provider', ({ files }) => { files.unavailable = true; }],
  ['target already absent', ({ assets, action }) => assets.delete(action.target.assetId)],
]) test(`${label} is skipped without deleting or claiming capacity`, async () => {
  const { result, files } = await execution(mutate); assert.equal(result.status, 'SKIPPED'); assert.equal(result.reclaimedBytes, 0); assert.equal(files.deleteCount, 0);
});
test('target changing while keeper is checked is rejected by final revalidation', async () => {
  const { result, files } = await execution(({ files, action, assets }) => {
    const original = files.inspect.bind(files);
    files.inspect = async snap => { const result = await original(snap); if (snap.assetId === action.keeper.assetId) assets.set(action.target.assetId, { ...action.target, modified: 200 }); return result; };
  });
  assert.equal(result.status, 'SKIPPED'); assert.equal(files.deleteCount, 0);
});
test('uncertain interrupted deletion is not credited or retried', async () => {
  const { result, files } = await execution(({ action, records, assets }) => {
    records.set(action.id, { status: 'EXECUTING' }); assets.delete(action.target.assetId);
  });
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reclaimedBytes, 0); assert.equal(files.deleteCount, 0);
});
test('successful and uncertain terminal records are idempotent', async () => {
  for (const status of ['SUCCEEDED', 'UNKNOWN', 'SKIPPED']) {
    const { files, result } = await execution(({ action, records }) => records.set(action.id, { actionId: action.id, status, reclaimedBytes: 0 }));
    assert.equal(result.status, status); assert.equal(files.deleteCount, 0);
  }
});
test('failure to durably record EXECUTING prevents deletion', async () => {
  const { result, files } = await execution(({ ledger }) => {
    const original = ledger.put; ledger.put = async result => { if (result.status === 'EXECUTING') throw new Error('quota exceeded'); await original(result); };
  });
  assert.equal(result.status, 'FAILED'); assert.equal(files.deleteCount, 0);
});
test('delete errors are uncertain and do not claim capacity', async () => {
  const { result } = await execution(({ files }) => { files.delete = async () => { throw new Error('connection lost'); }; });
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reclaimedBytes, 0);
});
test('wrong approval and injected actions fail before access', async () => {
  const plan = { ...planFor(duplicates()), status: 'APPROVED' }, approval = { planId: plan.id, version: plan.version, digest: planDigest(plan) };
  await assert.rejects(executeAction(plan, { ...approval, digest: 'tampered' }, plan.actions[0], {}, {}));
  await assert.rejects(executeAction(plan, approval, { ...plan.actions[0], id: 'injected' }, {}, {}));
});
test('executor independently rejects read-only and demo plans even with a matching digest', async () => {
  for (const mode of ['readonly', 'demo']) {
    const plan = { ...planFor(duplicates()), status: 'APPROVED', mode };
    const approval = { planId: plan.id, version: plan.version, digest: planDigest(plan) };
    await assert.rejects(executeAction(plan, approval, plan.actions[0], {}, {}), /只读/);
  }
});
