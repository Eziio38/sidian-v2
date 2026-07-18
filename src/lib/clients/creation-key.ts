/**
 * Machine de clé d'idempotence de création.
 * Stable sur erreur / retry ; rotation uniquement après succès.
 */
export type CreationKeyGenerator = () => string;

export function createCreationKeyMachine(
  generate: CreationKeyGenerator = () => crypto.randomUUID(),
) {
  let key = generate();

  return {
    getKey(): string {
      return key;
    },
    /** Appelé après chaque résultat d'action — ne rotate qu'en cas de succès. */
    applyActionResult(result: { ok: boolean }): string {
      if (result.ok) {
        key = generate();
      }
      return key;
    },
  };
}

export type CreationKeyMachine = ReturnType<typeof createCreationKeyMachine>;
