// -----------------------------------------------------------------------------
// The `pyload` dashboard widget: content within the core budget (checked with
// the SDK's validator), every server or one, the buttons and their actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, formatDuration } from '../src/widgets.js';
import { BOTH_CONFIG, ONE_CONFIG, createWorld, deviceId } from './helpers/world.js';

async function world(t, config = ONE_CONFIG) {
  const w = await createWorld({ config });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (tree, type) => tree.components.filter((component) => component.type === type);

test('one server downloading: speed, queue, time left, rows, four buttons', async (t) => {
  const w = await world(t);
  w.pyload.download(w.pyload.addPackage('Linux ISO', ['https://downloads.example.com/a.iso']));
  await w.hub.pollAll();
  const tree = await content(w);
  assert.equal(tree.components.length, 8);
  assert.deepEqual(
    ofType(tree, 'value').map(({ label, value, unit }) => [label, value, unit]),
    [
      ['Speed', 1, 'MB/s'],
      ['Queue', 4, undefined],
      ['Time left', '5 min', undefined],
    ],
  );
  assert.deepEqual(
    ofType(tree, 'status')[0].items.map(({ label, value }) => [label, value]),
    [
      ['NAS', 'Downloading'],
      ['a.iso', '3 % · 5 min'],
      ['Failed files', 3],
      ['Free space', '47.9 GB'],
      ['Last download', 'Big file'],
    ],
  );
  assert.deepEqual(
    ofType(tree, 'button').map((button) => [button.label, button.action.key, button.icon]),
    [
      ['Pause', ACTIONS.PAUSE, 'pause'],
      ['Pause 30 min', ACTIONS.PAUSE_30, 'clock'],
      ['Resume', ACTIONS.RESUME, 'check-circle'],
      ['Retry failed', ACTIONS.RESTART_FAILED, 'refresh-cw'],
    ],
  );
  assert.equal(tree.ttl_seconds, 15, 'a download moves: refresh sooner');
});

test('two servers in French, one down; the timed pause shows its end', async (t) => {
  const w = await world(t, { ...BOTH_CONFIG, language: 'fr' });
  await w.fake.widgetAction(WIDGET_KEY, ACTIONS.PAUSE_30, {}, { settings: {} });
  w.old.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  const tree = await content(w, {}, 'fr');
  const rows = ofType(tree, 'status')[0].items.map(({ label, value }) => [label, value]);
  assert.equal(rows[0][0], 'NAS');
  assert.match(rows[0][1], /^En pause · jusqu'à \d\d:30$/, 'the end, in the time zone of Gladys');
  assert.deepEqual(rows.at(-1), ['Old', 'Injoignable']);
  assert.ok(rows.some(([label]) => label === 'Espace libre · NAS'));
});

test('the buttons act on the chosen server, and say what they did', async (t) => {
  const w = await world(t, BOTH_CONFIG);
  const settings = { device: deviceId(w.gladys, 2) };
  const act = (key) => w.fake.widgetAction(WIDGET_KEY, key, {}, { settings });
  const paused = await act(ACTIONS.PAUSE);
  assert.equal(paused.success, true, paused.error);
  assert.equal(
    paused.data.message.en,
    'pyLoad paused on 1 server(s): the files in progress finish.',
  );
  assert.ok(w.old.paused && !w.pyload.paused);
  const tree = await content(w, settings);
  assert.equal(ofType(tree, 'button')[0].icon, 'check-circle', 'paused until resumed');
  assert.equal(
    (await act(ACTIONS.RESUME)).data.message.fr,
    'Téléchargements repris sur 1 serveur(s).',
  );
  assert.equal(w.old.paused, false);
  const restarted = await act(ACTIONS.RESTART_FAILED);
  assert.equal(restarted.data.message.de, 'Fehlgeschlagene Dateien auf 1 Server(n) neu gestartet.');
});

test('no server, or a server no longer configured: a message', async (t) => {
  const none = await world(t, { language: 'en' });
  assert.match(ofType(await content(none), 'text')[0].text, /Enter the address of pyLoad/);
  const w = await world(t);
  const tree = await content(w, { device: 'unknown-device' });
  assert.match(ofType(tree, 'text')[0].text, /no longer in the configuration/);
});

test('durations fit a tile', () => {
  assert.equal(formatDuration(59, 'en'), '1 min');
  assert.equal(formatDuration(3600 * 5 + 120, 'fr'), '5 h 02');
  assert.equal(formatDuration(86_400 * 3 + 3600, 'fr'), '3 j 1 h');
});
