import { verifyJWT } from "@saleor/app-sdk/auth";
import { Permission } from "@saleor/app-sdk/types";
import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";
import { TRPCError } from "@trpc/server";

import { createLogger } from "@/logger";
import { saleorApp } from "@/saleor-app";

import { middleware, procedure } from "./trpc-server";

const REQUIRED_SALEOR_PERMISSIONS: Permission[] = ["MANAGE_APPS"];

const logger = createLogger("protectedClientProcedure");

const attachAppToken = middleware(async ({ ctx, next }) => {
  if (!ctx.saleorApiUrl) {
    logger.debug("ctx.saleorApiUrl not found, throwing");

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing saleorApiUrl in request",
    });
  }

  const authData = await saleorApp.apl.get(ctx.saleorApiUrl);

  if (!authData) {
    logger.debug("authData not found, throwing 401");

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing auth data",
    });
  }

  return next({
    ctx: {
      appToken: authData.token,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
    },
  });
});

const validateClientToken = middleware(async ({ ctx, next, meta }) => {
  logger.debug("Calling validateClientToken middleware with permissions required", {
    permissions: meta?.requiredClientPermissions,
  });

  if (!ctx.token) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing token in request. This middleware can be used only in frontend",
    });
  }

  if (!ctx.appId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing appId in request. This middleware can be used after auth is attached",
    });
  }

  if (!ctx.saleorApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Missing saleorApiUrl in request. This middleware can be used after auth is attached",
    });
  }

  if (!ctx.ssr) {
    try {
      logger.debug("trying to verify JWT token from frontend", {
        token: ctx.token ? `${ctx.token[0]}...` : undefined,
      });

      await verifyJWT({
        appId: ctx.appId,
        token: ctx.token,
        saleorApiUrl: ctx.saleorApiUrl,
        requiredPermissions: [
          ...REQUIRED_SALEOR_PERMISSIONS,
          ...(meta?.requiredClientPermissions || []),
        ],
      });
    } catch (e) {
      logger.debug("JWT verification failed, throwing");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "JWT verification failed",
      });
    }
  }

  return next({
    ctx: {
      ...ctx,
      saleorApiUrl: ctx.saleorApiUrl,
    },
  });
});

/**
 * Construct common graphQL client and attach it to the context
 *
 * Can be used only if called from the frontend (react-query),
 * otherwise jwks validation will fail (if createCaller used)
 *
 * TODO Rethink middleware composition to enable safe server-side router calls
 */
export const protectedClientProcedure = procedure
  .use(attachAppToken)
  .use(validateClientToken)
  .use(async ({ ctx, next }) => {
    const client = createGraphQLClient({ saleorApiUrl: ctx.saleorApiUrl, token: ctx.appToken });

    return next({
      ctx: {
        apiClient: client,
        appToken: ctx.appToken,
        saleorApiUrl: ctx.saleorApiUrl,
        appId: ctx.appId!,
      },
    });
  });
