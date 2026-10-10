// web/page/phone-keyboard.js -- THE PHONE KEYBOARD TYPES INTO THE GAME'S OWN
// TEXT FIELDS.
//
// A phone opens its keyboard only for a focused field in the page, and the
// game's text fields (Player Setup's name, Custom Connect, the chat line that
// Enter opens during a round) are drawn into the canvas. So:
//  - The game says when one is highlighted (game.textField(), read once per
//    touch tick). Moving onto one focuses the hidden #aa-ime input, which
//    opens the keyboard (the tap that moved there is the user activation the
//    phone asks for), and moving off blurs it.
//  - What is typed into #aa-ime goes to the game as key events: the change
//    since last time (imeDiff), as backspaces for what went and characters
//    for what came. Word suggestions and autocorrect rewrite whole words, and
//    this handles that the same way. How a character becomes a key event is
//    game.typeChar.
//  - The field's own key events stop at the field, so SDL (listening on
//    document) sees each character once: the synthetic copy.
//  - A known edge: the game's text fields have a length limit and refuse
//    characters past it without telling the page. A suggestion that rewrites
//    a word which ran into the limit then sends one backspace per character
//    the page sent, not per character the game kept, and can delete one too
//    many.
//  - The keyboard's Enter is the game's Enter and closes the keyboard.
//    Folding the keyboard away releases the field, or the next tap would
//    bring it back. A tap on the picture shows or hides the keyboard while a
//    text field is still highlighted (toggle()); on the chat line, putting
//    the keyboard away (folded, or a tap on the picture) closes the line
//    unsent. An empty chat line is closed, not sent (src/engine/ePlayer.cpp,
//    eMenuItemChat::Event).
// Touch devices only: a desktop has a keyboard.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAPhoneKeyboard = (function () {
  'use strict';

  // What the field starts with: backspace always has something to delete.
  var REST = ' ';

  // From prev to cur: how many characters went from the end, and which came.
  // Counted in code points, so an emoji is one backspace.
  var imeDiff = function (prev, cur) {
    var p = 0;
    while (p < prev.length && p < cur.length && prev[p] === cur[p]) p++;
    return { gone: Array.from(prev.slice(p)).length, came: Array.from(cur.slice(p)) };
  };

  // env.game: AAGame's object. env.ime: the hidden <input>. env.doc: the
  // document (activeElement). env.log(line). env.viewport: visualViewport or
  // null, env.innerHeight(): the layout viewport's height.
  var create = function (env) {
    var game = env.game, ime = env.ime, log = env.log;
    var prev = REST, composing = false, onField = false;
    var up = function () { return env.doc.activeElement === ime; };

    var sync = function () {
      var cur = ime.value;
      var d = imeDiff(prev, cur);
      for (var i = 0; i < d.gone; i++) game.press('Backspace');
      for (var j = 0; j < d.came.length; j++) game.typeChar(d.came[j]);
      prev = cur;
      // THE FIELD KEEPS WHAT WAS TYPED while it is open (it is cleared on
      // open): a keyboard reads the text before the cursor to decide on the
      // space before a swiped word, and on capitals and suggestions. Reset to
      // the bare REST space after every edit, it saw a space and added none,
      // and swiped words ran together. Only a deleted REST is put back.
      if (!composing && cur.indexOf(REST) !== 0) { ime.value = REST; prev = REST; }
    };
    var open = function () {
      ime.value = REST; prev = REST; composing = false;
      ime.focus();
      try { ime.setSelectionRange(1, 1); } catch (e) { /* not every input type has one */ }
      log('[KBD] open');
    };
    var close = function (why) {
      if (!up()) return;
      ime.blur();
      log('[KBD] closed: ' + why);
      // PUTTING THE KEYBOARD AWAY ENDS A CHAT. Folded by the player, or hidden
      // by a tap on the picture: an open "Say:" line with no keyboard is a
      // dead end, so Escape closes it, unsent, as on a desktop. A name field
      // just loses the keyboard.
      if ((why === 'folded' || why === 'tap on the picture') && game.chatOpen()) {
        game.press('Escape');
        log('[KBD] chat line closed: the keyboard was put away');
      }
    };

    ime.addEventListener('compositionstart', function () { composing = true; });
    ime.addEventListener('compositionend', function () { composing = false; sync(); });
    ime.addEventListener('input', sync);
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      ime.addEventListener(t, function (e) {
        // Arrow keys (a tablet's hardware keyboard) go on to the game as they
        // are; they type nothing, so they can't arrive twice.
        if (e.key && e.key.indexOf('Arrow') === 0) { e.preventDefault(); return; }
        e.stopPropagation();
        if (t !== 'keydown') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (composing) { composing = false; sync(); }
          game.press('Return');
          close('enter');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close('escape');
          game.press('Escape');
        }
      });
    });
    // Folding the keyboard: the visual viewport grows back.
    var shrunk = false;
    if (env.viewport) {
      env.viewport.addEventListener('resize', function () {
        var small = env.viewport.height < env.innerHeight() * 0.85;
        if (small) shrunk = true;
        else if (shrunk) { shrunk = false; close('folded'); }
      });
    }

    return {
      onField: function () { return onField; },
      // A tap on the picture shows or hides the keyboard on a text field.
      toggle: function (why) { if (up()) close(why); else open(); },
      // Each touch tick: follow the highlighted field.
      onState: function (state) {
        if (!game.started()) return;
        var field = state.field;
        var now = field !== 'none';
        // A PASSWORD PROMPT GETS A PASSWORD FIELD: the phone keyboard then
        // offers no suggestions and learns nothing typed. Switched before the
        // keyboard opens, or reopened on the spot if the highlight moves
        // between a name and a password with the keyboard up.
        var kind = field === 'password' ? 'password' : 'text';
        if (ime.type !== kind) {
          var wasUp = up();
          ime.type = kind;
          if (wasUp && now) open();
        }
        if (now && !onField) open();
        if (!now && onField) close('left the field');
        onField = now;
      },
    };
  };

  return { create: create, imeDiff: imeDiff, REST: REST };
})();
