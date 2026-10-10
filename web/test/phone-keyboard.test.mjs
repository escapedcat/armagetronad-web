// web/page/phone-keyboard.js: typing into the game's own text fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule } from './load-page-module.mjs';

const K = loadPageModule('web/page/phone-keyboard.js', 'AAPhoneKeyboard');

// Arrays made inside the vm sandbox are another realm's: copy before comparing.
const diff = (a, b) => { const d = K.imeDiff(a, b); return { gone: d.gone, came: [...d.came] }; };

test('imeDiff: backspaces for what went, characters for what came', () => {
  assert.deepEqual(diff(' ', ' a'), { gone: 0, came: ['a'] });
  assert.deepEqual(diff(' helo', ' hello'), { gone: 1, came: ['l', 'o'] });
  assert.deepEqual(diff(' teh ', ' the '), { gone: 3, came: ['h', 'e', ' '] });
  assert.deepEqual(diff(' a😀', ' a'), { gone: 1, came: [] }, 'an emoji is one backspace');
});

function setup({ chatOpen = false } = {}) {
  const sent = [], logs = [], handlers = {};
  const doc = { activeElement: null };
  const ime = {
    value: '', type: 'text',
    focus() { doc.activeElement = ime; }, blur() { doc.activeElement = null; },
    setSelectionRange() {},
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
  };
  const vp = { height: 900, listeners: [], addEventListener(t, fn) { this.listeners.push(fn); } };
  let started = true;
  const game = {
    started: () => started,
    press: (k) => sent.push('press ' + k),
    typeChar: (c) => sent.push('type ' + c),
    chatOpen: () => chatOpen,
  };
  const kbd = K.create({ game, ime, doc, log: (l) => logs.push(l), viewport: vp, innerHeight: () => 900 });
  const fire = (t, e = {}) => (handlers[t] || []).forEach((fn) => fn({
    preventDefault() {}, stopPropagation() {}, ...e }));
  const type = (v) => { ime.value = v; fire('input'); };
  return { kbd, ime, doc, sent, logs, fire, type, vp, stop: () => { started = false; } };
}
const at = (field) => ({ field, context: { raw: 0 }, chatPossible: false });

test('moving onto a text field opens the keyboard, typing reaches the game, moving off closes it', () => {
  const { kbd, ime, doc, sent, logs, type } = setup();
  kbd.onState(at('text'));
  assert.equal(doc.activeElement, ime);
  assert.equal(ime.value, K.REST);
  type(' hi');
  assert.deepEqual(sent, ['type h', 'type i']);
  assert.equal(ime.value, ' hi', 'the field keeps what was typed (swipe spaces)');
  type('');
  assert.equal(ime.value, K.REST, 'a deleted REST is put back');
  kbd.onState(at('none'));
  assert.equal(doc.activeElement, null);
  assert.deepEqual(logs, ['[KBD] open', '[KBD] closed: left the field']);
});

test('a password field is a password input', () => {
  const { kbd, ime } = setup();
  kbd.onState(at('password'));
  assert.equal(ime.type, 'password');
  kbd.onState(at('text'));
  assert.equal(ime.type, 'text');
});

test('Enter is the game\'s Enter and closes the keyboard; Escape closes and is sent', () => {
  const { kbd, sent, logs, fire, doc } = setup();
  kbd.onState(at('text'));
  fire('keydown', { key: 'Enter' });
  assert.deepEqual(sent, ['press Return']);
  assert.equal(doc.activeElement, null);
  kbd.toggle('tap on the picture');
  fire('keydown', { key: 'Escape' });
  assert.deepEqual(sent, ['press Return', 'press Escape']);
  assert.deepEqual(logs.filter((l) => l.startsWith('[KBD] closed')), ['[KBD] closed: enter', '[KBD] closed: escape']);
});

test('putting the keyboard away on the chat line closes the line unsent', () => {
  const { kbd, sent, logs, vp } = setup({ chatOpen: true });
  kbd.onState(at('text'));
  vp.height = 500; vp.listeners.forEach((fn) => fn());
  vp.height = 900; vp.listeners.forEach((fn) => fn());
  assert.deepEqual(sent, ['press Escape']);
  assert.ok(logs.includes('[KBD] chat line closed: the keyboard was put away'));
});

test('a tap on the picture on a name field just hides the keyboard', () => {
  const { kbd, sent, doc, ime } = setup({ chatOpen: false });
  kbd.onState(at('text'));
  kbd.toggle('tap on the picture');
  assert.equal(doc.activeElement, null);
  assert.deepEqual(sent, []);
  kbd.toggle('tap on the picture');
  assert.equal(doc.activeElement, ime);
});

test('before main() it does nothing', () => {
  const { kbd, doc, stop } = setup();
  stop();
  kbd.onState(at('text'));
  assert.equal(doc.activeElement, null);
  assert.equal(kbd.onField(), false);
});
