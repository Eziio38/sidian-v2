import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/image", () => ({
  default: function MockNextImage(props: {
    src: string | { src: string };
    alt: string;
    width?: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
    priority?: boolean;
    sizes?: string;
  }) {
    const { src, alt, width, height, className, style } = props;
    const resolved = typeof src === "string" ? src : src.src;
    return createElement("img", {
      src: resolved,
      alt,
      width,
      height,
      className,
      style,
    });
  },
}));

process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED ??= "false";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* jsdom stub */
  };
}

afterEach(() => {
  cleanup();
});
