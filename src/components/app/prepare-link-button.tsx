"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  openPaymentReceivableAction,
  type PrepareLinkResult,
} from "@/app/actions/clients-creances";
import { Button, Input } from "@/design-system";
import { UX_COPY } from "@/lib/ux/microcopy";

import styles from "./form-layout.module.css";

export function PrepareLinkButton({ creanceId }: { creanceId: string }) {
  const [state, action, pending] = useActionState<
    PrepareLinkResult | undefined,
    FormData
  >(openPaymentReceivableAction, undefined);
  const shareUrlRef = useRef<HTMLInputElement>(null);
  const shareUrl = state?.ok ? (state.shareUrl ?? null) : null;

  /*
   * Le lien n'est affiché qu'une fois : sans déplacement du focus, un
   * utilisateur au clavier ou au lecteur d'écran reste sur le bouton et doit
   * deviner qu'un champ vient d'apparaître plus bas.
   */
  useEffect(() => {
    if (!shareUrl) return;
    shareUrlRef.current?.focus();
  }, [shareUrl]);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="creanceId" value={creanceId} />
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        loadingLabel="Préparation…"
        className={styles.submit}
      >
        Préparer le lien de paiement
      </Button>

      {/*
        Région live montée en permanence : un `role="status"` créé en même temps
        que le lien ne serait pas annoncé. Voir `.sidian-live-region`.
      */}
      <div
        role="status"
        aria-live="polite"
        className={`sidian-live-region ${shareUrl ? styles.form : ""}`}
      >
        {shareUrl ? (
          <>
            <Input
              ref={shareUrlRef}
              label="Lien de paiement à partager"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className={styles.formStatus}>
              Ce lien n’est affiché qu’une seule fois. Copiez-le maintenant.
            </p>
          </>
        ) : null}
      </div>

      {state?.ok && state.alreadyPrepared ? (
        <p className={styles.formStatus}>
          Un lien de paiement actif existe déjà pour ce paiement à recevoir.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className={`${styles.formStatus} ${styles.formError}`}>
          {UX_COPY.requestSaveFailed.title}
        </p>
      ) : null}
    </form>
  );
}
