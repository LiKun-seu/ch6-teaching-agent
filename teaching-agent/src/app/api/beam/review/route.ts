import { beamProxy } from "@/lib/beam-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) { return beamProxy(req, "review"); }
