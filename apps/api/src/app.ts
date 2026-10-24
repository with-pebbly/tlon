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

/** Structural stand-in for pino's DestinationStream (pino is not a direct dependency). */
export type LogStream = { write(message: string): void };

export type BuildAppOptions = {
	service: TlonService;
	/**
	 * `true` enables info-level logging; objects are passed to pino (`stream` redirects the
	 * output, e.g. to capture logs in tests). Request bodies, headers and query strings are never logged.
	 */
	logger?: boolean | { level: string; stream?: LogStream };
};

/** Matches the 20 MB import limit in the API spec. */
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;

/** Only the TCP peer counts: `X-Forwarded-For` and friends are attacker-controlled and ignored. */
const LOOPBACK_ADDRESSES: readonly string[] = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

export function isLoopbackAddress(address: string | undefined): boolean {
	return address !== undefined && LOOPBACK_ADDRESSES.includes(address);
}

const BEARER = /^Bearer[ \t]+(\S+)$/i;

/**
 * The single place a request becomes a principal (spec §1). `Authorization: Bearer tlon_…`
 * is resolved through the service (unexpired, unrevoked, principal enabled); a present but
 * unusable credential is UNAUTHENTICATED and never falls back to the human. Without the
 * header the implicit local human applies only to loopback TCP peers. Nothing in the body,
 * query or other headers can influence who is acting.
 */
export async function resolvePrincipal(
	service: TlonService,
	request: FastifyRequest
): Promise<Principal> {
	const header = request.headers.authorization;
	if (header !== undefined) {
		const token = BEARER.exec(header.trim())?.[1];
		if (token === undefined) {
			await service.recordUnauthenticated('malformed_credentials');
			throw new TlonError('UNAUTHENTICATED', 'invalid or expired credentials');
		}
		return service.authenticateToken(token);
	}
	if (isLoopbackAddress(request.socket.remoteAddress)) return LOCAL_HUMAN;
	await service.recordUnauthenticated('no_credentials');
	throw new TlonError('UNAUTHENTICATED', 'authentication required');
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
		...(typeof logger === 'object' && logger.stream ? { stream: logger.stream } : {}),
		// Defence in depth: the req serializer already drops headers; never let a credential through.
		redact: { paths: ['req.headers.authorization', 'headers.authorization'], censor: '[redacted]' },
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
type AgentParams = { Params: { projectId: string; principalId: string } };
type TokenParams = { Params: { projectId: string; principalId: string; tokenId: string } };
type GrantParams = { Params: { projectId: string; grantId: string } };

export function buildApp({ service, logger }: BuildAppOptions): FastifyInstance {
	const app = Fastify({ logger: loggerConfig(logger), bodyLimit: BODY_LIMIT_BYTES });
	const act = (request: FastifyRequest) => resolvePrincipal(service, request);

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

	app.get(`${prefix}/projects`, async (request) => service.listProjects(await act(request)));
	app.post(`${prefix}/projects`, async (request, reply) => {
		const created = await service.createProject(await act(request), request.body);
		return reply.code(201).send(created);
	});
	app.post<{ Querystring: { name?: string; remapIds?: string } }>(
		`${prefix}/projects/import`,
		async (request, reply) => {
			const result = await service.importAsNewProject(await act(request), request.body, {
				name: request.query.name,
				remapIds: request.query.remapIds
			});
			return reply.code(201).send(result);
		}
	);
	app.get<ProjectParams>(project, async (request) =>
		service.getProject(await act(request), request.params.projectId)
	);
	app.get<ProjectParams>(`${project}/graph`, async (request) =>
		service.getGraph(await act(request), request.params.projectId)
	);

	app.get<ProjectParams>(`${project}/artifacts`, async (request) =>
		service.listArtifacts(await act(request), request.params.projectId, request.query)
	);
	app.post<ProjectParams>(`${project}/artifacts`, async (request, reply) => {
		const created = await service.createArtifact(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.get<ItemParams>(`${project}/artifacts/:id`, async (request) =>
		service.getArtifact(await act(request), request.params.projectId, request.params.id)
	);
	app.patch<ItemParams>(`${project}/artifacts/:id`, async (request) =>
		service.updateArtifact(
			await act(request),
			request.params.projectId,
			request.params.id,
			ifMatch(request),
			request.body
		)
	);
	app.get<ItemParams>(`${project}/artifacts/:id/revisions`, async (request) =>
		service.listRevisions(await act(request), request.params.projectId, request.params.id)
	);
	app.put<ItemParams>(`${project}/artifacts/:id/transition`, async (request, reply) => {
		const annotation = await service.putTransition(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body
		);
		return reply.code(201).send(annotation);
	});

	app.get<ProjectParams>(`${project}/issues`, async (request) =>
		service.listIssues(await act(request), request.params.projectId)
	);
	app.post<ProjectParams>(`${project}/issues/dismiss`, async (request) =>
		service.dismissIssue(await act(request), request.params.projectId, request.body)
	);

	app.post<ProjectParams>(`${project}/composites`, async (request, reply) => {
		const created = await service.createComposite(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.get<ItemParams & { Querystring: { depth?: string } }>(
		`${project}/composites/:id`,
		async (request) =>
			service.getComposite(
				await act(request),
				request.params.projectId,
				request.params.id,
				request.query
			)
	);
	app.post<ItemParams>(`${project}/composites/:id/revisions`, async (request, reply) => {
		const revised = await service.reviseComposite(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body
		);
		return reply.code(201).send(revised);
	});
	app.get<ItemParams>(`${project}/composites/:id/revisions`, async (request) =>
		service.listCompositeRevisions(await act(request), request.params.projectId, request.params.id)
	);
	app.post<ItemParams>(`${project}/composites/:id/archive`, async (request) => {
		const body = request.body as { reason?: unknown } | undefined;
		return service.archiveComposite(
			await act(request),
			request.params.projectId,
			request.params.id,
			typeof body?.reason === 'string' ? body.reason : undefined
		);
	});

	app.post<ProjectParams>(`${project}/relations`, async (request, reply) => {
		const created = await service.createRelation(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.patch<ItemParams>(`${project}/relations/:id`, async (request) =>
		service.updateRelation(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body
		)
	);

	app.post<ProjectParams>(`${project}/expansions`, async (request, reply) => {
		const created = await service.createExpansion(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.get<ItemParams>(`${project}/expansions/:id`, async (request) =>
		service.getExpansion(await act(request), request.params.projectId, request.params.id)
	);
	app.post<ItemParams>(`${project}/expansions/:id/candidates`, async (request, reply) => {
		const updated = await service.submitCandidate(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body
		);
		return reply.code(201).send(updated);
	});
	app.post<ItemParams>(`${project}/expansions/:id/accept`, async (request) =>
		service.acceptExpansion(
			await act(request),
			request.params.projectId,
			request.params.id,
			headerValue(request, IDEMPOTENCY_KEY_HEADER),
			request.body
		)
	);
	app.post<ItemParams>(`${project}/expansions/:id/reject`, async (request) =>
		service.rejectExpansion(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body ?? {}
		)
	);

	app.get<ProjectParams>(`${project}/export`, async (request, reply) => {
		const bundle = await service.exportProject(await act(request), request.params.projectId);
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
				await act(request),
				request.params.projectId,
				request.body,
				{ remapIds: request.query.remapIds }
			);
			return reply.code(201).send(result);
		}
	);

	app.get(`${prefix}/whoami`, async (request) => service.whoami(await act(request)));

	app.get<ProjectParams>(`${project}/agents`, async (request) =>
		service.listAgents(await act(request), request.params.projectId)
	);
	app.post<ProjectParams>(`${project}/agents`, async (request, reply) => {
		const created = await service.createAgent(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.post<AgentParams>(`${project}/agents/:principalId/disable`, async (request) =>
		service.disableAgent(await act(request), request.params.projectId, request.params.principalId)
	);
	app.post<AgentParams>(`${project}/agents/:principalId/tokens`, async (request, reply) => {
		const issued = await service.issueToken(
			await act(request),
			request.params.projectId,
			request.params.principalId,
			request.body ?? {}
		);
		return reply.code(201).send(issued);
	});
	app.post<TokenParams>(
		`${project}/agents/:principalId/tokens/:tokenId/revoke`,
		async (request, reply) => {
			await service.revokeToken(
				await act(request),
				request.params.projectId,
				request.params.principalId,
				request.params.tokenId
			);
			return reply.code(204).send();
		}
	);

	app.get<ProjectParams>(`${project}/grants`, async (request) =>
		service.listGrants(await act(request), request.params.projectId)
	);
	app.post<ProjectParams>(`${project}/grants`, async (request, reply) => {
		const created = await service.createGrant(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.post<GrantParams>(`${project}/grants/:grantId/revoke`, async (request) =>
		service.revokeGrant(await act(request), request.params.projectId, request.params.grantId)
	);

	app.get<ProjectParams>(`${project}/disclosures`, async (request) =>
		service.listDisclosures(await act(request), request.params.projectId)
	);
	app.post<ProjectParams>(`${project}/disclosures`, async (request, reply) => {
		const created = await service.proposeDisclosure(
			await act(request),
			request.params.projectId,
			request.body
		);
		return reply.code(201).send(created);
	});
	app.post<ItemParams>(`${project}/disclosures/:id/review`, async (request) =>
		service.reviewDisclosure(
			await act(request),
			request.params.projectId,
			request.params.id,
			request.body ?? {}
		)
	);

	app.get<ProjectParams>(`${project}/audit/own`, async (request) =>
		service.listOwnAudit(await act(request), request.params.projectId, request.query)
	);

	return app;
}
