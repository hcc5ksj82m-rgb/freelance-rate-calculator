# PackEV member security model

## What members can do
- Sign up / log in with **email + password** (Supabase Auth).
- Read and update **only their own** row in `public.profiles` (display name, timestamps).

## What members cannot do
- **No GitHub access** — joining PackEV never grants repo, deploy, or org permissions.
- **No write access to site files** — HTML/CSS/JS are static (GitHub Pages / Netlify). Auth tokens cannot edit the repo or uploaded assets.
- **No other users’ profiles** — Row Level Security (RLS) on `profiles` requires `auth.uid() = id` for SELECT / INSERT / UPDATE.
- **No service_role key in the browser** — only the anon key lives in `js/supabase-config.js`.

## How it works
1. Static pages load Supabase JS from CDN.
2. `js/supabase-config.js` holds `SUPABASE_URL` + `SUPABASE_ANON_KEY` (placeholders until configured).
3. `js/auth.js` signs users in; session is client-side.
4. Nav shows **Join / Log in** when logged out, **Account** (and Log out) when a session exists.
5. `supabase/schema.sql` creates `profiles` + RLS + signup trigger.

## Operator checklist
See `SETUP.md`. Until keys are filled in, Join/Login forms show setup instructions and submit is disabled.
