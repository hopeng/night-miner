// ==UserScript==
// @name         ScavengerBuddy (SM controller - GAS coordinator)
// @namespace    midnight.sm
// @version      1.0
// @description  Auto Start/Stop with global cap via miner-slot.gs. When Unsolved = 0: Click 'Stop session' and release slot. When Unsolved > 0: Click 'Start session' if slot available.
// @match        https://sm.midnight.gd/*/mine*
// @match        https://sm.midnight.gd/wizard/mine*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // Expose config helpers to unsafeWindow FIRST (before anything else)
  unsafeWindow.SB_setMachineId = async (id) => {
    await GM_setValue('MACHINE_ID', id);
    console.log('%c[SB] ✓ MACHINE_ID set to:', 'color:#6cf;font-weight:bold', id, '(reload page to apply)');
  };
  unsafeWindow.SB_setProfileId = async (id) => {
    await GM_setValue('PROFILE_ID', id);
    console.log('%c[SB] ✓ PROFILE_ID set to:', 'color:#6cf;font-weight:bold', id, '(reload page to apply)');
  };
  unsafeWindow.SB_showConfig = async () => {
    console.log('%c[SB] Current config:', 'color:#6cf;font-weight:bold', {
      MACHINE_ID: await GM_getValue('MACHINE_ID', '(not set)'),
      PROFILE_ID: await GM_getValue('PROFILE_ID', '(not set)')
    });
  };

  // Confirm helper functions are exposed
  console.log('%c[SB] Helper functions available: SB_setMachineId(), SB_setProfileId(), SB_showConfig()', 'color:#6cf;font-weight:bold');

  // === config ===
  const POLL_MS = 60000; // check every 1min
  const MAX_SLOTS_PER_MACHINE = 2; // max concurrent slots allowed per machine
  const COORD_URL = 'https://script.google.com/macros/s/AKfycbxiE_MP2P2gW9laIsCXAuW7ba-OHC2lTWL0V9OM8_eV0Kgki7c9n-nhQdZCKrj_bEo4LA/exec';
  const COORD_TOKEN = 'uzigPjtquxgsQgXE5oSRQLABN8JHtuem';

  // Get config from Tampermonkey storage (per-profile storage)
  const MACHINE_ID = GM_getValue('MACHINE_ID', '');
  const PROFILE_ID = GM_getValue('PROFILE_ID', '');

  // Validate configuration immediately
  if (!MACHINE_ID || MACHINE_ID.trim() === '') {
    console.error('❌ MACHINE_ID is not configured!');
    console.error('💡 Set it in console: SB_setMachineId("DESKTOP1")');
    throw new Error('MACHINE_ID is not configured! Use SB_setMachineId("DESKTOP1") in console, then reload page.');
  }

  if (!PROFILE_ID || PROFILE_ID.trim() === '') {
    console.error('❌ PROFILE_ID is not configured!');
    console.error('💡 Set it in console: SB_setProfileId("Profile1")');
    throw new Error('PROFILE_ID is not configured! Use SB_setProfileId("Profile1") in console, then reload page.');
  }

  const log = (...a)=>console.log('%c[SB]', 'color:#6cf;font-weight:bold', ...a);

  log('✅ Configuration loaded:', {MACHINE_ID, PROFILE_ID});

  // Return the configured profile ID
  function cid(){
    return PROFILE_ID;
  }

  async function api(op, maxSlots = MAX_SLOTS_PER_MACHINE){
    const qs = new URLSearchParams({
      op, id: cid(), machine: MACHINE_ID, token: COORD_TOKEN, max: String(maxSlots)
    });
    try{
      const r = await fetch(COORD_URL + '?' + qs, { method:'POST', mode:'cors' });
      return await r.json();
    }catch(e){
      log('coord error', e);
      return { ok:false, granted:false };
    }
  }

  const btnStart = () =>
    [...document.querySelectorAll('button,[role="button"],a')]
      .find(b => /start session/i.test(b.textContent||''));
  const btnStop = () =>
    [...document.querySelectorAll('button,[role="button"],a')]
      .find(b => /stop session/i.test(b.textContent||''));

  function status(){
    // Find the unsolved count directly from the data-testid attribute
    const unsolvedEl = document.querySelector('[data-testid="unsolved-count"]');
    const unfinished = unsolvedEl ? parseInt(unsolvedEl.textContent || '0', 10) : 0;

    // Find the solved count
    const solvedEl = document.querySelector('[data-testid="solved-count"]');
    const solved = solvedEl ? parseInt(solvedEl.textContent || '0', 10) : 0;

    // Find the all/total count
    const allEl = document.querySelector('[data-testid="all-count"]');
    const all = allEl ? parseInt(allEl.textContent || '0', 10) : 0;

    // Check if all challenges are completed (solved + unsolved = all)
    const allCompleted = all > 0 && (solved + unfinished) >= all;

    // Check wallet connection: "Disconnect" button means wallet is connected
    // If "Disconnect" button is missing, wallet is NOT connected → refresh page
    const hasDisconnectBtn = [...document.querySelectorAll('button')]
      .some(b => /Disconnect/i.test(b.textContent || ''));
    const walletNotConnected = !hasDisconnectBtn;

    // Check if "Next challenge in:" timer is stuck at 00:00:00:00
    const nextChallengeEls = [...document.querySelectorAll('*')].filter(el =>
      /Next challenge in:/i.test(el.textContent || ''));
    let timerStuckAtZero = false;
    if (nextChallengeEls.length > 0) {
      const timerText = nextChallengeEls[0].textContent || '';
      timerStuckAtZero = /00:00:00:00/i.test(timerText);
    }

    return {
      unfinished,
      solved,
      all,
      allCompleted,
      startVisible: !!btnStart(),
      stopVisible: !!btnStop(),
      walletNotConnected,
      timerStuckAtZero,
    };
  }

  let haveSlot = false;
  let stuckTimerStart = 0; // Track when "Next challenge in: 00:00:00:00" first detected

  async function tick(){
    const st = status();
    log('st', st);


    // Check wallet connection first - if no "Disconnect" button, wallet is not connected
    if (st.walletNotConnected){
      log('⚠️ Wallet not connected - refreshing page...');
      location.reload();
      return;
    }

    // Check if "Next challenge in:" timer is stuck at 00:00:00:00
    if (st.timerStuckAtZero) {
      if (!stuckTimerStart) {
        stuckTimerStart = Date.now();
        log('⏱️ Timer stuck at 00:00:00:00 - starting 5min countdown...');
      } else {
        const stuckDuration = Date.now() - stuckTimerStart;
        const stuckMinutes = Math.floor(stuckDuration / 60000);
        if (stuckDuration > 5 * 60 * 1000) { // 5 minutes
          log(`⚠️ Timer stuck at 00:00:00:00 for ${stuckMinutes} minutes - refreshing page...`);
          location.reload();
          return;
        }
        log(`⏱️ Timer still stuck (${stuckMinutes}/5 min)`);
      }
    } else {
      // Timer is not stuck, reset the counter
      if (stuckTimerStart) {
        log('✓ Timer no longer stuck - reset counter');
      }
      stuckTimerStart = 0;
    }

    if (st.unfinished > 0){
      if (st.startVisible){
        // Session is stopped (Start button visible)

        // Step 1: Ensure we have a slot
        if (!haveSlot){
          const res = await api('acquire');
          haveSlot = !!(res && res.ok && res.granted);

          if (!haveSlot){
            // Log API errors if present
            if (res && res.error) {
              log('❌ API error:', res.error, res);
            }

            // Check if it's because THIS machine has too many slots
            if (res && res.count !== undefined) {
              if (res.reason === 'machine_limit') {
                log(`⚠️ Machine limit reached: ${res.count}/${MAX_SLOTS_PER_MACHINE} slots on machine ${MACHINE_ID}`, res.ids);
              } else {
                log('no slot available', res);
              }
            } else {
              log('no slot available', res);
            }
            return; // Can't proceed without a slot
          }

          log('slot acquired', res);
        } else {
          log('already have slot - resuming session');
        }

        // Step 2: If we have a slot (either already had one or just acquired), start the session
        if (haveSlot) {
          try{
            btnStart()?.click();
            log('start clicked - verifying...');
            await new Promise(r => setTimeout(r, 2000)); // wait 2 seconds

            // Verify the button changed from Start to Stop
            if (!btnStop()){
              log('⚠️ Start button click failed - button did not change to Stop. Refreshing...');
              location.reload();
              return;
            }
            log('✓ Start verified - Stop button now visible');
          }catch(e){
            log('❌ Start click error:', e);
          }
        }
      } else if (st.stopVisible) {
        // Session is running (Stop button visible) - verify we still have a valid slot
        const statusRes = await api('status'); // This includes machine parameter automatically
        log('🔍 Validating slot:', {myId: cid(), serverResponse: statusRes});

        if (statusRes && statusRes.ids && !statusRes.ids.includes(cid())) {
          log('⚠️ Session running but ID not in occupied slots - stopping session...', {myId: cid(), occupiedSlots: statusRes.ids});
          try {
            btnStop()?.click();
            log('stop clicked - cleaning up invalid session');
            await new Promise(r => setTimeout(r, 2000));
          } catch(e) {
            log('❌ Stop click error:', e);
          }
          haveSlot = false;
        } else {
          log('✅ Slot validation passed - continuing session');
        }
      }
    }else{
      // No unsolved challenges - stop immediately
      if (st.stopVisible){
        try{
          btnStop()?.click();
          log('stop clicked - verifying...');
          await new Promise(r => setTimeout(r, 2000)); // wait 2 seconds

          // Verify the button changed from Stop to Start
          if (!btnStart()){
            log('⚠️ Stop button click failed - button did not change to Start. Refreshing...');
            location.reload();
            return;
          }
          log('✓ Stop verified - Start button now visible');
        }catch(e){
          log('❌ Stop click error:', e);
        }
        await api('release'); haveSlot = false;

        if (st.allCompleted) {
          log(`🗑️ RELEASE CALLED: All challenges completed (Solved: ${st.solved}, Unsolved: ${st.unfinished}, All: ${st.all})`);
        } else {
          log('🗑️ RELEASE CALLED: No unsolved challenges');
        }
      }
    }
  }

  // keep the lease alive if we have one
  async function heartbeat(){
    if (haveSlot) {
      const res = await api('renew');
      if (res && res.ok) {
        log('💓 Heartbeat: slot renewed');
      } else {
        log('❌ Heartbeat: renewal failed', res);
      }
    }
  }

  window.addEventListener('beforeunload', ()=>{
    if (haveSlot) {
      console.log('%c[SB] 🗑️ RELEASE CALLED: Page unload/close', 'color:#6cf;font-weight:bold');
      navigator.sendBeacon?.(COORD_URL+'?op=release&id='+cid()+'&machine='+MACHINE_ID+'&token='+COORD_TOKEN);
    }
  });


  setInterval(tick, POLL_MS);
  setInterval(heartbeat, 30000); // Renew every 20 seconds (TTL is 120s)
  setTimeout(tick, 3000);
  log('ScavengerBuddy userscript loaded');
})();
