# EVE Console Store

A shop front on the web for an [EVE Console](https://github.com/kernoeve/EveConsole) store.
Buyers sign in with EVE SSO, see the store's price list with what is in stock, in build and
reserved, place orders and follow them. The app pushes the site what it may show and collects
what buyers did; nothing on the site reaches the app's database.

One store is one site: a Cloudflare Worker with a D1 database, on your own Cloudflare account.
The free tier covers a shop many times over.

## Set up by hand

You need a Cloudflare account, Node.js, and an EVE developer application.

1. Register an application at https://developers.eveonline.com with the callback URL
   `https://<your site>/auth/callback` and no scopes. Keep its client id and secret.
2. Clone or download this repository and run `npm install`.
3. `npx wrangler login`, then `npx wrangler d1 create eveconsole-store` and paste the
   `database_id` it prints into `wrangler.toml`.
4. Set the three secrets: `npx wrangler secret put STORE_SYNC_SECRET` (the secret shown on the
   store's Config tab in EVE Console), `EVE_CLIENT_ID` and `EVE_CLIENT_SECRET`.
5. `npx wrangler deploy`. The site's address is printed; the database schema is created on the
   first request.
6. In EVE Console, on the store's Config tab, enter the site address, make sure the secret
   matches, and switch the web channel on. The first sync fills the site.

Updating is `git pull` and `npx wrangler deploy` again. The schema migrates itself, additively,
and never touches the orders and settings the site already holds.

## Set up from EVE Console

The store's Config tab can deploy and update the site for you through Cloudflare's API, under
"Hosting on Cloudflare":

1. Make an API token at dash.cloudflare.com (My Profile, API Tokens) from the "Edit Cloudflare
   Workers" template with "D1: Edit" added. Paste it into the app and press Save token; it stays
   on that machine only, encrypted for your account.
2. Pick the account if the token reaches more than one, and a worker name; the site's address
   is that name on your account's workers.dev.
3. Press Deploy. The app creates the database, uploads the newest release of the site, sets the
   store's secret, switches on the workers.dev address and puts it on the store.
4. Register the EVE application with the callback the app shows (the site address plus
   `/auth/callback`), enter its client id and secret key, and press Deploy again.

Press Check to see what the site runs against the newest release, and Deploy again to update;
the site's orders and settings are never touched. A site set up by hand and one deployed by the
app are the same thing afterwards; either can be updated either way.

## How it talks to the app

See [docs/protocol.md](docs/protocol.md). The app calls `POST /api/sync` every few minutes with
a signed request; the site never calls the app.

## Developing

`npm install`, then:

- `npm run dev` runs the site locally with wrangler. Put the three secrets in a `.dev.vars`
  file (`STORE_SYNC_SECRET=…` and so on); git ignores it.
- `npm test` runs the tests inside the Workers runtime; `npm run typecheck` checks the types.
- `npm run bundle` builds `dist/index.js` and `dist/manifest.json`, the files a release carries.

A release is a tag `v<version>` matching `package.json`. The workflow builds the bundle and
attaches it to the release, and that is what EVE Console's Deploy and Update buttons fetch.
