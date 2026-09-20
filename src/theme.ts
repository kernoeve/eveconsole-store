// The site's look: the store's own theme, pushed by EVE Console as colour tokens, and a
// stylesheet that only ever speaks in those tokens.
//
// The tokens are the app's palette in kebab case, so the pages read like the app's own tabs:
// panels on the base surface, the same border weights, the same text levels, meaning colours
// for stock states. Which variant shows is the store's default unless the owner lets buyers
// switch, in which case the buyer's own toggle wins and, before they have toggled, their
// system preference does.

import type { Theme } from "./protocol";

export type Variant = "dark" | "light";

export interface ThemeChoice { key: string; name: string; base: Variant; tokens: Record<string, string> }

export interface ThemePick {
  /** What this buyer sees. */
  chosen: ThemeChoice;
  /** Whether it is settled — their own pick, or nothing else on offer — rather than open to
   * their system preference swapping in the partner. */
  explicit: boolean;
  /** Everything on offer, the store's own first; more than one and the header shows a dropdown. */
  options: ThemeChoice[];
  /** The theme the buyer's system preference may swap in until they pick: the store's own
   * theme's opposite in the same family, else any of the other base. */
  partner: ThemeChoice | null;
}

const family = (key: string) => key.replace(/-(dark|light)$/, "");

/** The themes on offer: the list the app pushed, or the dark/light pair an older app pushed. */
export function themeOptions(theme: Theme): ThemeChoice[] {
  if (theme.themes && theme.themes.length > 0)
    return theme.themes.map((t) => ({ key: t.key, name: t.name, base: t.base === "light" ? "light" : "dark", tokens: t.tokens ?? {} }));
  const own: Variant = theme.default === "light" ? "light" : "dark";
  const other: Variant = own === "dark" ? "light" : "dark";
  const options: ThemeChoice[] = [{ key: own, name: own === "dark" ? "Dark" : "Light", base: own, tokens: theme.variants[own] ?? {} }];
  if (theme.buyerMaySwitch && theme.variants[other])
    options.push({ key: other, name: other === "dark" ? "Dark" : "Light", base: other, tokens: theme.variants[other] });
  return options;
}

/** What a buyer with this cookie sees: their pick when it is still on offer, else the store's own. */
export function pickTheme(theme: Theme, cookie: string | undefined): ThemePick {
  const options = themeOptions(theme);
  const own = options[0];
  const picked = !cookie ? undefined
    : options.find((o) => o.key === cookie)
      // The cookie an older site set said only dark or light.
      ?? ((cookie === "dark" || cookie === "light") ? options.find((o) => o.base === cookie) : undefined);
  if (picked) return { chosen: picked, explicit: true, options, partner: null };
  const partner = options.find((o) => o.base !== own.base && family(o.key) === family(own.key))
               ?? options.find((o) => o.base !== own.base) ?? null;
  return { chosen: own, explicit: partner === null, options, partner };
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([k, v]) => `--${k}: ${cssColour(v)};`).join(" ");
}

/** Avalonia writes alpha FIRST (#aarrggbb); CSS wants it last. Six digits pass through. */
export function cssColour(hex: string): string {
  const h = hex.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(h)) return `#${h.slice(3)}${h.slice(1, 3)}`;
  return h;
}

/**
 * The variables for the page. With a switchable theme and no explicit choice, the other
 * variant is offered under the buyer's system preference; an explicit choice stamps the
 * root with data-theme and wins in both directions.
 */
export function themeStyle(pick: ThemePick): string {
  let css = `:root { color-scheme: ${pick.chosen.base}; ${declarations(pick.chosen.tokens)} }`;
  if (!pick.explicit && pick.partner)
    css += ` @media (prefers-color-scheme: ${pick.partner.base}) { :root:not([data-theme]) { color-scheme: ${pick.partner.base}; ${declarations(pick.partner.tokens)} } }`;
  return css;
}

export const baseStyle = `
*, *::before, *::after { box-sizing: border-box; }
form { margin: 0; }
html { font-size: 14px; }
body {
  margin: 0; background: var(--surface-base); color: var(--text-primary);
  font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.45;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px 48px; }
header.bar {
  background: var(--surface-header); border-bottom: 1px solid var(--border-subtle);
  position: sticky; top: 0; z-index: 2;
}
header.bar .wrap { display: flex; align-items: center; gap: 18px; padding-top: 10px; padding-bottom: 10px; }
header.bar h1 { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-bright); letter-spacing: .2px; }
header.bar nav { display: flex; gap: 14px; font-size: 13px; }
header.bar nav a { color: var(--text-muted); padding: 4px 2px; border-bottom: 2px solid transparent; }
header.bar nav a:hover { color: var(--text-primary); text-decoration: none; }
header.bar nav a.active { color: var(--accent); border-bottom-color: var(--accent); }
header.bar .who { margin-left: auto; font-size: 12px; color: var(--text-dim); display: flex; gap: 10px; align-items: center; }
header.bar .who > * { display: inline-flex; align-items: center; height: 22px; }
header.bar .who button.link { line-height: 1; }
header.bar .who select {
  background: var(--surface-raised); color: var(--text-primary); border: 1px solid var(--border-default);
  border-radius: 3px; font: inherit; font-size: 12px; padding: 0 6px; height: 22px; cursor: pointer;
}
header.bar .who select:hover { border-color: var(--border-strong); }

.panel { background: var(--surface-panel); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 14px 16px; margin-top: 16px; overflow-x: auto; }
.panel h2 { font-size: 13px; font-weight: 600; color: var(--accent); margin: 0 0 8px; }
.dim { color: var(--text-dim); font-size: 12px; }
.faint { color: var(--text-faint); font-size: 11px; }
.blurb p { margin: 0 0 8px; white-space: pre-wrap; }
.blurb > :last-child { margin-bottom: 0; }
.blurb a { text-decoration: underline; text-decoration-color: var(--accent-surface); }
.blurb img { max-width: 100%; height: auto; }
.blurb :is(code, kbd) { font-family: Consolas, Menlo, "DejaVu Sans Mono", monospace; font-size: 12px; background: var(--surface-panel-alt); padding: 1px 4px; border-radius: 3px; }
/* Laid out with block tags: the tags decide, as on any page. */
.blurb.html p { white-space: normal; }
.blurb.html :is(h1, h2, h3, h4, h5, h6) { margin: 12px 0 6px; line-height: 1.3; font-weight: 600; }
.blurb.html h1 { font-size: 17px; color: var(--text-bright); }
.blurb.html h2 { font-size: 14px; color: var(--accent); }
.blurb.html h3 { font-size: 13px; color: var(--text-bright); }
.blurb.html :is(h4, h5, h6) { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
.blurb.html > :first-child { margin-top: 0; }
.blurb.html :is(ul, ol) { margin: 0 0 8px; padding-left: 22px; }
.blurb.html li { margin: 2px 0; }
.blurb.html blockquote { margin: 0 0 8px; padding: 4px 12px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }
.blurb.html hr { border: 0; border-top: 1px solid var(--border-subtle); margin: 10px 0; }
.blurb.html pre { background: var(--surface-panel-alt); padding: 8px 10px; border-radius: 3px; overflow-x: auto; font-size: 12px; }
.blurb.html table { border-collapse: collapse; margin: 0 0 8px; }
.blurb.html :is(th, td) { border: 1px solid var(--border-subtle); padding: 4px 8px; text-align: left; vertical-align: top; }
.blurb.html th { color: var(--text-bright); background: var(--surface-panel-alt); }
.blurb.html details { margin: 0 0 8px; }
.blurb.html summary { cursor: pointer; color: var(--accent); }
.banner { margin-top: 16px; }
.banner img { display: block; width: 100%; max-height: 300px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-subtle); }
table.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
table.grid th {
  text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  color: var(--text-faint); padding: 6px 8px; border-bottom: 1px solid var(--border-default);
}
table.grid td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
table.grid tr:hover td { background: var(--surface-hover); }
table.grid td.num, table.grid th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.grid tr.section td { background: var(--surface-panel-alt); color: var(--text-bright); font-weight: 600; font-size: 12px; }
table.grid tr.ineligible td { opacity: .4; }
table.grid tr.ineligible:hover td { background: transparent; }
input[type=number].fixed { color: var(--text-dim); background: var(--surface-panel-alt); }
dialog.confirm .limit { color: var(--warn); }

.item { display: flex; align-items: center; gap: 8px; }
.item img { width: 24px; height: 24px; border-radius: 3px; background: var(--surface-input); flex: none; }
.item .group { color: var(--text-faint); font-size: 10px; }
.state { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.state.good { color: var(--good); background: var(--good-surface); }
.state.warn { color: var(--warn); background: var(--warn-surface); }
.state.info { color: var(--info); background: var(--info-surface); }
.state.bad  { color: var(--bad);  background: var(--bad-surface); }
.state.muted { color: var(--text-muted); background: var(--surface-panel-alt); }
form.order { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
input[type=number], input[type=text], textarea {
  background: var(--surface-input); color: var(--text-primary); border: 1px solid var(--border-default);
  border-radius: 3px; padding: 4px 6px; font: inherit; font-size: 12px;
}
input[type=number] { width: 72px; text-align: right; font-variant-numeric: tabular-nums; }
input:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  background: var(--surface-raised); color: var(--accent); border: 1px solid var(--accent-surface);
  border-radius: 3px; padding: 4px 12px; font: inherit; font-size: 12px; cursor: pointer;
}
button:hover { background: var(--surface-hover); color: var(--accent-hover); }
button.bad { color: var(--bad); border-color: var(--bad-surface); }
button.primary { background: var(--accent); color: var(--surface-base); border-color: var(--accent); }
button.primary:hover { background: var(--accent-hover); }
button.link { background: none; border: none; color: var(--text-muted); padding: 0; font-size: 12px; }
button.link:hover { color: var(--text-primary); text-decoration: underline; }
.flash { border-radius: 4px; padding: 10px 14px; margin-top: 16px; font-size: 13px; border: 1px solid; }
.flash.good { color: var(--good); background: var(--good-surface); border-color: var(--good-surface); }
.flash.bad  { color: var(--bad);  background: var(--bad-surface);  border-color: var(--bad-surface); }
.flash.info { color: var(--info); background: var(--info-surface); border-color: var(--info-surface); }
.note { font-size: 12px; color: var(--text-muted); }
.right { text-align: right; }
.total { font-size: 13px; color: var(--text-bright); }
.empty { padding: 24px; text-align: center; color: var(--text-dim); }
.signin { max-width: 520px; margin: 64px auto; text-align: center; }
.signin h1 { font-size: 20px; color: var(--text-bright); margin: 0 0 8px; }
.signin p { color: var(--text-muted); }
.signin a.btn { display: inline-block; margin-top: 16px; background: var(--accent); color: var(--surface-base); padding: 8px 18px; border-radius: 4px; font-weight: 600; }
.signin a.btn:hover { background: var(--accent-hover); text-decoration: none; }
@media (max-width: 720px) {
  html { font-size: 13px; }
  table.grid th.optional, table.grid td.optional { display: none; }
  header.bar .wrap { flex-wrap: wrap; gap: 8px; }
  header.bar .who { margin-left: 0; width: 100%; }
}
dialog.confirm {
  background: var(--surface-panel); color: var(--text-primary); border: 1px solid var(--border-default);
  border-radius: 6px; padding: 18px 20px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
}
dialog.confirm::backdrop { background: var(--surface-overlay-strong); }
dialog.confirm h2 { font-size: 14px; font-weight: 600; color: var(--accent); margin: 0 0 12px; }
dialog.confirm .item { gap: 10px; }
dialog.confirm .item img { width: 32px; height: 32px; }
dialog.confirm .item div { font-size: 14px; color: var(--text-bright); }
dialog.confirm table.facts { width: 100%; margin: 12px 0 4px; font-size: 13px; border-collapse: collapse; }
dialog.confirm table.facts th { text-align: left; font-weight: normal; color: var(--text-muted); padding: 4px 0; }
dialog.confirm table.facts td { text-align: right; font-variant-numeric: tabular-nums; padding: 4px 0; }
dialog.confirm table.facts td.total { color: var(--text-bright); font-weight: 600; border-top: 1px solid var(--border-subtle); }
dialog.confirm label.check { display: flex; gap: 8px; align-items: center; font-size: 12px; margin: 8px 0 0; cursor: pointer; }
dialog.confirm .note { margin: 10px 0 0; }
dialog.confirm .actions { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin-top: 14px; }
dialog.confirm button.primary { padding: 6px 16px; }
dialog.confirm { position: relative; }
dialog.confirm .busy {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--surface-panel); border-radius: 6px; font-size: 13px; color: var(--text-bright);
}
dialog.confirm .busy[hidden] { display: none; }
dialog.confirm .hourglass { font-size: 20px; display: inline-block; animation: turn 2s ease-in-out infinite; }
@keyframes turn { 0%, 40% { transform: rotate(0); } 60%, 100% { transform: rotate(180deg); } }
@media (prefers-reduced-motion: reduce) { dialog.confirm .hourglass { animation: none; } }

@media (prefers-reduced-motion: no-preference) {
  table.grid tr td { transition: background .12s ease; }
}
`;
