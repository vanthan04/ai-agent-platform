import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you asked for does not exist, or you cannot see it.</p>
      <Link href="/projects" className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-white">
        Go to projects
      </Link>
    </div>
  );
}
