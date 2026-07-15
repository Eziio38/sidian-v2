import { NextResponse } from "next/server";

import { getAppEnvironment } from "@/config/env-shared";
import { checkDatabaseHealth } from "@/lib/health/check-database";

export async function GET() {
  const database = await checkDatabaseHealth();
  const environment = getAppEnvironment();
  const isOperational =
    database === "connected" || database === "not_configured";

  return NextResponse.json(
    {
      status: isOperational ? "ok" : "unavailable",
      app: "sidian-v2",
      environment,
      database,
    },
    { status: isOperational ? 200 : 503 },
  );
}
