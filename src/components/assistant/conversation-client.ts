import type {
  AssistantMessage,
  ConversationHistoryItem,
  ConversationProject,
} from "./types";
import type { ProjectCreationDraft } from "./project-personalization";

const SAFE_ERROR = "Je n’ai pas pu enregistrer ta demande.";

type ConversationListPayload = {
  conversations?: ConversationHistoryItem[];
};

type ConversationPayload = {
  conversation?: ConversationHistoryItem;
};

type ConversationMessagesPayload = {
  messages?: AssistantMessage[];
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(SAFE_ERROR);
  }
}

export async function fetchConversationHistory(): Promise<
  ConversationHistoryItem[]
> {
  const response = await fetch("/api/assistant/conversations", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const payload = (await readJson(response)) as ConversationListPayload;
  if (!response.ok || !Array.isArray(payload.conversations)) {
    throw new Error(SAFE_ERROR);
  }
  return payload.conversations;
}

export async function createAssistantConversation(
  clientId?: string | null,
): Promise<ConversationHistoryItem> {
  const response = await fetch("/api/assistant/conversations", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ clientId: clientId ?? null }),
  });
  const payload = (await readJson(response)) as ConversationPayload;
  if (!response.ok || !payload.conversation) {
    throw new Error(SAFE_ERROR);
  }
  return payload.conversation;
}

export async function fetchConversationMessages(
  conversationId: string,
): Promise<AssistantMessage[]> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(conversationId)}`,
    {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    },
  );
  const payload = (await readJson(response)) as ConversationMessagesPayload;
  if (!response.ok || !Array.isArray(payload.messages)) {
    throw new Error(SAFE_ERROR);
  }
  return payload.messages;
}

export async function deleteAssistantConversation(
  conversationId: string,
): Promise<void> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 204) return;
  await readJson(response);
  throw new Error(SAFE_ERROR);
}

export async function organizeAssistantConversation(params: {
  conversationId: string;
  clientId?: string | null;
  projectId?: string | null;
}): Promise<{
  clientId?: string | null;
  clientName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(params.conversationId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(params.clientId !== undefined ? { clientId: params.clientId } : {}),
        ...(params.projectId !== undefined
          ? { projectId: params.projectId }
          : {}),
      }),
    },
  );
  const payload = (await readJson(response)) as {
    organization?: {
      clientId?: string | null;
      clientName?: string | null;
      projectId?: string | null;
      projectName?: string | null;
    };
  };
  if (!response.ok || !payload.organization) {
    throw new Error(SAFE_ERROR);
  }
  return payload.organization;
}

export async function renameAssistantConversation(
  conversationId: string,
  title: string,
): Promise<string> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ title }),
    },
  );
  const payload = (await readJson(response)) as { title?: string };
  if (!response.ok || typeof payload.title !== "string") {
    throw new Error(SAFE_ERROR);
  }
  return payload.title;
}

export async function persistAssistantConversationTurn(params: {
  conversationId: string;
  userContent: string;
  assistantContent: string;
}): Promise<void> {
  const response = await fetch(
    `/api/assistant/conversations/${encodeURIComponent(params.conversationId)}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userContent: params.userContent,
        assistantContent: params.assistantContent,
      }),
    },
  );
  if (response.status === 204) return;
  await readJson(response);
  throw new Error(SAFE_ERROR);
}

export async function fetchConversationProjects(): Promise<
  ConversationProject[]
> {
  const response = await fetch("/api/assistant/projects", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const payload = (await readJson(response)) as {
    projects?: ConversationProject[];
  };
  if (!response.ok || !Array.isArray(payload.projects)) {
    throw new Error(SAFE_ERROR);
  }
  return payload.projects;
}

export async function createAssistantProject(
  draft: ProjectCreationDraft,
): Promise<ConversationProject> {
  const response = await fetch("/api/assistant/projects", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(draft),
  });
  const payload = (await readJson(response)) as {
    project?: ConversationProject;
  };
  if (!response.ok || !payload.project) throw new Error(SAFE_ERROR);
  return payload.project;
}

export async function updateAssistantProject(
  projectId: string,
  draft: ProjectCreationDraft,
): Promise<ConversationProject> {
  const response = await fetch(
    `/api/assistant/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(draft),
    },
  );
  const payload = (await readJson(response)) as {
    project?: ConversationProject;
  };
  if (!response.ok || !payload.project) throw new Error(SAFE_ERROR);
  return payload.project;
}

export async function deleteAssistantProject(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/assistant/projects/${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 204) return;
  await readJson(response);
  throw new Error(SAFE_ERROR);
}
