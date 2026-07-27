import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const presentationCss = readFileSync('src/styles/turn-order-presentation.css', 'utf8');
const alignmentCss = readFileSync('src/styles/turn-order-final-alignment.css', 'utf8');

test.describe('turn-order final nickname alignment QA', () => {
  test('내 배지 유무와 관계없이 최종 순서 닉네임 중심은 카드 중심과 일치한다', async ({ page }) => {
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; min-width: 0; }
        ${presentationCss}
        ${alignmentCss}
      </style>
      <main class="game-shell" style="width: min(100%, 360px); padding: 16px;">
        <section class="turn-order-overlay">
          <div class="turn-order-final-list" data-testid="turn-order-final-order">
            <div class="turn-order-final-entry mine">
              <strong>1</strong>
              <span>아주긴닉네임도말줄임계약을유지합니다</span>
              <em>나</em>
            </div>
            <div class="turn-order-final-entry">
              <strong>2</strong>
              <span>AI 1</span>
            </div>
          </div>
        </section>
      </main>
    `);

    const layout = await page.getByTestId('turn-order-final-order').evaluate((element) => {
      const toBox = (target) => {
        const rect = target.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        entries: Array.from(element.querySelectorAll('.turn-order-final-entry')).map((entry) => {
          const name = entry.querySelector(':scope > span');
          const rank = entry.querySelector(':scope > strong');
          const badge = entry.querySelector(':scope > em');
          if (!(name instanceof HTMLElement) || !(rank instanceof HTMLElement)) {
            throw new Error('최종 순서 카드의 순위 또는 닉네임을 찾지 못했습니다.');
          }
          const entryBox = toBox(entry);
          const nameBox = toBox(name);
          const rankBox = toBox(rank);
          const badgeBox = badge instanceof HTMLElement ? toBox(badge) : null;
          const nameStyle = getComputedStyle(name);
          return {
            entryBox,
            nameBox,
            rankBox,
            badgeBox,
            gridTemplateColumns: getComputedStyle(entry).gridTemplateColumns,
            nameOverflow: nameStyle.overflow,
            nameTextOverflow: nameStyle.textOverflow,
            nameWhiteSpace: nameStyle.whiteSpace,
          };
        }),
      };
    });

    expect(layout.entries).toHaveLength(2);
    expect(layout.entries.filter((entry) => entry.badgeBox)).toHaveLength(1);
    expect(layout.entries.filter((entry) => !entry.badgeBox)).toHaveLength(1);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);

    for (const entry of layout.entries) {
      const entryCenter = entry.entryBox.x + entry.entryBox.width / 2;
      const nameCenter = entry.nameBox.x + entry.nameBox.width / 2;
      expect(Math.abs(nameCenter - entryCenter), '닉네임 영역은 최종 순서 카드의 실제 중앙에 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(entry.gridTemplateColumns.split(' ').filter(Boolean)).toHaveLength(3);
      expect(Math.abs(entry.rankBox.width - 28)).toBeLessThanOrEqual(1);
      if (entry.badgeBox) expect(Math.abs(entry.badgeBox.width - 32)).toBeLessThanOrEqual(1);
      expect(entry.nameOverflow).toBe('hidden');
      expect(entry.nameTextOverflow).toBe('ellipsis');
      expect(entry.nameWhiteSpace).toBe('nowrap');
    }
  });
});
