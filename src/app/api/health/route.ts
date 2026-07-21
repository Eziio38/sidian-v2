import { NextResponse } from "next/server";

import { getAppEnvironment } from "@/config/env-shared";
import {
  checkDatabaseHealth,
  type DatabaseHealthStatus,
} from "@/lib/health/check-database";

export function isHealthOperational(
  database: DatabaseHealthStatus,
  environment: string,
): boolean {
  return (
    database === "connected" ||
    (database === "not_configured" && environment === "local")
  );
}

export async function GET() {
  const database = await checkDatabaseHealth();
  const environment = getAppEnvironment();
  const isOperational = isHealthOperational(database, environment);

  return NextResponse.json(
    {
      status: isOperational ? "ok" : "unavailable",
      app: "sidian-v2",
      environment,
      database,
    },
    {
      status: isOperational ? 200 : 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
