#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

import { TlonError, LOCAL_HUMAN, type Artifact, type Project } from '@tlon/contracts';
import {
	buildFractalTree,
	detectTensions,
	type FractalNode,
	renderStoryMarkdown
} from '@tlon/core';
import {
	DEFAULT_DATABASE_URL,
	createTlonService,
	migrateDatabase,
	openDatabase,
	seedEarthMars,
	type Db,
	type TlonService
} from '@tlon/store';
import { Command, Option } from 'commander';

const principal = LOCAL_HUMAN;

type GlobalOptions = { databaseUrl: string };

const program = new Command();
program
	.name('tlon')
	.description('Tlön — Tlön command line')
	.option(
		'--database-url <url>',
		'postgres://…, pglite:memory or pglite:<dir>',
		process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
	);

/** Opens the database, runs the command with the shared service and always closes the pool. */
async function withService<T>(
	run: (service: TlonService, db: Db) => Promise<T>,
	options: { migrate?: boolean } = {}
): Promise<T> {
	const { databaseUrl } = program.opts<GlobalOptions>();
	const handle = await openDatabase(databaseUrl);
	try {
		if (options.migrate) await migrateDatabase(handle);
		return await run(createTlonService(handle.db), handle.db);
	} finally {
		await handle.close();
	}
}

function action<Args extends unknown[]>(fn: (...args: Args) => Promise<void>) {
	return async (...args: Args) => {
		try {
			await fn(...args);
		} catch (error) {
			if (error instanceof TlonError) console.error(`${error.code}: ${error.message}`);
			else console.error(`INTERNAL: ${error instanceof Error ? error.message : 'unknown error'}`);
			process.exitCode = 1;
		}
	};
}

const out = (text: string) => process.stdout.write(`${text}\n`);

program
	.command('migrate')
	.description('apply database migrations')
	.action(
		action(async () => {
			await withService(async () => undefined, { migrate: true });
			out('migrations applied');
		})
	);

program
	.command('seed')
	.description('create the Earth/Mars example project (idempotent) and print its id')
	.action(
		action(async () => {
			const project = await withService((_service, db) => seedEarthMars(db, principal), {
				migrate: true
			});
			out(project.id);
		})
	);

program
	.command('projects')
	.description('list projects')
	.action(
		action(async () => {
			const rows = await withService(async (service) => {
				const { items } = await service.listProjects(principal);
				return Promise.all(
					items.map(async (p: Project) => ({
						project: p,
						artifacts: (await service.getGraph(principal, p.id)).artifacts.length
					}))
				);
			});
			const lines = [
				['ID', 'NAME', 'DOMAIN', 'ARTIFACTS'],
				...rows.map((r) => [r.project.id, r.project.name, r.project.domain, String(r.artifacts)])
			];
			const widths = lines[0]!.map((_, col) => Math.max(...lines.map((l) => l[col]!.length)));
			for (const line of lines)
				out(
					line
						.map((cell, col) => cell.padEnd(widths[col]!))
						.join('  ')
						.trimEnd()
				);
		})
	);

function renderNode(node: FractalNode, titles: ReadonlyMap<string, string>, lines: string[]) {
	const title = (id: string) => titles.get(id) ?? id;
	const marks = [
		node.acceptedExpansion ? `expanded by ${node.acceptedExpansion.id.slice(0, 8)}` : null,
		...node.openExpansions.map((e) => `${e.status.toLowerCase()} expansion ${e.id.slice(0, 8)}`)
	].filter((m) => m !== null);
	const suffix = marks.length > 0 ? `  [${marks.join('; ')}]` : '';
	lines.push(
		`${'  '.repeat(node.depth)}${title(node.relation.fromId)} —${node.relation.type}→ ${title(node.relation.toId)}${suffix}`
	);
	for (const child of node.children) renderNode(child, titles, lines);
}

program
	.command('graph')
	.argument('<projectId>')
	.description('print the fractal tree of a project')
	.action(
		action(async (projectId: string) => {
			const graph = await withService((service) => service.getGraph(principal, projectId));
			const titles = new Map(graph.artifacts.map((a: Artifact) => [a.id, a.title]));
			const tree = buildFractalTree(graph);
			const lines = [
				`${graph.project.name} (${graph.project.domain}) ${graph.project.id}`,
				`artifacts: ${graph.artifacts.length}  relations: ${graph.relations.length}  expansions: ${graph.expansions.length}`,
				''
			];
			if (tree.length === 0) lines.push('(no relations)');
			for (const root of tree) renderNode(root, titles, lines);
			lines.push('', `tensions: ${detectTensions(graph).length}`);
			out(lines.join('\n'));
		})
	);

program
	.command('export')
	.argument('<projectId>')
	.option('-o, --out <file>', 'write to a file instead of stdout')
	.description('export a project as a JSON bundle')
	.action(
		action(async (projectId: string, options: { out?: string }) => {
			const bundle = await withService((service) => service.exportProject(principal, projectId));
			const json = `${JSON.stringify(bundle, null, 2)}\n`;
			if (options.out) {
				await writeFile(options.out, json);
				process.stderr.write(`exported ${bundle.artifacts.length} artifacts to ${options.out}\n`);
			} else {
				process.stdout.write(json);
			}
		})
	);
program
	.command('story')
	.argument('<projectId>')
	.option('-o, --out <file>', 'write to a file instead of stdout')
	.option('--annotations', 'mark authored beats vs bridges, with mechanism and assumptions')
	.addOption(
		new Option('--order <order>', 'which order to show the beats in')
			.choices(['presentation', 'chronological'])
			.default('presentation')
	)
	.option('--organizer', 'append connections, the completion report and the isolation audit')
	.description('render the scenario as a linear Markdown manuscript')
	.action(
		action(
			async (
				projectId: string,
				options: {
					out?: string;
					annotations?: boolean;
					order: 'presentation' | 'chronological';
					organizer?: boolean;
				}
			) => {
				const data = await withService(async (service) => {
					const [graph, protocol] = await Promise.all([
						service.getGraph(principal, projectId),
						service.getProtocol(principal, projectId)
					]);
					if (options.organizer !== true) return { graph, protocol };
					const [connections, completion, audit] = await Promise.all([
						service.listConnections(principal, projectId),
						service.getCompletion(principal, projectId),
						service.getAudit(principal, projectId)
					]);
					return { graph, protocol, connections: connections.items, completion, audit };
				});
				const markdown = renderStoryMarkdown(
					{ ...data.graph, triangles: data.protocol.triangles },
					{
						annotations: options.annotations === true,
						order: options.order,
						transitions: new Map(data.graph.transitions.map((t) => [t.artifactId, t.transition])),
						...('completion' in data
							? {
									connections: data.connections,
									completion: data.completion,
									audit: data.audit
								}
							: {})
					}
				);
				if (options.out) {
					await writeFile(options.out, markdown);
					process.stderr.write(`wrote ${options.out}\n`);
				} else {
					process.stdout.write(markdown);
				}
			}
		)
	);

program
	.command('completion')
	.argument('<projectId>')
	.addOption(
		new Option('--policy <policy>', 'completion policy (default: the latest run policy)').choices([
			'exploratory',
			'coherent_open_mystery',
			'causally_connected',
			'resolved'
		])
	)
	.description('print the organizer-only completion report as JSON')
	.action(
		action(async (projectId: string, options: { policy?: string }) => {
			const report = await withService((service) =>
				service.getCompletion(principal, projectId, { policy: options.policy })
			);
			out(JSON.stringify(report, null, 2));
		})
	);

program
	.command('audit')
	.argument('<projectId>')
	.description('print the isolation audit (input manifests and deny checks) as JSON')
	.action(
		action(async (projectId: string) => {
			const report = await withService((service) => service.getAudit(principal, projectId));
			out(JSON.stringify(report, null, 2));
		})
	);

const agent = program
	.command('agent')
	.description('manage agent principals and tokens (human only)');

agent
	.command('create')
	.argument('<projectId>')
	.argument('<role>', 'A | B | C | VALIDATOR')
	.argument('<name>')
	.description('create an agent principal bound to a project and print its id')
	.action(
		action(async (projectId: string, role: string, name: string) => {
			const created = await withService((service) =>
				service.createAgent(principal, projectId, { role, name })
			);
			out(created.id);
		})
	);

agent
	.command('list')
	.argument('<projectId>')
	.description('list the agent principals of a project')
	.action(
		action(async (projectId: string) => {
			const { items } = await withService((service) => service.listAgents(principal, projectId));
			for (const a of items) {
				out([a.id, a.role, a.name, a.disabledAt ? 'disabled' : 'active'].join('  '));
			}
		})
	);

agent
	.command('token')
	.argument('<projectId>')
	.argument('<principalId>')
	.option('--ttl <seconds>', 'token lifetime in seconds (60..86400, default 3600)')
	.description('issue a bearer token (printed once; only its hash is stored)')
	.action(
		action(async (projectId: string, principalId: string, options: { ttl?: string }) => {
			const issued = await withService((service) =>
				service.issueToken(
					principal,
					projectId,
					principalId,
					options.ttl === undefined ? {} : { ttlSeconds: Number(options.ttl) }
				)
			);
			out(issued.token);
			process.stderr.write(`expires ${issued.expiresAt}; the token is not shown again\n`);
		})
	);

async function readBundle(file: string): Promise<unknown> {
	const text = await readFile(file, 'utf8').catch(() => {
		throw new TlonError('VALIDATION_FAILED', `cannot read file ${file}`);
	});
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new TlonError('VALIDATION_FAILED', `${file} is not valid JSON`);
	}
}

program
	.command('import')
	.argument('<file>')
	.option('--project <id>', 'import into this (empty) project instead of creating a new one')
	.option('--name <name>', 'name of the new project (default: name from the bundle)')
	.option('--remap', 'generate fresh ids instead of preserving the bundle ids')
	.description('import a JSON bundle')
	.action(
		action(async (file: string, options: { project?: string; name?: string; remap?: boolean }) => {
			const raw = await readBundle(file);
			const result = await withService(async (service) => {
				const importOptions = { remapIds: options.remap === true };
				if (options.project)
					return service.importProject(principal, options.project, raw, importOptions);
				return service.importAsNewProject(principal, raw, { ...importOptions, name: options.name });
			});
			out(JSON.stringify(result, null, 2));
		})
	);

await program.parseAsync(process.argv);
