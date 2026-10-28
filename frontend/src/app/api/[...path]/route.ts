import { forward } from "@/lib/proxy";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  return forward(request, (await context.params).path);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

// Answers per request, from the live backend; nothing here is cached or prerendered.
export const dynamic = "force-dynamic";
