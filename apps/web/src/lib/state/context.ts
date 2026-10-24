import { createContext } from 'svelte';

import type { Workspace } from './workspace.svelte';

/** The workspace of the currently open project, provided by WorkspaceShell. */
export const [getWorkspace, setWorkspace] = createContext<Workspace>();
