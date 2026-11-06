import Link from "next/link";

/** Bull Street mark: the halftone bull head. */
export function Mark({ size = 28 }: { size?: number; dark?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/bull-street-mark.svg" width={size} height={size} alt="" aria-hidden className="shrink-0" />;
}

export function Wordmark({ href = "/", dark = false }: { href?: string; dark?: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-2 ${dark ? "text-on-dark" : "text-ink"}`} aria-label="Bull Street home">
      <Mark size={36} dark={dark} />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Bull Street</span>
    </Link>
  );
}
