#!/usr/bin/env node
// Hit areas on the compact controls, and the two ways this fix silently stops working.
//
//   The compact strip is drawn at --ctl-h (36px) and a few square controls at 32. The design's
//   own --tap token says 44. That gap sat unnoticed because verify-maxdock exempts the approved
//   composed stylesheet from its tap-target rule, so nothing failed while a whole control family
//   was 8px short on the iPad this product is used on at a dock.
//
//   The fix keeps every drawn pixel and puts the missing area in a transparent ::after. Two
//   things can quietly undo it, and neither shows up by looking at the page:
//
//   1. Applying it to a <select> or an <input>. Those are replaced elements and browsers do not
//      generate ::before or ::after for them at all, so the rule parses, looks right in the
//      stylesheet, and does nothing. Verified in a browser rather than taken on faith: with the
//      rule applied to a select, a click three pixels below the box lands on the element behind
//      it; the same click on a button lands on the button.
//
//   2. Expanding a control horizontally when it sits in a run of other controls. Neighbours in
//      these strips are 0 to 8px apart, so a widened invisible area lands on the control beside
//      it and hands over its clicks. Only controls that sit alone get width.
//
//   The measurement itself belongs in a browser, and lives in the layout audit. This file guards
//   the shape of the rules, which is the part that rots.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const CSS = 'assets/maxdock.css';
if (!existsSync(CSS)) { console.error(`Missing ${CSS}`); process.exit(1); }

const raw = readFileSync(CSS, 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const need = (pattern, message) => { if (!pattern.test(css)) errors.push(message); };

// ── The token the whole thing is measured against ──────────────────────────────
const token = css.match(/--tap\s*:\s*(\d+(?:\.\d+)?)px/);
if (!token) errors.push('No --tap token. The hit-area rules have nothing to size themselves from.');
else if (parseFloat(token[1]) < 44) errors.push(`--tap is ${token[1]}px. 44 is the floor, on a screen used with gloves on.`);

// ── The expansion exists and is anchored ───────────────────────────────────────
need(/\.btn::after[^{]*\{[^}]*height:var\(--tap\)/,
  'Buttons have no expanded hit area. .btn draws at --ctl-h, which is 36px.');
need(/\.iconbtn::after[^{]*\{[^}]*width:var\(--tap\)[^}]*height:var\(--tap\)/,
  'Square icon buttons get no width from their hit area, so they stay 36px across.');
need(/\.btn--icon::after/,
  'The icon-only buttons in the page head (Export, Print, Customize) carry .btn--icon and are 36px square; they are not covered by the button rule, which only grows height.');
// An absolutely positioned ::after inside a static parent escapes to the page.
for (const cls of ['btn', 'iconbtn', 'linkBtn']) {
  need(new RegExp(`\\.${cls}[^{]*\\{[^}]*position:relative`),
    `.${cls} is not positioned, so its absolutely positioned hit area is placed against the page instead of the control.`);
}

// ── Never on a replaced element, where it does nothing at all ──────────────────
// Written to catch the selector, not the file: a rule that grows a select's ::after is not
// wrong-looking, it is invisible, and it would read as "done" while changing nothing.
const pseudoRules = [...css.matchAll(/([^{}]*::(?:after|before))\s*\{([^}]*)\}/g)];
for (const [, selector, body] of pseudoRules) {
  if (!/height:var\(--tap\)|width:var\(--tap\)/.test(body)) continue;
  for (const part of selector.split(',')) {
    const subject = part.trim().split(/\s+|>/).filter(Boolean).pop() || '';
    if (/^(select|input|textarea)\b|\.select::|\.input::/.test(subject) || /\b(select|input|textarea)::/.test(subject)) {
      errors.push(`${subject.trim()} grows a hit area with a pseudo-element. Browsers generate no ::before or ::after for replaced elements, so this rule does nothing while looking like it does.`);
    }
  }
}

// ── Replaced elements get theirs where there is no mouse ───────────────────────
need(/@media \(pointer:coarse\)\{[^}]*min-height:var\(--tap\)/,
  'Selects and text inputs never reach 44px anywhere. They cannot take a pseudo-element, so the only honest option left is to grow them where there is no pointer to be precise with.');
// And nowhere else: growing them on a mouse-driven desktop changes the approved design.
const coarse = css.match(/@media \(pointer:coarse\)\{([\s\S]*?)\n\}/);
if (coarse && /\.field |\.frow|\.modal /.test(coarse[1])) {
  errors.push('The coarse-pointer rule reaches beyond the control strips into the forms. A booking form keeps its density; this was scoped on purpose.');
}

// ── The compact size itself must not have been "fixed" by growing it ───────────
// The whole point is that nothing looks different. A --ctl-h of 44 would pass every rule
// above and would also push the dock board's doors off the bottom of the screen.
const ctl = css.match(/--ctl-h\s*:\s*(\d+(?:\.\d+)?)px/);
if (ctl && parseFloat(ctl[1]) >= 44) {
  errors.push(`--ctl-h is ${ctl[1]}px. The compact strip was meant to keep its drawn size; growing it is how the board stops fitting ten to fifteen doors on one screen.`);
}

if (errors.length) {
  console.error('Tap target verification failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Tap target verification passed: --tap ${token ? token[1] : '?'}px, compact strip still ${ctl ? ctl[1] : '?'}px as drawn`);
