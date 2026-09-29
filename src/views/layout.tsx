import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { Session } from "../env";
import { t, type Lang } from "../i18n";
import { baseStyle, themeStyle, type ThemePick } from "../theme";

export interface Flash { kind: "good" | "bad" | "info"; text: string }

export interface LayoutProps {
  storeName: string;
  /** The store's language: the page's words, and its lang attribute. */
  lang: Lang;
  theme: ThemePick;
  session: Session | null;
  active: "catalogue" | "orders" | "none";
  flash?: Flash | null;
  /** When the app last reported stock and prices, "2026-09-29 20:00" in EVE time. */
  asOf?: string | null;
  siteVersion?: string;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = (p) => (
  // ⚠️ The doctype puts the browser in standards mode. Without it Chrome gives every <form> a
  // bottom margin of 1em, which is why the header's buttons sat higher than the name.
  <>
    {raw("<!DOCTYPE html>")}
  <html lang={p.lang} data-theme={p.theme.explicit ? p.theme.chosen.key : undefined}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{p.storeName}</title>
      <style dangerouslySetInnerHTML={{ __html: themeStyle(p.theme) + baseStyle }} />
    </head>
    <body>
      <header class="bar">
        <div class="wrap">
          <h1>{p.storeName}</h1>
          <nav>
            <a href="/" class={p.active === "catalogue" ? "active" : ""}>{t(p.lang, "navPriceList")}</a>
            {p.session && <a href="/orders" class={p.active === "orders" ? "active" : ""}>{t(p.lang, "navMyOrders")}</a>}
          </nav>
          <div class="who">
            {/* The themes the store offers, as the app's own theme menu: a dropdown that applies
                itself; without script the button beside it does. */}
            {p.theme.options.length > 1 && (
              <form method="post" action="/theme">
                <select name="to" aria-label={t(p.lang, "themeLabel")} onchange="this.form.submit()">
                  {p.theme.options.map((o) => <option value={o.key} selected={o.key === p.theme.chosen.key || undefined}>{o.name}</option>)}
                </select>
                <noscript><button class="link" type="submit">{t(p.lang, "themeApply")}</button></noscript>
              </form>
            )}
            {p.session ? (
              <>
                <span>{p.session.name}</span>
                <form method="post" action="/auth/logout">
                  <input type="hidden" name="_csrf" value={p.session.csrf} />
                  <button class="link" type="submit">{t(p.lang, "signOut")}</button>
                </form>
              </>
            ) : (
              <a href="/auth/login">{t(p.lang, "signIn")}</a>
            )}
          </div>
        </div>
      </header>
      <main class="wrap">
        {p.flash && <div class={`flash ${p.flash.kind}`}>{p.flash.text}</div>}
        {p.children}
        <p class="faint" style="margin-top:24px">
          {p.asOf ? t(p.lang, "footerAsOf", { time: p.asOf }) + " " : ""}
          {p.siteVersion ? t(p.lang, "footerSite", { version: p.siteVersion }) : t(p.lang, "footerSiteNoVersion")}
        </p>
      </main>
    </body>
  </html>
  </>
);

/** A page that is only a message: a private shop, a site not set up yet, an error. */
export const Message: FC<{ title: string; text: string; link?: { href: string; label: string } }> = (p) => (
  <div class="signin">
    <h1>{p.title}</h1>
    <p>{p.text}</p>
    {p.link && <a class="btn" href={p.link.href}>{p.link.label}</a>}
  </div>
);
