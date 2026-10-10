// web/tools/gate-probe.js -- helpers the .steps gates share, as window.__aa.
//
// A gate installs it with the `probe:` step (drive-browser.mjs and
// drive-firefox.mjs both have it) and then calls it from its eval: lines, so
// a helper is written once here instead of pasted, minified, into each gate.
// A reload clears it: issue `probe:` again after one.
//
// Read-only towards the game except where a name says otherwise
// (setPlayerName). Plain script, no modules: it is evaluated as one
// expression in the page.
(() => {
  const USER_CFG = '/persist/var/user.cfg';
  const aa = {};

  // user.cfg as the game wrote it: latin-1, one char per byte. save: ask the
  // game to write its current settings first (aa_web_save_config, which does
  // not yield).
  aa.userCfg = ({ save = false } = {}) => {
    if (save) Module._aa_web_save_config();
    const b = Module.FS.readFile(USER_CFG);
    let c = '';
    for (const x of b) c += String.fromCharCode(x);
    return c;
  };

  // The value of the first `KEY value` line, with the game's backslash
  // escapes undone; null if there is none.
  aa.cfgValue = (text, key) => {
    const m = new RegExp('^\\s*' + key + '\\s+(.*)$', 'm').exec(text);
    return m ? m[1].trim().replace(/\\(.)/g, '$1') : null;
  };

  aa.playerName = (opts) => aa.cfgValue(aa.userCfg(opts), 'PLAYER_1');

  // Rewrite the saved name, and stop the game saving over it, so the next
  // load starts from this name.
  aa.setPlayerName = (name) => {
    const c = aa.userCfg().replace(/^(\s*PLAYER_1\s+).*$/m, '$1' + name);
    Module.FS.writeFile(USER_CFG, Uint8Array.from(c, (ch) => ch.charCodeAt(0)));
    Module._aa_web_save_config = () => {};
    return 'saved name set to ' + name;
  };

  // One check line in the shape every gate uses:
  //   [TAG] ID name {"...":...,"PASS":true}
  // and the id back, for the harness's `=> "ID"`.
  aa.check = (tag, id, name, facts, pass) => {
    console.log('[' + tag + '] ' + id + ' ' + name + ' ' +
                JSON.stringify(Object.assign({}, facts, { PASS: !!pass })));
    return id;
  };

  window.__aa = aa;
  return 'gate probe installed';
})()
