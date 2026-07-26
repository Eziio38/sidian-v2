"use client";

import { SuggestionIcon } from "./suggestion-icons";

type WelcomeStateProps = {
  userFirstName: string;
  summaryLines: string[];
  suggestions: Array<{ id: string; label: string; action: string }>;
  onSuggestion: (action: string) => void;
  visible: boolean;
};

export function WelcomeState({
  userFirstName,
  summaryLines,
  suggestions,
  onSuggestion,
  visible,
}: WelcomeStateProps) {
  if (!visible) {
    return null;
  }

  const [headline, ...rest] = summaryLines;

  return (
    <div
      data-testid="welcome-state"
      className="mx-auto mb-4 mt-16 flex w-full max-w-[32rem] flex-col items-center px-4 text-center motion-safe:animate-[assistant-welcome-in_180ms_ease-out] motion-reduce:animate-none"
    >
      <h1 className="text-balance text-[28px] font-semibold tracking-[-0.03em] text-assistant-text">
        Bonjour {userFirstName}
      </h1>
      <div className="mt-4 max-w-[28rem] text-pretty">
        {headline ? (
          <p className="text-[14px] leading-6 text-assistant-text/80">
            {headline}
          </p>
        ) : null}
        {rest.map((line) => (
          <p
            key={line}
            className="mt-1 text-[13px] leading-5 text-assistant-muted/70"
          >
            {line}
          </p>
        ))}
      </div>
      <div className="mt-8 flex flex-nowrap items-center justify-center gap-2 max-md:flex-wrap">
        {suggestions.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`welcome-suggestion-${item.id}`}
            onClick={() => onSuggestion(item.action)}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-[12px] text-assistant-muted/80 transition-[background-color,color,transform] duration-150 ease-out hover:bg-white/[0.07] hover:text-assistant-text motion-safe:hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidian-blue"
          >
            <SuggestionIcon action={item.action} label={item.label} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
