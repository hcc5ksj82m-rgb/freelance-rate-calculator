/* PackEV Supabase client config — BROWSER SAFE KEYS ONLY.
   - SUPABASE_ANON_KEY / publishable key: OK in the client with RLS.
   - NEVER put SUPABASE_SERVICE_ROLE_KEY (or any secret) in this file or any HTML/JS shipped to GitHub Pages.
   Login/join pages load this file; they do not embed keys inline. */
window.PACK_EV_SUPABASE = {
  SUPABASE_URL: 'https://dubzutcfjezswyvfmizy.supabase.co',
  // JWT anon key (role=anon). Publishable key optional fallback.
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Ynp1dGNmamV6c3d5dmZtaXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MTA5OTQsImV4cCI6MjEwNjM4Njk5NH0.PEVzBGx-WumpO6eRBqokUFHLY8gabHrJ57KRL1IYevs',
  SUPABASE_PUBLISHABLE_KEY: ''
};
