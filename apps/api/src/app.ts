import {
	API_PREFIX,
	TlonError,
	IDEMPOTENCY_KEY_HEADER,
	IF_MATCH_HEADER,
	LOCAL_HUMAN,
	type ErrorCode,
	type Principal
} from '@tlon/contracts';
import type { TlonService } from '@tlon/store';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';

export type BuildAppOptions = {
	service: TlonService;
	/** `true` enables info-level logging; objects are passed to pino. Request bodies are never logged. */
	logger?: boolean | { level: string };
};

/** Matches the 20 MB import limit in the API spec. */
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * The single place a request becomes a principal.
 * TODO(M3 authenticated principals): resolve a bearer token / agent grant here instead of
 * returning the implicit local human. Nothing else in the API may decide who is acting.
 */
export function resolvePrincipal(_request: FastifyRequest): Principal {
	return LOCAL_HUMAN;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
	const value = request.headers[name];
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Accepts both the raw revision id and an ETag-style quoted form. */
function ifMatch(request: FastifyRequest): string | undefined {
	return headerValue(request, IF_MATCH_HEADER)
		?.replace(/^W\//, '')
		.replace(/^"(.*)"$/, '$1');
}

function fileSlug(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug === '' ? 'project' : slug.slice(0, 60);
}

function loggerConfig(logger: BuildAppOptions['logger']) {
	if (!logger) return false;
	return {
		level: typeof logger === 'object' ? logger.level : 'info',
		serializers: {
			// Method + path only: no query string, headers or body.
			req: (req: { method?: string; url?: string }) => ({
				method: req.method,
				url: req.url?.split('?')[0]
			})
		}
	};
}

type ProjectParams = { Params: { projectId: string } };
type ItemParams = { Params: { projectId: string; id: string } };

export function buildApp({ service, logger }: BuildAppOptions): FastifyInstance {
	const app = Fastify({ logger: loggerConfig(logger), bodyLimit: BODY_LIMIT_BYTES });

	// Empty bodies are valid (e.g. cancelling an expansion); malformed JSON is a typed validation error.
	app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
		const text = typeof body === 'string' ? body : body.toString('utf8');
		if (text.trim() === '') {
			done(null, undefined);
			return;
		}
		try {
			done(null, JSON.parse(text));
		} catch {
			done(new TlonError('VALIDATION_FAILED', 'request body is not valid JSON'), undefined);
		}
	});

	app.setErrorHandler((error: FastifyError | Error, request, reply) => {
		if (error instanceof TlonError) {
			return reply.code(error.status).send(error.toBody());
		}
		if (error.name === 'ZodError' && 'issues' in error) {
			return reply
				.code(400)
				.send(
					new TlonError('VALIDATION_FAILED', 'request validation failed', error.issues).toBody()
				);
		}
		const statusCode = 'statusCode' in error ? error.statusCode : undefined;
		if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
			const code: ErrorCode = 'VALIDATION_FAILED';
			const message = statusCode === 413 ? 'request body is too large' : 'malformed request';
			return reply.code(statusCode).send(new TlonError(code, message).toBody());
		}
		// Driver errors can embed query parameters (artifact text): log the class only, never the message.
		request.log.error(
			{ errorName: error.name, errorCode: 'code' in error ? error.code : undefined },
			'unhandled error'
		);
		return reply.code(500).send(new TlonError('INTERNAL', 'internal server error').toBody());
	});

	app.setNotFoundHandler((_request, reply) =>
		reply.code(404).send(new TlonError('ROUTE_NOT_FOUND', 'route not found').toBody())
	);

	const prefix = API_PREFIX;
	const project = `${prefix}/projects/:projectId`;

	app.get(`${prefix}/health`, async () => ({ ok: true }));

	app.get(`${prefix}/projects`, async (request) => service.listProjects(resolvePrincipal(request)));
	app.post(`${prefix}/projects`, async (request, reply) => {
		const created = await service.createProject(resolvePrincipal(request), request.body);
		return reply.code(201).send(created);
	});
	app.post<{ Querystring: { name?: string; remapIds?: string } }>(
		`${prefix}/projects/import`,
		async (request, reply) => {
			const result = await service.importAsNewProject(resolvePrincipal(request), request.body, {
				name: request.query.name,
				remapIds: request.query.remapIds
			});
			return reply.code(201).send(result);
		}
	);
	app.get<ProjectParams>(project, async (request) =>
		service.getProject(resolvePrincipal(request), request.params.projectId)
	);
	app.get<ProjectParams>(`${project}/graph`, async (request) =>
		service.getGraph(resolvePrincipal(request), request.params.projectId)
	);

	app.get<ProjectParams>(`${project}/artifacts`, async (request) =>
		service.listArtifacts(resolvePrincipal(request), request.params.projectId, request.query)
	);
	app.post<ProjectParams>(`${project}/artifacts`, async (request, reply) => {
		const created = await service.createArtifact(
			resolvePrincipal(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.get<ItemParams>(`${project}/artifacts/:id`, async (request) =>
		service.getArtifact(resolvePrincipal(request), request.params.projectId, request.params.id)
	);
	app.patch<ItemParams>(`${project}/artifacts/:id`, async (request) =>
		service.updateArtifact(
			resolvePrincipal(request),
			request.params.projectId,
			request.params.id,
			ifMatch(request),
			request.body
		)
	);
	app.get<ItemParams>(`${project}/artifacts/:id/revisions`, async (request) =>
		service.listRevisions(resolvePrincipal(request), request.params.projectId, request.params.id)
	);

	app.post<ProjectParams>(`${project}/relations`, async (request, reply) => {
		const created = await service.createRelation(
			resolvePrincipal(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.patch<ItemParams>(`${project}/relations/:id`, async (request) =>
		service.updateRelation(
			resolvePrincipal(request),
			request.params.projectId,
			request.params.id,
			request.body
		)
	);

	app.post<ProjectParams>(`${project}/expansions`, async (request, reply) => {
		const created = await service.createExpansion(
			resolvePrincipal(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.get<ItemParams>(`${project}/expansions/:id`, async (request) =>
		service.getExpansion(resolvePrincipal(request), request.params.projectId, request.params.id)
	);
	app.post<ItemParams>(`${project}/expansions/:id/candidates`, async (request, reply) => {
		const updated = await service.submitCandidate(
			resolvePrincipal(request),
			request.params.projectId,
			request.params.id,
			request.body
		);
		return reply.code(201).send(updated);
	});
	app.post<ItemParams>(`${project}/expansions/:id/accept`, async (request) =>
		service.acceptExpansion(
			resolvePrincipal(request),
			request.params.projectId,
			request.params.id,
			headerValue(request, IDEMPOTENCY_KEY_HEADER),
			request.body
		)
	);
	app.post<ItemParams>(`${project}/expansions/:id/reject`, async (request) =>
		service.rejectExpansion(
			resolvePrincipal(request),
			request.params.projectId,
			request.params.id,
			request.body ?? {}
		)
	);

	app.get<ProjectParams>(`${project}/export`, async (request, reply) => {
		const bundle = await service.exportProject(resolvePrincipal(request), request.params.projectId);
		return reply
			.header(
				'content-disposition',
				`attachment; filename="${fileSlug(bundle.project.name)}.tlon.json"`
			)
			.send(bundle);
	});
	app.post<ProjectParams & { Querystring: { remapIds?: string } }>(
		`${project}/import`,
		async (request, reply) => {
			const result = await service.importProject(
				resolvePrincipal(request),
				request.params.projectId,
				request.body,
				{ remapIds: request.query.remapIds }
			);
			return reply.code(201).send(result);
		}
	);

	return app;
}
