import { SaleorCloudAPL } from "@saleor/app-sdk/APL";
import { WebhookManifest } from "@saleor/app-sdk/types";
import { WebhookMigrationRunner } from "@saleor/webhook-utils";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/env";

import { createInstrumentedGraphqlClient } from "../src/lib/create-instrumented-graphql-client";
import { appWebhooks } from "../webhooks";
import { createMigrationScriptLogger } from "./migration-logger";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const logger = createMigrationScriptLogger("WebhooksMigrationScript");

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,
  environment: env.ENV,
  includeLocalVariables: true,
  skipOpenTelemetrySetup: true,
  ignoreErrors: [],
  integrations: [],
});

const runMigrations = async () => {
  logger.info(`Starting webhooks migration`);

  if (!env.REST_APL_TOKEN || !env.REST_APL_ENDPOINT) {
    logger.error("REST_APL_TOKEN and REST_APL_ENDPOINT must be set");
    process.exit(1);
  }

  const saleorAPL = new SaleorCloudAPL({
    token: env.REST_APL_TOKEN,
    resourceUrl: env.REST_APL_ENDPOINT,
  });

  const saleorCloudEnv = await saleorAPL.getAll().catch(() => {
    logger.error("Could not fetch instances from the Cloud APL");

    process.exit(1);
  });

  await Promise.allSettled(
    saleorCloudEnv.map(async (saleorEnv) => {
      const { saleorApiUrl, token } = saleorEnv;

      logger.info(`Migrating webhooks for ${saleorApiUrl}`);

      const client = createInstrumentedGraphqlClient({
        saleorApiUrl: saleorApiUrl,
        token: token,
      });

      const runner = new WebhookMigrationRunner({
        dryRun,
        logger,
        client,
        saleorApiUrl,
        getManifests: async ({ appDetails }) => {
          const webhooks = appDetails.webhooks;

          if (!webhooks?.length) {
            logger.warn("The environment does not have any webhooks, skipping");
            return [];
          }

          // All webhooks in this application are turned on or off. If any of them is enabled, we enable all of them.
          const enabled = webhooks.some((w) => w.isActive);

          const targetUrl = appDetails.appUrl;

          if (!targetUrl?.length) {
            logger.error("App has no defined appUrl, skipping");
            return [];
          }

          const baseUrl = new URL(targetUrl).origin;

          return appWebhooks.map((w) => {
            const manifest: WebhookManifest = {
              ...w.getWebhookManifest(baseUrl),
              isActive: enabled,
            };

            return manifest;
          });
        },
      });

      await runner.migrate().catch((error) => {
        Sentry.captureException(error);
      });
    }),
  );
};

runMigrations();

process.on("beforeExit", () => {
  logger.info(`Webhook migration complete for all environments from saleor-cloud APL`);
  process.exit(0);
});
