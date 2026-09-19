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

/** The variant a buyer with this cookie sees, or null to follow their system preference. */
export function pickVariant(theme: Theme, cookie: string | undefined): { variant: Variant; explicit: boolean } {
  const fallback: Variant = theme.default === "light" ? "light" : "dark";
  if (theme.buyerMaySwitch && (cookie === "dark" || cookie === "light")) return { variant: cookie, explicit: true };
  return { variant: fallback, explicit: !theme.buyerMaySwitch };
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
export function themeStyle(theme: Theme, variant: Variant, explicit: boolean): string {
  const chosen = theme.variants[variant] ?? theme.variants[theme.default] ?? {};
  const otherName: Variant = variant === "dark" ? "light" : "dark";
  const other = theme.variants[otherName];
  let css = `:root { color-scheme: ${variant}; ${declarations(chosen)} }`;
  if (!explicit && other)
    css += ` @media (prefers-color-scheme: ${otherName}) { :root:not([data-theme]) { color-scheme: ${otherName}; ${declarations(other)} } }`;
  return css;
}

export const baseStyle = `
*, *::before, *::after { box-sizing: border-box; }
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
header.bar .who form { display: inline; }
.panel { background: var(--surface-panel); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 14px 16px; margin-top: 16px; }
.panel h2 { font-size: 13px; font-weight: 600; color: var(--accent); margin: 0 0 8px; }
.dim { color: var(--text-dim); font-size: 12px; }
.faint { color: var(--text-faint); font-size: 11px; }
.blurb p { margin: 0 0 8px; white-space: pre-wrap; }
table.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
table.grid th {
  text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  color: var(--text-faint); padding: 6px 8px; border-bottom: 1px solid var(--border-default);
}
table.grid td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
table.grid tr:hover td { background: var(--surface-hover); }
table.grid td.num, table.grid th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.grid tr.section td { background: var(--surface-panel-alt); color: var(--text-bright); font-weight: 600; font-size: 12px; }
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
@media (prefers-reduced-motion: no-preference) {
  table.grid tr td { transition: background .12s ease; }
}
`;
