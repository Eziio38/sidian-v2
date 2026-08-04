type AuthBannerProps = {
  message: string;
  tone?: "error" | "success" | "info";
};

const toneClasses: Record<NonNullable<AuthBannerProps["tone"]>, string> = {
  error: "border-danger-border bg-danger-bg text-danger",
  success: "border-success-border bg-success-bg text-success",
  info: "border-gris-200 bg-gris-50 text-gris-500",
};

export function AuthBanner({ message, tone = "error" }: AuthBannerProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2.5 text-sm ${toneClasses[tone]}`}
    >
      {message}
    </div>
  );
}
