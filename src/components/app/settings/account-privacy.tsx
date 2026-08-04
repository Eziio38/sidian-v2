import { closeAccountAction } from "@/app/actions/account";

import { AccountClosureForm } from "./account-closure-form";
import { DataExportButton } from "./data-export-button";
import styles from "./settings.module.css";

type AccountPrivacyProps = {
  /** Adresse issue de la session serveur — jamais d'un champ de formulaire. */
  accountEmail: string;
};

/**
 * Adresse du compte, export RGPD et clôture réunis dans un seul bloc : ces
 * trois éléments répondent à la même question (« que devient mon compte ? »),
 * et les éclater en trois cartes n'aurait ajouté que du bruit.
 */
export function AccountPrivacy({ accountEmail }: AccountPrivacyProps) {
  return (
    <div className={styles.stack}>
      <dl className={styles.factList}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Adresse du compte</dt>
          <dd className={styles.factValue}>{accountEmail}</dd>
        </div>
      </dl>

      <hr className={styles.divider} />
      <DataExportButton />

      <hr className={styles.divider} />
      <AccountClosureForm
        action={closeAccountAction}
        accountEmail={accountEmail}
      />
    </div>
  );
}
