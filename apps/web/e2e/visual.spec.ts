import { type Browser, expect, type Page, test } from '@playwright/test';

// Visual review only: SHOTS=1 npx playwright test visual  → test-results/shots/*.png
test.skip(!process.env.SHOTS, 'visual review runs only with SHOTS=1');
test.setTimeout(120_000);

const OUT = 'test-results/shots';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };

async function open(browser: Browser, viewport: { width: number; height: number }, url = '/'): Promise<Page> {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 400)));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 400)));
  await page.goto(url);
  return page;
}

async function shot(page: Page, name: string, settleMs = 1800) {
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function host(browser: Browser, viewport: typeof PHONE): Promise<Page> {
  const page = await open(browser, viewport);
  const form = page.getByRole('form', { name: 'Start a room' });
  await form.getByLabel('Your nickname').fill('Kruthik');
  await form.getByRole('button', { name: 'Comedy' }).click();
  await form.getByRole('button', { name: 'Sci-Fi' }).click();
  await form.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/room\//);
  return page;
}

async function join(browser: Browser, url: string, nickname: string, viewport = PHONE): Promise<Page> {
  const page = await open(browser, viewport, url);
  await page.getByLabel('Your nickname').fill(nickname);
  await page.getByRole('button', { name: 'Join room' }).click();
  return page;
}

test('home', async ({ browser }) => {
  await shot(await open(browser, DESKTOP), 'home-desktop', 2600);
  await shot(await open(browser, PHONE), 'home-phone', 2600);
});

test('room flow to a match', async ({ browser }) => {
  const a = await host(browser, PHONE);
  const invite = await open(browser, PHONE, a.url().replace(/^.*\/room\//, '/room/'));
  await shot(invite, 'invite-phone');
  const b = await join(browser, a.url(), 'Ben');
  await join(browser, a.url(), 'Asha', DESKTOP);
  await expect(a.getByRole('list', { name: 'Members' }).getByText('Asha')).toBeVisible();
  await shot(a, 'lobby-phone', 2600);

  await a.getByRole('button', { name: 'Start swiping' }).click();
  await expect(a.getByText('Interstellar')).toBeVisible();
  await shot(a, 'swipe-phone', 1500);

  // drag a little to show the stamp
  const card = a.locator('article').last();
  const box = await card.boundingBox();
  if (box) {
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
    await shot(a, 'swipe-drag-phone', 200);
    await a.mouse.up();
  }
  await b.close();
});

test('near misses then a match', async ({ browser }) => {
  const a = await host(browser, PHONE);
  const b = await join(browser, a.url(), 'Ben', DESKTOP);
  await expect(a.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await a.getByRole('button', { name: 'Start swiping' }).click();

  for (const [aLikes, bLikes] of [[true, false], [true, false], [true, true]] as const) {
    await a.getByRole('button', { name: aLikes ? 'Like' : 'Pass' }).click();
    await b.getByRole('button', { name: bLikes ? 'Like' : 'Pass' }).click();
    await a.waitForTimeout(400);
  }
  await expect(a.getByRole('heading', { name: "It's a match!" })).toBeVisible();
  await shot(a, 'match-phone', 3200);
  await shot(b, 'match-desktop', 3200);
});

test('intermission', async ({ browser }) => {
  const a = await host(browser, PHONE);
  const b = await join(browser, a.url(), 'Ben');
  await expect(a.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await a.getByRole('button', { name: 'Start swiping' }).click();
  for (let i = 0; i < 6; i++) {
    await a.getByRole('button', { name: 'Pass' }).click();
    await b.getByRole('button', { name: 'Pass' }).click();
    await a.waitForTimeout(250);
  }
  await expect(a.getByRole('heading', { name: 'Intermission' })).toBeVisible();
  await shot(a, 'intermission-phone');
});
