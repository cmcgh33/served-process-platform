import { SignOutButton } from "@clerk/react";
import { LogOut } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Props {
  /** Override the default sign-out label. */
  label?: string;
  /** Where to land after sign-out (defaults to the public marketing site). */
  redirectUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}

/**
 * Renders a "Log out" button that signs the user out via Clerk and bounces
 * back to the public marketing landing page.
 */
export function SignOutLink({
  label = "Log Out",
  redirectUrl,
  className,
  style,
  testId = "button-sign-out",
}: Props) {
  const target = redirectUrl ?? `${basePath || ""}/`;
  return (
    <SignOutButton redirectUrl={target}>
      <button
        type="button"
        className={
          className ??
          "flex items-center gap-2.5 w-full rounded-md px-1 py-1.5 text-sm transition-colors hover:text-white"
        }
        style={style ?? { color: "rgba(255,255,255,0.45)" }}
        data-testid={testId}
      >
        <LogOut className="w-4 h-4" />
        <span>{label}</span>
      </button>
    </SignOutButton>
  );
}
