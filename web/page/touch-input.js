// web/page/touch-input.js -- TOUCH INPUT: WHICH KEYS ARE HELD, AND WHAT THE
// GAME IS DOING, FOR EVERY TOUCH SURFACE.
//
// The touch surfaces (the pad's buttons, the driving pad, the tap layer, the
// look zone, the phone keyboard) keep only their own gestures. Two things
// they used to keep each for themselves live here instead:
//
//   - THE HELD KEYS. press(owner, key, el) / release(owner) / releaseAll(why).
//     An owner is one finger on one surface ('pad:' + pointerId, ...) and
//     holds at most one key. Keys are counted, so two fingers on one turn
//     hold it until both lift, and a key goes down once and up once. A
//     surface's element shows .aa-down while any owner holds it.
//
//     RELEASING EVERYTHING WHEN THE GAME'S STATE CHANGES IS A BUG FIX, NOT
//     TIDINESS. A player holding a turn when their cycle dies would otherwise
//     have the control go display:none under their thumb, and a pointerup on
//     an element with no box is not guaranteed to arrive -- so ArrowLeft would
//     stay down for ever, from the game's point of view, and steer the next
//     round. Pointer capture does not save this: the specification releases it
//     implicitly on removal from the document, and browsers differ on whether
//     display:none counts.
//
//   - ONE READING OF THE GAME PER TICK. tick() asks the Game module (context,
//     highlighted text field, whether chat is possible) once, and hands the
//     answer to every subscriber. The page calls it every 100 ms: a control
//     that is a tenth of a second late to appear is invisible to a player,
//     and every tap re-reads the context itself, so nothing acts on a stale
//     value.
//
// Plus the surfaces' geometry, as pure functions the tests can call.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AATouchInput = (function () {
  'use strict';

  // game: AAGame.create()'s object. log(line): the page's console.
  var create = function (game, log) {
    var owners = new Map();   // owner -> { key, el }
    var counts = new Map();   // key -> owners holding it
    var subscribers = [];

    var elHeld = function (el) {
      var held = false;
      owners.forEach(function (o) { if (o.el === el) held = true; });
      return held;
    };
    // key null: the press shows but sends nothing (the pad's Enter while
    // driving, see the shell).
    var press = function (owner, key, el) {
      if (owners.has(owner)) release(owner);
      owners.set(owner, { key: key, el: el || null });
      if (el) el.classList.add('aa-down');
      if (key === null) return;
      var n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      if (n === 1) game.key('keydown', key);
    };
    var release = function (owner) {
      var o = owners.get(owner);
      if (!o) return false;
      owners.delete(owner);
      if (o.el && !elHeld(o.el)) o.el.classList.remove('aa-down');
      if (o.key === null) return true;
      var n = (counts.get(o.key) || 0) - 1;
      if (n > 0) { counts.set(o.key, n); return true; }
      counts.delete(o.key);
      game.key('keyup', o.key);
      return true;
    };
    var releaseAll = function (why) {
      if (!owners.size) return 0;
      var n = owners.size;
      Array.from(owners.keys()).forEach(release);
      log('[TOUCH] released ' + n + ' held key(s): ' + why);
      return n;
    };

    var tick = function () {
      var state = { context: game.context(), field: game.textField(),
                    chatPossible: game.chatPossible() };
      for (var i = 0; i < subscribers.length; i++) subscribers[i](state);
      return state;
    };

    return {
      press: press, release: release, releaseAll: releaseAll,
      holds: function (owner) { var o = owners.get(owner); return o ? o.key : undefined; },
      held: function (key) { return counts.get(key) || 0; },
      subscribe: function (fn) { subscribers.push(fn); },
      tick: tick,
    };
  };

  // ---- geometry ------------------------------------------------------------
  // rects are DOMRect-shaped: { left, top, width, height }.

  // The driving pad: the brake bar along the bottom (with 6 px of slop above
  // it), and the rest split into left and right halves. A finger's key follows
  // where it IS, so sliding across the middle rocks from one turn to the
  // other without lifting.
  var driveKeyAt = function (x, y, pad, brakeTop) {
    if (y >= brakeTop - 6) return 'ArrowDown';
    return x < pad.left + pad.width / 2 ? 'ArrowLeft' : 'ArrowRight';
  };

  // Looking around: the bottom quarter of the picture looks back (4), the
  // left and right halves above it look left (1) and right (2).
  var lookBitAt = function (x, y, zone) {
    if (y >= zone.top + zone.height * 0.75) return 4;
    return x < zone.left + zone.width / 2 ? 1 : 2;
  };

  // A tap has to mean a tap: Enter commits whatever menu row is selected, so a
  // thumb brushing the glass or a drag must not. 24 px and 700 ms are the
  // usual click-slop shape. Returns null for a tap, or why it is not one.
  var TAP_SLOP_PX = 24, TAP_MS = 700;
  var notATap = function (start, x, y, now) {
    var moved = Math.hypot(x - start.x, y - start.y);
    var held = now - start.t;
    if (moved > TAP_SLOP_PX || held > TAP_MS) {
      return 'moved ' + Math.round(moved) + 'px, held ' + held + 'ms';
    }
    return null;
  };

  return { create: create, driveKeyAt: driveKeyAt, lookBitAt: lookBitAt, notATap: notATap,
           TAP_SLOP_PX: TAP_SLOP_PX, TAP_MS: TAP_MS };
})();
