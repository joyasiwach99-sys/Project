/** Maps Firebase Auth error codes to plain-language messages. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "That email and password don’t match an account. Check them and try again.";
    case "auth/invalid-email":
      return "Enter a valid email address, like name@example.com.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute, then try again.";
    case "auth/network-request-failed":
      return "No connection to the server. Check your internet and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact the operations admin.";
    case "auth/operation-not-allowed":
      return "Email sign-in isn’t enabled for this project yet.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Sign in instead.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 8 characters).";
    default:
      return "Something went wrong. Please try again.";
  }
}
