# Find a Sub — setup checklist

This adds a "Find a Sub" feature: people can register as a sub (name, cell,
email, permission to be contacted), and anyone already registered can send
a request that emails everyone else on the list.

## What's included

- `index.html` — your site, with the "Find a Sub" nav links, home card, and
  a new modal (choice → become-a-sub form → confirmation → need-a-sub form
  → confirmation) wired up in plain JS, matching your existing modal style.
- `netlify/functions/subs.js` — the backend. Stores subs in Netlify Blobs
  (built-in key/value storage, no separate database to manage) and sends
  the blast email via Resend.
- `package.json` — adds the one dependency the function needs
  (`@netlify/blobs`). **If you already have a `package.json` in your repo,
  merge this dependency into it instead of replacing the file.**

## 1. Merge into your repo

If your real site lives in a git repo (which Netlify deploys from), copy:
- `netlify/functions/subs.js` → same path in your repo
- the `@netlify/blobs` dependency into your `package.json`
- replace your `index.html` with this one, or manually copy over the
  three changed pieces (nav links, the home page card, the new modal
  markup, and the new `<script>` block at the bottom) if you've made
  other edits since this copy.

## 2. Turn on Netlify Blobs

Netlify Blobs is built into every Netlify site — nothing to sign up for.
It works automatically once the function is deployed. No environment
variable needed for this part.

## 3. Set up Resend (for the blast email)

1. Go to https://resend.com and create a free account.
2. Verify a sending domain, **or** for the very fastest start, Resend
   gives you a test sender you can use immediately while you verify your
   own domain in the background (check their onboarding — the exact
   flow may have changed since this was written, so if anything looks
   different, their dashboard will walk you through it).
3. Once you have a verified sender/domain, create an API key
   (Resend dashboard → API Keys).
4. In Netlify: **Site configuration → Environment variables**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `SUB_FROM_EMAIL` = `2Bambirds@gmail.com` (or whatever address you
     verified with Resend — it must match a domain/sender Resend has
     approved, it can't just be any Gmail address unless you've
     verified it there)
5. Redeploy the site (env var changes need a new deploy to take effect).

## 4. Test it

1. Visit your site, click **Find a Sub** → **I want to become a sub**.
2. Check the permission box, fill in the contact form, submit.
3. Click **Find a Sub** again → **I need a sub**, use the *same* email
   you just registered, fill in the game details, submit.
4. You should get an email (Resend will show the send in its dashboard
   too, which is the fastest way to debug if something doesn't arrive).

## Notes / things worth knowing

- **Only registered subs can request a sub.** The Need-a-Sub form checks
  the email you type against the stored list — if it's not found, it
  shows an error asking you to become a sub first.
- **The blast goes to everyone with permission = yes, except the
  requester.** No filtering by location/day — with a small sub pool
  that's usually simpler than it sounds; let me know if you'd rather it
  be more targeted later.
- **Re-registering with the same email just updates that person's
  info** (name/cell/permission/events opt-in) rather than creating a
  duplicate.
- **Viewing the list**: there's no admin screen yet — if you want a
  simple page to see who's registered (or export it), that's a small
  follow-up build, just say the word.
