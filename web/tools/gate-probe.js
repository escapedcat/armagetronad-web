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

  // What the game would ask: game.context() (menu / cycle / driving), from the
  // page's own Game module.
  aa.ctx = () => AA_GAME.context();

  // Resolves once cond() is true, polling every 100 ms, or after ms with
  // TIMEOUT -- the gate's next check then says whether the thing happened.
  // A wait on what the gate is waiting FOR, instead of a fixed sleep.
  aa.waitFor = (cond, ms = 30000) => new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      let ok = false;
      try { ok = !!cond(); } catch (e) { ok = false; }
      if (ok) return resolve('ok after ' + (Date.now() - t0) + 'ms');
      if (Date.now() - t0 >= ms) return resolve('TIMEOUT after ' + ms + 'ms');
      setTimeout(poll, 100);
    };
    poll();
  });

  // The M4 persistence probe: every file under /persist with its size, and
  // user.cfg's length and djb2-xor hash, as one [PERSISTFS] line that
  // docs/evidence/m4-persist/check-persist-transcript.mjs reads. Byte for
  // byte the line the persist gates used to paste three times each.
  aa.persistDump = (phase) => {
    const F=Module.FS,files=[];const walk=(p)=>{for(const e of F.readdir(p)){if(e==='.'||e==='..')continue;const f=p+'/'+e,s=F.stat(f);if(F.isDir(s.mode)){files.push({path:f+'/',size:null});walk(f)}else{files.push({path:f,size:s.size})}}};let err=null;try{walk('/persist')}catch(e){err=String(e)}const rd=(p)=>{try{return F.readFile(p,{encoding:'utf8'})}catch(e){return null}};const h=(s)=>{if(s===null)return null;let x=5381;for(let i=0;i<s.length;i++)x=((x*33)^s.charCodeAt(i))>>>0;return x.toString(16)};const c=rd('/persist/var/user.cfg'),pr=rd('/persist/m4-probe.txt');console.log('[PERSISTFS] '+JSON.stringify({phase:phase,error:err,entry_count:files.length,entries:files.slice(0,120),user_cfg:{present:c!==null,bytes:c===null?null:c.length,hash:h(c)},probe_text:pr}));
    return 'listed';
  };

  window.__aa = aa;
  return 'gate probe installed';
})()
