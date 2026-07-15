type AuthBannerProps = {
  message: string;
  tone?: "error" | "success" | "info";
};

const toneClasses: Record<NonNullable<AuthBannerProps["tone"]>, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
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
