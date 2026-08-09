import Link from "next/link";
import { rootUrl } from "@/lib/sections";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <h2 className="text-2xl font-semibold">not found in the system</h2>
      <p className="text-muted-foreground">404 the new era era</p>
      {/* Absolute root URL, not "/": on a section host "/" is that section's
          home, and a section home that redirects (collect's does) can land the
          visitor straight back on a 404. The root home always renders. */}
      <Link
        href={rootUrl()}
        className="mt-2 text-sm underline underline-offset-4 hover:text-primary"
      >
        Go home
      </Link>
    </div>
  );
}
