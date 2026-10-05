import { getModelCatalog } from "happy-wire";
import { Fastify } from "../types";

/**
 * Public, unauthenticated: the app fetches it before login and the CLI on
 * startup. Serves the server's active catalog (see modelCatalogRefresh), so
 * clients get new models without an app or CLI release.
 */
export function modelCatalogRoutes(app: Fastify) {
    app.get('/v1/model-catalog', async (_request, reply) => {
        reply.header('Cache-Control', 'public, max-age=300');
        return getModelCatalog();
    });
}
