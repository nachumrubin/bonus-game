const { test, expect } = require('@playwright/test');

async function boot(page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled && window.__spine?.bus);
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await page.evaluate(() => window.__spine.bootOffline2P());
  await expect(page.locator('#sg')).toBeVisible();
}

test('signature motion is distinct, repeatable, bounded, and reduced-motion safe', async ({ page }) => {
  await boot(page);

  const trace = await page.evaluate(async () => {
    const { bus, EV } = window.__spine;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const animation = id => getComputedStyle(document.getElementById(id)).animationName;
    const out = {};
    const turn = (currentTurnSlot, turnNumber) => {
      Object.assign(window.__spine.activeGame.session.state, { currentTurnSlot, turnNumber });
      bus.emit(EV.TURN_CHANGED, { currentTurnSlot, turnNumber });
    };

    // Opening sync does not cue; opponent -> local does. Re-emitting the same
    // turn signature must not restart it.
    turn(0, 1);
    turn(1, 2);
    turn(0, 3);
    out.turnAt0 = animation('sb1');
    out.turnHaloAt0 = getComputedStyle(document.getElementById('sb1'), '::after').animationName;
    await sleep(120);
    turn(0, 3);
    out.turnAt120 = animation('sb1');
    await sleep(520);
    out.turnAt640 = animation('sb1');

    const wordTiles = [[0,1,2,3,4,5,6,7].map(c => ({ r: 4, c, letter: 'א', val: 1 }))];
    bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: wordTiles[0], words: ['אא'], wordTiles, score: 8 });
    out.acceptNames = wordTiles[0].map(t => animation(`c${t.r}_${t.c}`));
    out.acceptDelays = wordTiles[0].map(t => getComputedStyle(document.getElementById(`c${t.r}_${t.c}`)).animationDelay);
    out.acceptFront = getComputedStyle(document.getElementById('c4_0'), '::after').animationName;
    await sleep(820);
    out.acceptAfter820 = animation('c4_0');

    const main = [{ r:4,c:3 }, { r:4,c:4 }, { r:4,c:5 }];
    const cross = [{ r:3,c:4 }, { r:4,c:4 }, { r:5,c:4 }];
    bus.emit(EV.MOVE_CONFIRMED, {
      slot:0, placed:main, words:['אבג','דהו'], wordTiles:[main,cross], score:6,
    });
    out.secondaryPlate = getComputedStyle(document.getElementById('c3_4'), '::before').animationName;
    out.secondaryFront = getComputedStyle(document.getElementById('c3_4'), '::after').animationName;

    const state = window.__spine.activeGame.session.state;
    state.pendingScoreCommit = { slot: 0 };
    state.activeBoosts.push({ slot: 0, boostId: 'extra_turn', bonusIdx: 2, payload: {}, turnNumber: 3 });
    bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'extra_turn', bonusIdx: 2, payload: {} });
    await sleep(20);
    out.boostSquare = getComputedStyle(document.getElementById('bsq-2'), '::before').animationName;
    out.badge = document.querySelector('#sb1 [data-badge="extra-turn"]')?.className ?? '';
    out.modalAt20 = !!document.querySelector('.bonus-award-positioner');
    await sleep(430);
    out.badge = document.querySelector('#sb1 [data-badge="extra-turn"]')?.className ?? '';
    out.modalAt450 = !!document.querySelector('.bonus-award-positioner');
    return out;
  });

  expect(trace.turnAt0).toContain('yourTurnCue');
  expect(trace.turnHaloAt0).toContain('yourTurnHaloExpand');
  expect(trace.turnAt120).toContain('yourTurnCue');
  expect(trace.turnAt640).not.toContain('yourTurnCue');
  expect(trace.acceptNames.every(name => name.includes('acceptedWordSweep'))).toBeTruthy();
  expect(new Set(trace.acceptDelays).size).toBeGreaterThan(1);
  expect(Math.max(...trace.acceptDelays.map(parseFloat))).toBeGreaterThanOrEqual(0.3);
  expect(trace.acceptFront).toContain('acceptedWordFront');
  expect(trace.acceptAfter820).not.toContain('acceptedWordSweep');
  expect(trace.secondaryPlate).toContain('acceptedWordPlateSecondary');
  expect(trace.secondaryFront).toContain('acceptedWordFrontVerticalSecondary');
  expect(trace.boostSquare).toContain('boostElectricCore');
  expect(trace.badge).toContain('boost-badge-enter');
  expect(trace.modalAt20).toBeFalsy();
  expect(trace.modalAt450).toBeTruthy();

  await page.reload();
  await boot(page, true);
  const reduced = await page.evaluate(async () => {
    const { bus, EV } = window.__spine;
    Object.assign(window.__spine.activeGame.session.state, { currentTurnSlot: 1, turnNumber: 1 });
    bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 1, turnNumber: 1 });
    Object.assign(window.__spine.activeGame.session.state, { currentTurnSlot: 0, turnNumber: 2 });
    bus.emit(EV.TURN_CHANGED, { currentTurnSlot: 0, turnNumber: 2 });
    const wordTiles = [[{ r: 4, c: 4, letter: 'א', val: 1 }]];
    bus.emit(EV.MOVE_CONFIRMED, { slot: 0, placed: wordTiles[0], words: ['א'], wordTiles, score: 1 });
    bus.emit(EV.BOOST_ACTIVATED, { slot: 0, boostId: 'extra_turn', bonusIdx: 2, payload: {} });
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      turnStatic: document.getElementById('sb1').classList.contains('your-turn-cue'),
      turnShadow: getComputedStyle(document.getElementById('sb1')).boxShadow,
      acceptedStatic: document.getElementById('c4_4').classList.contains('rm-accept'),
      acceptedBackground: getComputedStyle(document.getElementById('c4_4')).backgroundImage,
      squareStatic: document.getElementById('bsq-2').classList.contains('bonus-activate'),
      squareGlow: getComputedStyle(document.getElementById('bsq-2'), '::before').boxShadow,
      modal: !!document.querySelector('.bonus-award-positioner'),
    };
  });
  expect(reduced).toMatchObject({ turnStatic: true, acceptedStatic: true, squareStatic: true, modal: true });
  expect(reduced.acceptedBackground).toContain('linear-gradient');
  expect(reduced.turnShadow).not.toBe('none');
  expect(reduced.squareGlow).not.toBe('none');
});

test('explicit Reduced motion: No overrides an OS reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('spine.uiPreferences', JSON.stringify({
    reducedMotion: 'off', animationsEnabled: true,
  })));
  await page.reload();
  await page.waitForFunction(() => window.__spine?.enabled && window.__spine?.bus);
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await page.evaluate(async () => {
    await window.__spine.ensureDictionaryLoaded();
    window.__spine.bootOffline2P();
    const { session, controller } = window.__spine.activeGame;
    session.state.racks[0] = ['ש','ל','ו','ם','א','ב','ג','ד'];
    window.__spine.bus.emit(window.__spine.EV.GAME_STARTED, {});
    // Exercise the genuine human path: yellow tentative tiles followed by a
    // controller confirmation of the valid four-letter word "שלום".
    controller.placeTile({ r:4,c:2,letter:'ש',val:2,rackIndex:0 });
    controller.placeTile({ r:4,c:3,letter:'ל',val:1,rackIndex:1 });
    controller.placeTile({ r:4,c:4,letter:'ו',val:1,rackIndex:2 });
    controller.placeTile({ r:4,c:5,letter:'ם',val:2,rackIndex:3 });
  });
  await expect(page.locator('#c4_2 .btile')).toBeVisible();

  const result = await page.evaluate(async () => {
    const cells = [2, 3, 4, 5].map(c => document.getElementById(`c4_${c}`));
    window.__spine.activeGame.controller.confirmMove();
    const sweepNames = cells.map(cell => getComputedStyle(cell).animationName);
    const delays = cells.map(cell => parseFloat(getComputedStyle(cell).animationDelay) * 1000);
    let peakPlateOpacity = 0;
    let maxStrongTiles = 0;
    const deadline = performance.now() + 650;
    while (performance.now() < deadline) {
      const opacities = cells.map(cell => cell.classList.contains('accepted-word-sweep')
        ? Number(getComputedStyle(cell, '::before').opacity)
        : 0);
      peakPlateOpacity = Math.max(peakPlateOpacity, ...opacities);
      maxStrongTiles = Math.max(maxStrongTiles, opacities.filter(value => value > .9).length);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await new Promise(resolve => setTimeout(resolve, 180));
    return {
      fullMotionStamp: document.documentElement.hasAttribute('data-full-motion'),
      reducedStamp: document.documentElement.hasAttribute('data-reduced-motion'),
      rightToLeft: cells.every((cell, index) => index === 0
        || cells[index - 1].getBoundingClientRect().x > cell.getBoundingClientRect().x),
      sweepNames,
      delays,
      peakPlateOpacity,
      maxStrongTiles,
      settled: cells.every(cell => !cell.classList.contains('accepted-word-sweep')),
    };
  });

  expect(result).toMatchObject({ fullMotionStamp:true, reducedStamp:false, rightToLeft:true });
  expect(result.sweepNames.every(name => name.includes('acceptedWordSweep'))).toBeTruthy();
  expect(result.delays).toEqual([0, 110, 220, 330]);
  expect(result.peakPlateOpacity).toBeGreaterThan(.9);
  expect(result.maxStrongTiles).toBeLessThanOrEqual(2);
  expect(result.settled).toBeTruthy();
});

test('a genuine vertical confirmation travels top to bottom', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.waitForFunction(() => window.__spine?.enabled && window.__spine?.bus);
  await page.addStyleTag({ content: '#ov-onboarding,#app-loading{display:none!important}' });
  await page.evaluate(async () => {
    await window.__spine.ensureDictionaryLoaded();
    window.__spine.bootOffline2P();
    const { session, controller } = window.__spine.activeGame;
    session.state.racks[0] = ['ש','ל','ו','ם','א','ב','ג','ד'];
    window.__spine.bus.emit(window.__spine.EV.GAME_STARTED, {});
    controller.placeTile({ r:2,c:4,letter:'ש',val:2,rackIndex:0 });
    controller.placeTile({ r:3,c:4,letter:'ל',val:1,rackIndex:1 });
    controller.placeTile({ r:4,c:4,letter:'ו',val:1,rackIndex:2 });
    controller.placeTile({ r:5,c:4,letter:'ם',val:2,rackIndex:3 });
  });

  const result = await page.evaluate(() => {
    const cells = [2, 3, 4, 5].map(r => document.getElementById(`c${r}_4`));
    window.__spine.activeGame.controller.confirmMove();
    return {
      topToBottom: cells.every((cell, index) => index === 0
        || cells[index - 1].getBoundingClientRect().y < cell.getBoundingClientRect().y),
      delays: cells.map(cell => parseFloat(getComputedStyle(cell).animationDelay) * 1000),
      fronts: cells.map(cell => getComputedStyle(cell, '::after').animationName),
    };
  });

  expect(result.topToBottom).toBeTruthy();
  expect(result.delays).toEqual([0, 110, 220, 330]);
  expect(result.fronts.every(name => name.includes('acceptedWordFrontVertical'))).toBeTruthy();
});
