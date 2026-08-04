import {
  ArrowRight,
  CreditCard,
  RotateCcw,
  SearchX,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import {
  Badge,
  Button,
  CardLoading,
  ClientCard,
  Combobox,
  Composer,
  ComposerLoading,
  DateInput,
  EmptyState,
  ErrorCard,
  Icon,
  IconButton,
  InfoCard,
  Input,
  PageLoading,
  PaymentCard,
  Progress,
  ProtectionCard,
  SearchInput,
  Select,
  Spinner,
  SuccessCard,
  SummaryCard,
  Textarea,
  TimelineCard,
  Typography,
} from "./components";
import styles from "./catalogue.module.css";

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.sectionHeader}>
      <Typography variant="h2">{title}</Typography>
      <Typography tone="secondary">{description}</Typography>
    </div>
  );
}

/**
 * Catalogue interne non routé.
 *
 * Il sert de référence exécutable aux équipes et aux tests. Une route interne
 * pourra l'importer en Phase 2 sans coupler le design system à l'App Router.
 */
export function DesignSystemCatalogue() {
  return (
    <main className={styles.catalogue}>
      <header className={styles.header}>
        <Badge tone="info">Sidian Design System · Phase 1</Badge>
        <Typography variant="display">Fondations produit</Typography>
        <Typography tone="secondary">
          Tokens et composants officiels pour le workspace financier Sidian.
        </Typography>
      </header>

      <section className={styles.section}>
        <SectionHeader
          title="Typographie"
          description="Les rôles nomment la hiérarchie, pas un effet visuel isolé."
        />
        <div className={styles.typeSpecimen}>
          <Typography variant="h1">H1 · Vue d’ensemble</Typography>
          <Typography variant="h2">H2 · Paiements à suivre</Typography>
          <Typography variant="h3">H3 · Protection du dossier</Typography>
          <Typography variant="title">Title · Client et échéance</Typography>
          <Typography>Body · Une information financière lisible.</Typography>
          <Typography variant="bodySmall" tone="secondary">
            Body Small · Détail utile sans concurrencer l’action.
          </Typography>
          <Typography variant="caption" tone="muted">
            Caption · Mis à jour aujourd’hui
          </Typography>
          <Typography variant="label">Label · Montant attendu</Typography>
          <Typography variant="code">Code · protection.active</Typography>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          title="Boutons"
          description="Toutes les variantes exposent hover, pressed, focus, disabled et loading."
        />
        <div className={styles.row}>
          <Button icon={Sparkles}>Demander à Sidian</Button>
          <Button variant="secondary">Action secondaire</Button>
          <Button variant="ghost">Action discrète</Button>
          <Button variant="destructive">Supprimer</Button>
          <Button variant="link" icon={ArrowRight} iconPosition="end">
            Voir le dossier
          </Button>
          <Button loading loadingLabel="Enregistrement…">
            Enregistrer
          </Button>
          <Button disabled>Indisponible</Button>
          <IconButton icon={RotateCcw} label="Réessayer" />
          <IconButton
            icon={Sparkles}
            label="Ouvrir Sidian"
            variant="floating"
          />
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          title="Champs"
          description="Labels visibles, aides reliées, erreurs compréhensibles et focus unifié."
        />
        <div className={styles.formGrid}>
          <Input
            label="Nom du client"
            placeholder="Entreprise ou particulier"
            hint="Utilise le nom affiché sur la facture."
          />
          <Input
            label="Montant attendu"
            inputMode="decimal"
            defaultValue="2 400 €"
            error="Vérifie le montant saisi."
          />
          <SearchInput
            label="Rechercher"
            placeholder="Client, paiement ou protection"
          />
          <Select label="Statut" defaultValue="pending">
            <option value="pending">À suivre</option>
            <option value="paid">Payé</option>
          </Select>
          <Combobox
            label="Client"
            options={[
              { value: "Atelier Nord", label: "Atelier Nord" },
              { value: "Studio Rivage", label: "Studio Rivage" },
            ]}
          />
          <DateInput label="Prochaine échéance" />
          <Textarea
            label="Note interne"
            placeholder="Ajoute un contexte utile au dossier."
          />
          <Input label="Champ indisponible" disabled value="Synchronisation" />
        </div>
        <Composer
          placeholder="Demande quelque chose à Sidian…"
          hint="Sidian peut préparer une action, jamais l’exécuter sans les contrôles requis."
        />
      </section>

      <section className={styles.section}>
        <SectionHeader
          title="Badges"
          description="Les tons sémantiques restent réservés à un statut réel."
        />
        <div className={styles.row}>
          <Badge>Neutre</Badge>
          <Badge tone="info">Information</Badge>
          <Badge tone="success">Réglé</Badge>
          <Badge tone="warning">À vérifier</Badge>
          <Badge tone="danger">Action requise</Badge>
          <Badge tone="outline">Brouillon</Badge>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          title="Cartes métier"
          description="Une primitive partagée, des variantes sémantiques sans logique métier cachée."
        />
        <div className={styles.grid}>
          <InfoCard title="À savoir" description="Information contextuelle." />
          <ProtectionCard
            title="Protection prête"
            description="Le dossier peut être relu avant activation."
            accessory={<Icon icon={ShieldCheck} aria-hidden />}
          />
          <PaymentCard
            title="Paiement attendu"
            description="2 400 € · échéance le 30 juillet"
            accessory={<Icon icon={CreditCard} aria-hidden />}
          />
          <ClientCard
            title="Atelier Nord"
            description="Deux paiements en cours"
            accessory={<Icon icon={Users} aria-hidden />}
          />
          <ErrorCard
            title="Je n’ai pas pu enregistrer ta demande."
            footer={<Button variant="secondary">Réessayer</Button>}
          />
          <SuccessCard
            title="Demande enregistrée"
            description="La prochaine étape est prête."
          />
          <TimelineCard
            title="Activité"
            items={[
              { id: "created", label: "Paiement créé" },
              { id: "sent", label: "Lien envoyé", detail: "aujourd’hui" },
            ]}
          />
          <SummaryCard
            title="Briefing du jour"
            description="Trois actions peuvent sécuriser 4 800 €."
            elevation="raised"
          />
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          title="États vides et chargements"
          description="Le statut reste annoncé aux technologies d’assistance."
        />
        <div className={styles.grid}>
          <EmptyState
            illustration={<Icon icon={SearchX} size="lg" />}
            title="Aucun paiement à afficher"
            description="Les paiements préparés apparaîtront ici."
            action={<Button>Préparer un paiement</Button>}
          />
          <div className={styles.stack}>
            <Spinner />
            <Progress label="Préparation du dossier" value={64} max={100} />
            <CardLoading />
            <ComposerLoading />
          </div>
        </div>
        <PageLoading />
      </section>
    </main>
  );
}
