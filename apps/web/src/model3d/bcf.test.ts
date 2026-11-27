import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipFiles, zipFiles } from '../documents/zip';
import { affine, bcfFiles, filterTopics, invertAffine, markupStatusOf, newTopic, readBcf, topicStatusOf, type BcfTopic } from './bcf';

type Vec3 = [number, number, number];
const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= tol);

/** IFC to grid: turned 30° and moved, as an IfcMapConversion would (column-major). */
const c = Math.cos(Math.PI / 6);
const s = Math.sin(Math.PI / 6);
const TO_GRID = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 318700, 6247200, 12, 1];

function topic(patch: Partial<BcfTopic> = {}): BcfTopic {
  return {
    ...newTopic({ title: 'Kerb clashes with pit', author: 'Ana', point: [318720.5, 6247230.25, 14.2], camera: { position: [318700, 6247200, 60], target: [318720.5, 6247230.25, 14.2], projection: 'Perspective', fov: 55 }, snapshot: null }, new Date('2026-11-23T01:02:03Z')),
    ...patch,
  };
}

test('statuses map to markup statuses and back, keeping a status the sheet already shows', () => {
  assert.equal(markupStatusOf('Open'), 'none');
  assert.equal(markupStatusOf('In Progress'), 'none');
  assert.equal(markupStatusOf('Resolved'), 'completed');
  assert.equal(markupStatusOf('Closed'), 'accepted');
  assert.equal(topicStatusOf('none', 'In Progress'), 'In Progress');
  assert.equal(topicStatusOf('completed', 'Open'), 'Resolved');
  assert.equal(topicStatusOf('rejected', 'Open'), 'Closed');
  assert.equal(topicStatusOf('none', 'Closed'), 'Open');
  assert.equal(topicStatusOf('some-custom-state', 'Open'), 'Open');
});

test('an affine map and its inverse round-trip points and directions', () => {
  const inv = invertAffine(TO_GRID)!;
  const p: Vec3 = [12.5, -3, 7];
  assert.ok(near(affine(inv).point(affine(TO_GRID).point(p)), p));
  assert.ok(near(affine(TO_GRID).direction([1, 0, 0]), [c, s, 0]));
  assert.equal(invertAffine([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), null);
});

test('a .bcfzip round-trips topics: fields, comments, camera through the model’s coordinates, point and snapshot', async () => {
  const t = topic({
    description: 'Pit lid 200 mm high',
    status: 'In Progress',
    priority: 'High',
    assignee: 'civil@example.com',
    dueDate: '2026-12-01',
    labels: ['Drainage', 'Kerb & gutter'],
    comments: [{ guid: 'c1', author: 'Ana', date: '2026-11-23T02:00:00.000Z', text: 'Moved the pit <500> east?' }],
  });
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const zip = zipFiles(bcfFiles([t], affine(invertAffine(TO_GRID)!), new Map([[t.guid, png]])));
  const files = await unzipFiles(zip);
  assert.ok(files.some((f) => f.name === 'bcf.version'));
  const xml = new TextDecoder().decode(files.find((f) => f.name.endsWith('viewpoint.bcfv'))!.data);
  // In the model's own coordinates: the camera is 60 m above the model origin, which is grid (318700, 6247200, 12).
  assert.match(xml, /<CameraViewPoint><X>0<\/X><Y>0<\/Y><Z>48<\/Z>/);
  const [back] = readBcf(files, affine(TO_GRID));
  assert.ok(back);
  for (const k of ['guid', 'title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'labels', 'author', 'created', 'comments'] as const) assert.deepEqual(back[k], t[k], k);
  assert.ok(near(back.point!, t.point!));
  assert.ok(near(back.camera!.position, t.camera!.position, 1e-6));
  assert.ok(near(back.camera!.target, t.camera!.target, 1e-6));
  assert.equal(back.camera!.fov, 55);
  assert.equal(back.snapshot, `data:image/png;base64,${Buffer.from(png).toString('base64')}`);
});

test('a topic from another tool (no point of ours) takes its place from the camera, and keeps links it had here', () => {
  const vp = `<VisualizationInfo Guid="v"><PerspectiveCamera><CameraViewPoint><X>0</X><Y>0</Y><Z>40</Z></CameraViewPoint><CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection><CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector><FieldOfView>60</FieldOfView></PerspectiveCamera></VisualizationInfo>`;
  const markup = `<Markup><Topic Guid="g1" TopicStatus="Closed"><Title>Missing kerb</Title><Labels>Kerb</Labels></Topic><Comment Guid="k"><Date>2026-01-01</Date><Author>Bo</Author><Comment>Fixed</Comment></Comment><Viewpoints Guid="v"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints></Markup>`;
  const enc = new TextEncoder();
  const known = topic({ guid: 'g1', links: [{ sheet: 'f:0:r', markupIds: ['a', 'b'], synced: { title: 'x', status: 'none', at: [1, 2] } }] });
  const [t] = readBcf([{ name: 'g1/markup.bcf', data: enc.encode(markup) }, { name: 'g1/viewpoint.bcfv', data: enc.encode(vp) }], affine(TO_GRID), [known]);
  assert.equal(t!.title, 'Missing kerb');
  assert.equal(t!.status, 'Closed');
  assert.deepEqual(t!.labels, ['Kerb']);
  assert.equal(t!.comments[0]!.text, 'Fixed');
  // 20 m ahead of the camera, straight down: the model origin's grid point, 32 m above the map's datum.
  assert.ok(near(t!.point!, [318700, 6247200, 32]));
  assert.deepEqual(t!.links, known.links);
});

test('the Issues list filters by status, assignee and text', () => {
  const a = topic({ guid: 'a', status: 'Open', assignee: 'ana', labels: ['Drainage'] });
  const b = topic({ guid: 'b', status: 'Closed', assignee: 'bo', title: 'Line marking' });
  assert.deepEqual(filterTopics([a, b], { status: 'Open', assignee: '', text: '' }).map((t) => t.guid), ['a']);
  assert.deepEqual(filterTopics([a, b], { status: '', assignee: 'bo', text: '' }).map((t) => t.guid), ['b']);
  assert.deepEqual(filterTopics([a, b], { status: '', assignee: '', text: 'drain' }).map((t) => t.guid), ['a']);
});
