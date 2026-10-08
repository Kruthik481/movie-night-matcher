import { type Browser, expect, type Page, test } from '@playwright/test';

async function hostRoom(browser: Browser, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Start a room' });
  await form.getByLabel('Your nickname').fill(nickname);
  await form.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/room\/[A-HJ-NP-Z2-9]{6}$/);
  return page;
}

async function joinByLink(browser: Browser, url: string, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await page.getByLabel('Your nickname').fill(nickname);
  await page.getByRole('button', { name: 'Join room' }).click();
  return page;
}

test('two friends swipe to a match and see where it streams', async ({ browser }) => {
  const host = await hostRoom(browser, 'Ana');
  const guest = await joinByLink(browser, host.url(), 'Ben');

  await expect(host.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await host.getByRole('button', { name: 'Start swiping' }).click();

  for (const page of [host, guest]) {
    await expect(page.getByText('Test Movie 101')).toBeVisible();
    await page.getByRole('button', { name: 'Like' }).click();
  }

  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: "It's a match!" })).toBeVisible();
    await expect(page.getByText('Netflix')).toBeVisible();
  }
});

test('a refresh mid-deck resumes at the same card', async ({ browser }) => {
  const host = await hostRoom(browser, 'Ana');
  const guest = await joinByLink(browser, host.url(), 'Ben');
  await expect(host.getByRole('list', { name: 'Members' }).getByText('Ben')).toBeVisible();
  await host.getByRole('button', { name: 'Start swiping' }).click();

  await expect(guest.getByText('Test Movie 101')).toBeVisible();
  await guest.getByRole('button', { name: 'Pass' }).click();
  await expect(guest.getByText('Test Movie 102')).toBeVisible();

  await guest.reload();
  await expect(guest.getByText('Test Movie 102')).toBeVisible();
  await expect(guest.getByText('2 / 3')).toBeVisible();
});
