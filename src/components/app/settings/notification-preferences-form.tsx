"use client";

import { useActionState, useId } from "react";

import type { NotificationPreferencesActionResult } from "@/app/actions/notifications";
import { AuthCheckboxField } from "@/components/auth/auth-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import {
  NOTIFICATION_EVENTS,
  type NotificationPreferences,
} from "@/lib/notification-preferences";

import formStyles from "../form-layout.module.css";
import styles from "./settings.module.css";

type NotificationPreferencesFormProps = {
  action: (
    previous: NotificationPreferencesActionResult | undefined,
    formData: FormData,
  ) => Promise<NotificationPreferencesActionResult>;
  initial: NotificationPreferences;
};

/**
 * Réglage des deux seuls emails automatiques que le runtime émet réellement.
 *
 * La liste vient de `NOTIFICATION_EVENTS`, pas d'une énumération recopiée :
 * impossible d'afficher ici un interrupteur pour un gabarit qui ne part jamais.
 */
export function NotificationPreferencesForm({
  action,
  initial,
}: NotificationPreferencesFormProps) {
  const [state, formAction] = useActionState(action, undefined);
  const id = useId();

  return (
    <form action={formAction} className={formStyles.form}>
      <fieldset className={formStyles.fieldset}>
        <legend className={formStyles.legend}>
          Emails envoyés à tes clients
        </legend>

        {NOTIFICATION_EVENTS.map((event) => (
          <AuthCheckboxField
            key={event.field}
            id={`${id}-${event.field}`}
            name={event.field}
            defaultChecked={initial[event.field]}
            label={
              <>
                <span className={styles.toggleTitle}>{event.label}</span>
                <span className={styles.toggleDescription}>
                  {event.description}
                </span>
              </>
            }
          />
        ))}
      </fieldset>

      {state?.ok === false ? (
        <p
          role="alert"
          className={`${formStyles.formStatus} ${formStyles.formError}`}
        >
          {state.message}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p
          role="status"
          className={`${formStyles.formStatus} ${formStyles.formSuccess}`}
        >
          Préférences enregistrées.
        </p>
      ) : null}

      <div className={formStyles.submit}>
        <AuthSubmitButton pendingLabel="Enregistrement…">
          Enregistrer les notifications
        </AuthSubmitButton>
      </div>
    </form>
  );
}
