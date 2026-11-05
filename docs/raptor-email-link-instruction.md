Raptor: add "Email me a sign-in link" to the staff sign-in page (asked by Stephan, 5 Nov 2026, in the Remus · Handover 8 session; already built in Remus).

What Stephan wants: besides email + password, a button "Email me a sign-in link". Supabase emails a link; tapping it signs the person in, no password needed. Google sign-in comes later.

How Remus did it (copy and adapt to Raptor's look, in `src/pages/auth/LoginPage.tsx`):
1. A secondary button under "Sign in", above "Forgot password?", worded "Email me a sign-in link" (envelope icon), data-testid="email-link".
2. On press: if the email box is empty, say: Enter your email first, then tap "Email me a sign-in link".
   Otherwise call
   `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/login` } })`
   `shouldCreateUser: false` is essential: only people already in Raptor can use it, a stranger never gets an account.
3. One calm answer for known and unknown addresses alike (so the page does not reveal who is on Raptor):
   "If <email> is on Raptor, a sign-in link is on its way. Open it on this device."
   Ignore Supabase errors that mean "not found / signups not allowed"; show any other error.
4. The password box can no longer be `required` (the link needs only the email): Sign in itself checks for an empty password and says "Enter your password, or tap Email me a sign-in link."
5. Give it the same press-wait as "Forgot password?" (a second link cancels the first), and add an e2e check like the reset one.

Supabase side: nothing new if "Site URL" and the /login redirect are already set for Raptor. If the email does not arrive, Raptor's Supabase needs its own email sender (SMTP) set up, the same as the reset emails.
