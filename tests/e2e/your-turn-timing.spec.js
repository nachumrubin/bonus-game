const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.use({ viewport: { width: 430, height: 932 }, video: 'on' });

for (const reducedMotion of [false, true]) {
  test(`opponent score finishes before full clock + Your Turn cue (reduced=${reducedMotion})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      localStorage.setItem('spine.uiPreferences', JSON.stringify({ reducedMotion: 'auto', soundFx: true, vibration: false }));
      window.turnTones = [];
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        createOscillator() {
          const osc = super.createOscillator();
          const set = osc.frequency.setValueAtTime.bind(osc.frequency);
          let frequency;
          osc.frequency.setValueAtTime = (value, time) => { frequency = value; return set(value, time); };
          const start = osc.start.bind(osc);
          osc.start = time => { window.turnTones.push({ at: performance.now(), frequency, type: osc.type }); start(time); };
          return osc;
        }
      };
    });
    await page.goto('/');
    await page.waitForFunction(() => window.__spine?.enabled);
    await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
    await page.mouse.click(5, 5); // genuine gesture unlocks WebAudio
    await page.evaluate(async () => {
      const s = window.__spine;
      await s.ensureDictionaryLoaded(); s.bootOffline2P();
      s.activeGame.mySlot = 0;
      const { session } = s.activeGame;
      session.state.settings.timelimit = true;
      session.state.settings.botTime = 20;
      // Real engine pass hands the opening to an attached production bot.
      session.dispatch({ type: 'cmd/PASS_TURN' });
      session.state.racks[1] = ['ש','ל','ו','ם','א','ב','ג','ד'];
      // Keep this fixture about ordinary scoring; bonus choreography is unit-covered.
      session.state.bonusAssignment.forEach((_, i) => { session.state.bonusSqUsed[i] = true; });
      s.bus.emit(s.EV.GAME_STARTED, {});
    });
    await page.waitForTimeout(700); // let the setup pass cue settle
    const results = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const soundFx = iteration !== 2;
      const result = await page.evaluate(async ({ iteration, soundFx }) => {
        const s = window.__spine;
        const { session } = s.activeGame;
        const { attachBotPlayer } = await import('/src/game/sessions/botGameSession.js');
        const { scoreClockGraceMs } = await import('/src/ui/scoreAnimationTimings.js');
        const { getMotionPreference } = await import('/src/ui/motionPreference.js');
        const { serverNow } = await import('/src/game/online/serverClock.js');
        const feedback = await import('/src/ui/feedbackService.js');
        feedback.setSoundEnabled(soundFx);
        const card = document.querySelector('#is-sb1');
        const beforeName = getComputedStyle(card).animationName;
        const frames = [], readiness = [];
        let scoreEvent = null;
        const offs = [
          s.bus.on(s.EV.MOVE_CONFIRMED, p => { if (p.slot === 1) scoreEvent = { ...p, at: performance.now() }; }),
          s.bus.on(s.EV.TURN_PRESENTATION_READY, p => {
            if (p.currentTurnSlot === 0) readiness.push({ at: performance.now(),
              remaining: session.state.turnDeadlineMs - serverNow(),
              flash: card.classList.contains('your-turn-cue'),
              shownScore: Number(document.querySelector('#is-sv2').textContent),
              score: session.state.scores[1], timer: document.querySelector('#turn-timer-value').textContent });
          }),
        ];
        const bot = attachBotPlayer(session, { slot: 1, thinkingMs: 100,
          wordList: iteration === 0 ? ['שלום'] : [...s.hebrewDictionary.DICT],
          isWordValid: s.hebrewDictionary.isValid, rng: () => 0.42,
        });
        window.turnTones.length = 0;
        if (iteration === 0) s.bus.emit(s.EV.GAME_STARTED, { currentTurnSlot: session.state.currentTurnSlot });
        else session.dispatch({ type: 'cmd/PASS_TURN' });
        const deadline = performance.now() + 9000;
        while (!readiness.length && performance.now() < deadline) {
          frames.push({ at: performance.now(), scoreStarted: !!scoreEvent,
            flash: card.classList.contains('your-turn-cue'),
            shownScore: Number(document.querySelector('#is-sv2').textContent),
            score: session.state.scores[1], timer: document.querySelector('#turn-timer-value').textContent });
          await new Promise(requestAnimationFrame);
        }
        bot.detach();
        const ready = readiness[0];
        // Duplicate logical events during the flash must not restart it or sound.
        const payload = {currentTurnSlot: session.state.currentTurnSlot, turnNumber: session.state.turnNumber};
        s.bus.emit(s.EV.TURN_CHANGED, payload); s.bus.emit(s.EV.TURN_CHANGED, payload);
        await new Promise(r => setTimeout(r, 700));
        const settled = !card.classList.contains('your-turn-cue');
        const afterName = getComputedStyle(card).animationName;
        await new Promise(r => setTimeout(r, 650));
        const ticking = document.querySelector('#turn-timer-value').textContent;
        offs.forEach(off => off());
        return { scoreEvent, ready, frames, settled, ticking, beforeName, afterName,
          readyCount: readiness.length,
          tones: window.turnTones.filter(tone => tone.frequency === 523 && tone.type === 'triangle'),
          grace: scoreEvent && scoreClockGraceMs({ ...scoreEvent, wordCount: scoreEvent.wordTiles.length,
            reducedMotion: getMotionPreference().isReduced() }),
        };
      }, { iteration, soundFx });
      results.push(result);
      expect(result.scoreEvent?.score).toBeGreaterThan(0);
      expect(result.ready).toBeTruthy();
      expect(result.ready.shownScore).toBe(result.ready.score);
      expect(result.ready.at - result.scoreEvent.at).toBeGreaterThanOrEqual(result.grace - 20);
      expect(result.frames.filter(f => f.scoreStarted).every(f => !f.flash && f.timer === '20')).toBeTruthy();
      expect(result.ready.remaining).toBeGreaterThanOrEqual(19980);
      expect(result.ready.remaining).toBeLessThanOrEqual(20000);
      expect(result.ready.flash).toBe(true);
      expect(result.readyCount).toBe(1);
      expect(result.tones).toHaveLength(soundFx ? 1 : 0);
      if (soundFx) expect(Math.abs(result.tones[0].at - result.ready.at)).toBeLessThan(20);
      expect(result.settled).toBe(true);
      expect(result.ticking).toBe('19');
    }
    const tracePath = testInfo.outputPath('score-clock-cue-trace.json');
    fs.writeFileSync(tracePath, JSON.stringify(results, null, 2));
    await testInfo.attach('score-clock-cue-trace', { path: tracePath, contentType: 'application/json' });
  });
}

for (const preference of [
  { name: 'normal', os: 'no-preference', setting: 'auto' },
  { name: 'reduced', os: 'reduce', setting: 'auto' },
  { name: 'explicit-full', os: 'reduce', setting: 'off' },
]) {
  test(`solo bot: delayed frames cannot start the border before score completion (${preference.name})`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 518, height: 722 });
    await page.emulateMedia({ reducedMotion: preference.os });
    await page.addInitScript(setting => {
      localStorage.setItem('spine.uiPreferences', JSON.stringify({ reducedMotion: setting, soundFx: true, vibration: false }));
      window.turnTones = [];
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        createOscillator() {
          const osc = super.createOscillator();
          let freq;
          const set = osc.frequency.setValueAtTime.bind(osc.frequency);
          osc.frequency.setValueAtTime = (value, time) => { freq = value; return set(value, time); };
          const start = osc.start.bind(osc);
          osc.start = time => { if (freq === 523 && osc.type === 'triangle') window.turnTones.push(performance.now()); start(time); };
          return osc;
        }
      };
    }, preference.setting);
    await page.goto('/');
    await page.waitForFunction(() => window.__spine?.enabled);
    await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
    await page.mouse.click(5, 5);
    await page.evaluate(async () => {
      const s = window.__spine;
      await s.ensureDictionaryLoaded();
      s.bootOfflineBot({ difficulty: 0 });
      s.activeGame.session.state.settings.timelimit = true;
      s.activeGame.session.state.settings.botTime = 40;
      const { serverNow } = await import('/src/game/online/serverClock.js');
      window.botTrace = { frames: [], ready: [], moves: [], started: [], finished: [] };
      const live = new Set();
      const snap = () => {
        const state = s.activeGame.session.state;
        const card = document.querySelector('#is-sb1');
        return { at: performance.now(), flash: card.classList.contains('your-turn-cue'),
          score: state.scores[1], shown: Number(document.querySelector('#is-sv2').textContent),
          chips: document.querySelectorAll('.scoring-float-label').length,
          landing: document.querySelectorAll('.score-panel-arrive').length,
          pending: live.size, timer: document.querySelector('#turn-timer-value').textContent,
          remaining: state.turnDeadlineMs - serverNow(),
          breathing: getComputedStyle(card).animationName,
        };
      };
      s.bus.on(s.EV.SCORE_PRESENTATION_STARTED, p => { live.add(p.id); botTrace.started.push({ ...p, at: performance.now() }); });
      s.bus.on(s.EV.SCORE_PRESENTATION_FINISHED, p => { live.delete(p.id); botTrace.finished.push({ ...p, at: performance.now() }); });
      s.bus.on(s.EV.TURN_PRESENTATION_READY, p => {
        if (p.currentTurnSlot === 0) {
          // The timer's finish subscriber precedes this trace's finish listener;
          // DOM cleanup is the authoritative assertion in this event callback.
          botTrace.ready.push(snap());
        }
      });
      s.bus.on(s.EV.MOVE_CONFIRMED, p => {
        if (p.slot !== 1) return;
        botTrace.moves.push({ ...p, at: performance.now() });
        if (botTrace.moves.length === 1) {
          // Reproduce an event-loop stall after the first chip starts. This
          // exposes the old race: the grace timeout runs before nested flight
          // cleanup and count-up callbacks catch up. It is test-only pressure.
          setTimeout(() => { const end = performance.now() + 1800; while (performance.now() < end) {} }, 80);
        }
      });
      window.botSampler = setInterval(() => botTrace.frames.push(snap()), 20);
    });
    for (let iteration = 0; iteration < 3; iteration++) {
      await page.evaluate(async sound => {
        const feedback = await import('/src/ui/feedbackService.js');
        feedback.setSoundEnabled(sound);
        window.__spine.activeGame.session.dispatch({ type: 'cmd/PASS_TURN' });
      }, iteration < 2);
      await page.waitForFunction(count => botTrace.ready.length > count, iteration, { timeout: 18000 });
      const ready = await page.evaluate(i => botTrace.ready[i], iteration);
      expect(ready.flash).toBe(true);
      expect(ready.chips).toBe(0);
      expect(ready.landing).toBe(0);
      expect(ready.shown).toBe(ready.score);
      expect(ready.timer).toBe('40');
      expect(ready.remaining).toBeGreaterThanOrEqual(39975);
      expect(ready.remaining).toBeLessThanOrEqual(40000);
      await page.evaluate(() => {
        const s = window.__spine, state = s.activeGame.session.state;
        s.bus.emit(s.EV.TURN_CHANGED, { currentTurnSlot: state.currentTurnSlot, turnNumber: state.turnNumber });
      });
      await page.waitForTimeout(1400);
      expect(await page.locator('#turn-timer-value').textContent()).toBe('39');
      expect(await page.locator('#is-sb1').getAttribute('class')).not.toContain('your-turn-cue');
    }
    const result = await page.evaluate(() => { clearInterval(botSampler); return { ...botTrace, tones: turnTones }; });
    expect(result.ready).toHaveLength(3);
    expect(result.moves).toHaveLength(3);
    expect(result.tones).toHaveLength(2);
    for (let i = 0; i < 2; i++) expect(Math.abs(result.tones[i] - result.ready[i].at)).toBeLessThan(25);
    expect(result.frames.filter(f => f.flash && (f.chips || f.landing || f.shown !== f.score))).toEqual([]);
    expect(result.frames.filter(f => f.pending > 0).every(f => f.timer === '40')).toBe(true);
    const tracePath = testInfo.outputPath('actual-bot-trace.json');
    fs.writeFileSync(tracePath, JSON.stringify(result, null, 2));
    await testInfo.attach('actual-bot-trace', { path: tracePath, contentType: 'application/json' });
  });
}
