import type { ConversationProject } from "./types";

export function clientSpaceKey(name: string): string {
  return name.trim().toLocaleLowerCase("fr");
}

export function findProjectByName(
  projects: ConversationProject[],
  name: string,
): ConversationProject | undefined {
  const key = clientSpaceKey(name);
  return projects.find((project) => clientSpaceKey(project.name) === key);
}

export function shouldOfferClientSpace(params: {
  clientName: string | null | undefined;
  projects: ConversationProject[];
  declinedKeys: ReadonlySet<string>;
  alreadyOfferedKeys: ReadonlySet<string>;
}): boolean {
  const name = params.clientName?.trim();
  if (!name) return false;
  const key = clientSpaceKey(name);
  if (params.declinedKeys.has(key)) return false;
  if (params.alreadyOfferedKeys.has(key)) return false;
  if (findProjectByName(params.projects, name)) return false;
  return true;
}
