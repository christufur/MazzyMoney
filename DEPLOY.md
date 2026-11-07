# Deploying Mazzy Money

One image, one compose file: the Express server serves the API and the built React
app on port 8000, Postgres sits beside it, and a backup container dumps the
database every night. Only the tailnet can reach it.

You need: the machine (Ubuntu + CasaOS + Tailscale), Docker, and Tailscale
already logged in (`tailscale status` shows your machine).

## 1. Copy the repo to the server

```bash
git clone <repo-url> ~/mazzy-money
cd ~/mazzy-money
git checkout <branch>          # whatever branch holds this work
```

## 2. Create the env file

```bash
cp .env.example .env
nano .env                      # fill in every change-me value
chmod 600 .env                 # only your user can read the secrets
```

Generate the random values with `openssl rand -hex 32` (use `-hex 16` for
`INVITE_CODE`). Keep `PLAID_ENV=sandbox` until the app works, then switch to
`production`.

`.env` is gitignored. Never commit it, and never paste it into chat.

## 3. Start it

```bash
docker compose up -d --build
docker compose ps              # db, ntfy, app, backup; db and app say "healthy"
docker compose logs -f app     # migrations run, then the server listens
```

Open <http://127.0.0.1:8000/health> on the server. It should say `"healthy"`.

### Or import it in CasaOS

CasaOS → App Store → **Custom Install** → **Import**, and paste the contents of
`docker-compose.yml`. CasaOS keeps its own copy of the file, so after you edit
compose you should re-import it. The plain `docker compose` commands in this
guide work either way, and are easier to debug.

## 4. Put HTTPS in front

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8000
tailscale serve status         # shows the https URL
```

Open `https://<machine>.<tailnet>.ts.net` from any device on the tailnet.
Nothing is published to the internet: port 8000 listens on localhost only, and
Tailscale does the rest.

## 5. Tell Plaid about the HTTPS URL

Plaid only redirects back to HTTPS, so it needs this URL registered.

In the [Plaid dashboard](https://dashboard.plaid.com/team/api) → **API** →
**Allowed redirect URIs**, add:

```
https://<machine>.<tailnet>.ts.net/oauth-return
```

Use the same URL the bank returns to. Without it, OAuth banks (Chase and others)
fail with `INVALID_LINK_TOKEN` / redirect errors, while the non-OAuth banks still
work.

## 6. First login

The **first** account signed up on a fresh database does not need an invite code.
Every account after that needs the `INVITE_CODE` from `.env`, so keep it private
or the signup page is an open door to anyone on the tailnet.

Then connect a bank on the Connections page and run one sync.

## 7. Phone notifications

The compose file runs [ntfy](https://ntfy.sh) beside the app: the app posts a push
to `http://ntfy:80`, and your phone's ntfy app reads it. Nothing leaves the tailnet.

1. Expose ntfy on the tailnet with HTTPS:

   ```bash
   sudo tailscale serve --bg --https=8443 http://127.0.0.1:8090
   tailscale serve status      # shows the :8443 URL
   ```

   Put that URL in `.env` as `NTFY_PUBLIC_URL`, then `docker compose up -d ntfy`. On an
   iPhone this is what makes pushes arrive with the app closed: Apple only wakes apps
   for pushes from ntfy.sh, so your server sends ntfy.sh a "poll now" ping (a hash of the
   topic and a message id, never the text) and the phone fetches the message from you.

2. Install the **ntfy** app (iOS or Android). Add this server:

   ```
   https://<machine>.<tailnet>.ts.net:8443
   ```

3. In Mazzy Money open the account menu → **Settings**. Press **Generate** for a
   topic, press **Save**, then **Send a test**. Subscribe to that exact topic in the
   ntfy app; the test push should arrive within a few seconds.

The topic name is the only thing protecting the pushes, so treat it like a password.
Set `APP_URL` in `.env` to the app's tailnet address so a push opens the app when
tapped, and `APP_TIMEZONE` if the household is not on `America/Denver` (the weekly
recap arrives Sunday at 17:00 there). An empty `NTFY_URL` turns notifications off;
the Settings page says so instead of failing.

### What gets pushed

- A bank needs a new login (once per connection per day).
- A single new charge above the amount you set on the Settings page.
- A budget reaching 90% and 100% this month (once each per budget per month).
- A Sunday evening recap: what the week cost, what the month saved, and what still
  needs review.

## Backups

`./backups/mazzy_money_YYYY-MM-DD.sql.gz`, one per day, kept for 14 days. The
folder is next to `docker-compose.yml`; copy it somewhere off the machine now and
then, because a backup on the same disk does not survive a dead disk.

Restore one over the running database:

```bash
gunzip -c backups/mazzy_money_2026-11-02.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" -d mazzy_money
```

`POSTGRES_USER` comes from `.env`; `docker compose exec` reads `.env` on its own,
so `-U "$(grep ^POSTGRES_USER .env | cut -d= -f2)"` also works if your shell does
not have the variable.

Take a fresh dump before restoring if the current data might matter.

## Updating

```bash
git pull
docker compose up -d --build   # rebuilds, then `prisma migrate deploy` runs on start
```

Migrations run automatically when the app container starts. `docker compose down`
stops everything but keeps the data; add `-v` only if you truly want to delete the
Postgres volume.

## When something looks wrong

```bash
docker compose logs --tail=100 app
docker compose logs --tail=50 db
docker compose ps
```

- `app` restarts in a loop: usually a missing or wrong value in `.env`.
  `docker compose logs app` shows the Prisma error.
- `/health` says unhealthy: the app cannot reach Postgres. Check `docker compose ps`
  and that `POSTGRES_PASSWORD` in `.env` has not changed since the volume was created.
  Postgres only applies that password on first start.
- Pages load but API calls fail: check the browser console; the app expects `/api`
  on the same origin, which this setup provides.
