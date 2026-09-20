import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { Session } from "../env";
import type { Theme } from "../protocol";
import { baseStyle, themeStyle, type Variant } from "../theme";

export interface Flash { kind: "good" | "bad" | "info"; text: string }

export interface LayoutProps {
  storeName: string;
  theme: Theme;
  variant: Variant;
  explicit: boolean;
  session: Session | null;
  active: "catalogue" | "orders" | "none";
  flash?: Flash | null;
  asOf?: string | null;
  siteVersion?: string;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = (p) => (
  // ⚠️ The doctype puts the browser in standards mode. Without it Chrome gives every <form> a
  // bottom margin of 1em, which is why the header's buttons sat higher than the name.
  <>
    {raw("<!DOCTYPE html>")}
  <html lang="en" data-theme={p.explicit ? p.variant : undefined}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{p.storeName}</title>
      <style dangerouslySetInnerHTML={{ __html: themeStyle(p.theme, p.variant, p.explicit) + baseStyle }} />
    </head>
    <body>
      <header class="bar">
        <div class="wrap">
          <h1>{p.storeName}</h1>
          <nav>
            <a href="/" class={p.active === "catalogue" ? "active" : ""}>Price list</a>
            {p.session && <a href="/orders" class={p.active === "orders" ? "active" : ""}>My orders</a>}
          </nav>
          <div class="who">
            {p.theme.buyerMaySwitch && (
              <form method="post" action="/theme">
                <input type="hidden" name="to" value={p.variant === "dark" ? "light" : "dark"} />
                <button class="link" type="submit">{p.variant === "dark" ? "Light" : "Dark"}</button>
              </form>
            )}
            {p.session ? (
              <>
                <span>{p.session.name}</span>
                <form method="post" action="/auth/logout">
                  <input type="hidden" name="_csrf" value={p.session.csrf} />
                  <button class="link" type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <a href="/auth/login">Sign in with EVE</a>
            )}
          </div>
        </div>
      </header>
      <main class="wrap">
        {p.flash && <div class={`flash ${p.flash.kind}`}>{p.flash.text}</div>}
        {p.children}
        <p class="faint" style="margin-top:24px">
          {p.asOf ? `Stock and prices as the store's system last reported them, ${p.asOf}. ` : ""}
          EVE Console store{p.siteVersion ? ` ${p.siteVersion}` : ""}.
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
