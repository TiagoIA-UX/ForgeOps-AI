import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "zaea",
    version: process.env.npm_package_version ?? "1.0.0",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
}
