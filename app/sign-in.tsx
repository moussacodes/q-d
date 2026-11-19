import { AuthForm } from '@/features/auth/AuthForm';

/** 1.2 Sign in. */
export default function SignIn() {
  return (
    <AuthForm
      title="Welcome back."
      body="Sign in to get back to your rooms."
      submitLabel="Sign in"
      mode="sign-in"
      showForgot
      switchPrompt="New to q’d?"
      switchLabel="Create an account"
      switchTo="/create-account"
    />
  );
}
