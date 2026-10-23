import { beamHealth } from "@/lib/beam-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return beamHealth(req); }
