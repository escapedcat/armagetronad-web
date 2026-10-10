// web/page/game.js: the page's one way into the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadPageModule, readRepoFile, repoPath } from './load-page-module.mjs';

const AAGame = loadPageModule('web/page/game.js', 'AAGame');

// A fake game: exports return what `answers` says, and every call is recorded.
function fakeGame(answers = {}) {
  const calls = [], sent = [];
  const Module = {};
  for (const [name, value] of Object.entries(answers)) {
    Module['_' + name] = (...args) => {
      calls.push([name, ...args]);
      if (value instanceof Error) throw value;
      return value;
    };
  }
  const game = AAGame.create({
    module: () => Module,
    send: (type, init) => sent.push([type, { ...init }]),
  });
  return { game, calls, sent };
}

test('context: the two bits and the driving policy', () => {
  const cases = [
    [0, { menu: false, cycle: false, driving: false }],
    [1, { menu: true,  cycle: false, driving: false }],
    [2, { menu: false, cycle: true,  driving: true }],
    [3, { menu: true,  cycle: true,  driving: false }],   // the in-game menu over a live round
  ];
  for (const [raw, want] of cases) {
    const { game } = fakeGame({ aa_web_input_context: raw });
    game.markStarted();
    assert.deepEqual({ ...game.context() }, { raw, ...want }, 'raw ' + raw);
    assert.deepEqual({ ...AAGame.readContext(raw) }, { raw, ...want });
  }
});

test('before main() nothing is called and every answer is the safe one', () => {
  const boom = new Error('makeInvalidEarlyAccess: abort()');
  const { game, calls } = fakeGame({
    aa_web_input_context: boom, aa_web_text_selected: boom, aa_web_chat_open: boom,
    aa_web_chat_possible: boom, aa_web_connected: boom, aa_web_request_leave: boom,
    aa_web_look: boom, aa_web_save_config: boom,
  });
  assert.equal(game.started(), false);
  assert.equal(game.context().driving, false);
  assert.equal(game.context().raw, 0);
  assert.equal(game.textField(), 'none');
  assert.equal(game.chatOpen(), false);
  assert.equal(game.chatPossible(), false);
  assert.equal(game.connected(), false);
  assert.equal(game.requestLeave(), false);
  assert.equal(game.look(3), false);
  assert.equal(game.saveConfig(), false);
  assert.deepEqual(calls, []);
});

test('after main(): questions fall back on a throw, requests throw to the caller', () => {
  const boom = new Error('boom');
  const { game } = fakeGame({
    aa_web_input_context: boom, aa_web_text_selected: boom, aa_web_connected: boom,
    aa_web_request_leave: boom, aa_web_save_config: boom, aa_web_look: boom,
  });
  game.markStarted();
  assert.equal(game.context().raw, 0);
  assert.equal(game.textField(), 'none');
  assert.equal(game.connected(), false);
  assert.throws(() => game.requestLeave(), /boom/);
  assert.throws(() => game.saveConfig(), /boom/);
  // look runs inside pointer handlers: it must never throw.
  assert.equal(game.look(1), false);
});

test('a missing export is a fallback for a question and a throw for a request', () => {
  const { game } = fakeGame({});
  game.markStarted();
  assert.equal(game.chatPossible(), false);
  assert.throws(() => game.saveConfig(), /aa_web_save_config is not exported/);
});

test('textField maps 0/1/2', () => {
  for (const [v, want] of [[0, 'none'], [1, 'text'], [2, 'password']]) {
    const { game } = fakeGame({ aa_web_text_selected: v });
    game.markStarted();
    assert.equal(game.textField(), want);
  }
});

test('requests reach the export with their arguments', () => {
  const { game, calls } = fakeGame({ aa_web_look: undefined, aa_web_request_leave: undefined,
                                     aa_web_connected: 1, aa_web_chat_open: 1, aa_web_chat_possible: 1 });
  game.markStarted();
  game.look(5);
  game.requestLeave();
  assert.equal(game.connected(), true);
  assert.equal(game.chatOpen(), true);
  assert.equal(game.chatPossible(), true);
  assert.deepEqual(calls.slice(0, 2), [['aa_web_look', 5], ['aa_web_request_leave']]);
});

test('keys: the event shape SDL reads', () => {
  const { game, sent } = fakeGame();
  game.key('keydown', 'ArrowLeft');
  game.press('Return');
  game.press('Backspace');
  assert.deepEqual(sent, [
    ['keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 }],
    ['keydown', { key: 'Return', code: 'Return', keyCode: 13, which: 13 }],
    ['keyup',   { key: 'Return', code: 'Return', keyCode: 13, which: 13 }],
    ['keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 }],
    ['keyup',   { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 }],
  ]);
});

test('typeChar: latin-1 goes through, the rest becomes "?", control characters are dropped', () => {
  const { game, sent } = fakeGame();
  assert.equal(game.typeChar('a'), true);
  assert.equal(game.typeChar('é'), true);
  assert.equal(game.typeChar('€'), true);
  assert.equal(game.typeChar('\n'), false);
  assert.equal(game.typeChar('\u0085'), false);
  const presses = sent.filter(([t]) => t === 'keypress').map(([, i]) => i.charCode);
  assert.deepEqual(presses, [97, 233, 63]);
  assert.deepEqual(sent.slice(0, 3), [
    ['keydown',  { key: 'a', keyCode: 65, which: 65 }],
    ['keypress', { key: 'a', charCode: 97, keyCode: 97, which: 97 }],
    ['keyup',    { key: 'a', keyCode: 65, which: 65 }],
  ]);
});

test('the context bits match the C++ that sets them', () => {
  const dir = repoPath('src/emscripten');
  const cpp = readdirSync(dir).filter((f) => f.endsWith('.cpp'))
    .map((f) => readRepoFile('src/emscripten/' + f)).join('\n');
  const bit = (name) => Number(new RegExp('#define\\s+' + name + '\\s+(\\d+)').exec(cpp)?.[1]);
  assert.equal(bit('AA_WEB_CTX_MENU'), AAGame.CTX_MENU);
  assert.equal(bit('AA_WEB_CTX_CYCLE'), AAGame.CTX_CYCLE);
});

// ---- the seam, checked against the page ------------------------------------

const shell = readRepoFile('web/shell.html');
// The page's own script, without its comments (prose may name the exports).
const shellCode = shell.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('web/shell.html calls no aa_web_* export directly', () => {
  assert.deepEqual(shellCode.match(/Module\._aa_web_\w+/g) || [], []);
});

test('web/shell.html builds a KeyboardEvent in one place only: the Game module\'s sink', () => {
  assert.equal((shellCode.match(/new KeyboardEvent\(/g) || []).length, 1);
});

test('the shell\'s <script> tags are balanced', () => {
  // Lines that ARE tags, not prose about them.
  const opens = shell.split('\n').filter((l) => /^\s*<script[\s>]/.test(l)).length;
  const closes = shell.split('\n').filter((l) => /^\s*<\/script>/.test(l)).length;
  assert.equal(closes, opens);
});

test('the shell inlines every page module it names, and they exist', () => {
  const named = [...shell.matchAll(/<!-- @page-module (\S+) -->/g)].map((m) => m[1]);
  assert.ok(named.includes('web/page/game.js'));
  for (const f of named) assert.ok(readRepoFile(f).length > 0, f);
});

test('no page module has a line emcc\'s shell preprocessor would read as a directive', () => {
  for (const f of readdirSync(repoPath('web/page')).filter((n) => n.endsWith('.js'))) {
    const bad = readRepoFile('web/page/' + f).split('\n').filter((l) => /^\s*#/.test(l));
    assert.deepEqual(bad, [], f);
  }
});
