import { AuthForm } from '@/features/auth/AuthForm';

/** Account creation (same layout as 1.2 Sign in; not drawn separately in Figma). */
export default function CreateAccount() {
  return (
    <AuthForm
      title="Create your account."
      body="You’ll pick a name and color next."
      submitLabel="Create account"
      next="/onboarding/name"
      switchPrompt="Already have an account?"
      switchLabel="Sign in"
      switchTo="/sign-in"
    />
  );
}
