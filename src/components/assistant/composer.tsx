"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  FileText,
  Mic,
  Paperclip,
  Pencil,
  Square,
  Upload,
  X,
} from "lucide-react";

import {
  Composer as DesignSystemComposer,
  Icon,
  IconButton,
} from "@/design-system";
import { cx } from "@/design-system/utils";

import {
  persistDocumentAttachment,
  type DocumentUploadOutcome,
} from "@/lib/documents/client-upload";

import {
  AttachmentPreviewDialog,
  type AttachmentPreviewData,
} from "./attachment-preview-dialog";
import styles from "./composer.module.css";

export const COMPOSER_MAX_LENGTH = 4000;
/** Nombre max de pièces jointes affichées en rangée dans le composer. */
export const COMPOSER_MAX_FILES = 6;
export const COMPOSER_PLACEHOLDER = "Que souhaitez-vous confier à Sidian ?";
export const WELCOME_COMPOSER_PLACEHOLDER =
  "Dites-moi ce que vous voulez sécuriser, suivre ou préparer…";
export const DICTATION_ERROR_MESSAGE =
  "La dictée n’a pas pu démarrer. Vérifiez l’accès au micro ou saisissez votre demande.";

export function buildComposerFileLimitMessage(acceptedCount: number): string {
  if (acceptedCount <= 0) {
    return `La limite est de ${COMPOSER_MAX_FILES} fichiers maximum.`;
  }
  return `Seulement ${COMPOSER_MAX_FILES} fichiers ont été importés car la limite est de ${COMPOSER_MAX_FILES} fichiers maximum.`;
}

function ComposerAttachmentChip({
  file,
  disabled,
  onRemove,
  onPreview,
}: {
  file: File;
  disabled?: boolean;
  onRemove?: (file: File) => void;
  onPreview?: (attachment: AttachmentPreviewData) => void;
}) {
  const isImage = file.type.startsWith("image/");
  const previewRef = useRef<{ file: File; url: string } | null>(null);

  const getPreviewUrl = () => {
    if (previewRef.current?.file === file) {
      return previewRef.current.url;
    }
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current.url);
    }
    const url = URL.createObjectURL(file);
    previewRef.current = { file, url };
    return url;
  };

  useEffect(() => {
    const renderedFile = file;
    return () => {
      if (previewRef.current?.file !== renderedFile) return;
      URL.revokeObjectURL(previewRef.current.url);
      previewRef.current = null;
    };
  }, [file]);

  return (
    <div
      className={styles.attachment}
      data-type={isImage ? "image" : "file"}
      data-testid="composer-attachment"
    >
      <button
        type="button"
        className={styles.attachmentPreviewTrigger}
        aria-label={`Afficher l’aperçu de ${file.name}`}
        onClick={() =>
          onPreview?.({
            name: file.name,
            size: file.size,
            type: file.type,
            url: getPreviewUrl(),
            source: file,
          })
        }
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob preview local only
          <img
            ref={(node) => {
              if (node) node.src = getPreviewUrl();
            }}
            alt=""
            className={styles.attachmentThumb}
          />
        ) : (
          <span className={styles.attachmentIcon} aria-hidden>
            <Icon icon={FileText} size="sm" />
          </span>
        )}
        <span className={styles.attachmentCopy}>
          <span className={styles.attachmentName} title={file.name}>
            {file.name}
          </span>
          <span className={styles.attachmentSize}>
            {formatFileSize(file.size)}
          </span>
        </span>
      </button>
      <IconButton
        type="button"
        icon={X}
        size="sm"
        label={`Retirer ${file.name}`}
        title={`Retirer ${file.name}`}
        onClick={() => onRemove?.(file)}
        disabled={disabled}
        className={styles.removeAttachment}
      />
    </div>
  );
}
type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  isStopping?: boolean;
  error?: string | null;
  placeholder?: string;
  maxLength?: number;
  files?: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (file: File) => void;
  /** Appelé quand une sélection dépasse les emplacements restants (max 5). */
  onFileLimitReached?: (acceptedCount: number, attemptedCount: number) => void;
  /**
   * Notifié quand une pièce jointe est réellement enregistrée côté serveur.
   * Permet de rattacher `documentId` au message sans que le composer ait à
   * connaître la persistance des conversations.
   */
  onAttachmentPersisted?: (
    file: File,
    document: { documentId: string; status: string },
  ) => void;
  /** Preview visuelle locale uniquement — n’altère pas le comportement réel. */
  previewDropOverlay?: boolean;
  /** Présentation hero réservée à l’empty state de l’Agent IA. */
  welcomeMode?: boolean;
  /** Mode édition (style ChatGPT) : tag dans la surface du composer. */
  editing?: boolean;
  onCancelEdit?: () => void;
  /** Permet d’ouvrir le sélecteur de fichiers depuis l’extérieur (raccourci Import). */
  openFilePickerRef?: MutableRefObject<(() => void) | null>;
};

type SpeechResultLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

function subscribeToClientMount(): () => void {
  return () => undefined;
}

function getClientMountSnapshot(): boolean {
  return true;
}

function getServerMountSnapshot(): boolean {
  return false;
}

function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} o`;
  return `${Math.max(1, Math.round(size / 1024))} Ko`;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled = false,
  isLoading = false,
  isStopping = false,
  error = null,
  placeholder = COMPOSER_PLACEHOLDER,
  maxLength = COMPOSER_MAX_LENGTH,
  files = [],
  onAddFiles,
  onRemoveFile,
  onFileLimitReached,
  onAttachmentPersisted,
  previewDropOverlay = false,
  welcomeMode = false,
  editing = false,
  onCancelEdit,
  openFilePickerRef,
}: ComposerProps) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const dragDepthRef = useRef(0);
  const onFileLimitReachedRef = useRef(onFileLimitReached);
  const onAttachmentPersistedRef = useRef(onAttachmentPersisted);
  /** État de persistance par fichier — clé = identité de l'objet File. */
  const persistenceRef = useRef(
    new Map<File, "pending" | "stored" | "failed">(),
  );
  const mountedRef = useRef(true);
  const [dragActive, setDragActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentPreviewData | null>(null);
  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientMountSnapshot,
    getServerMountSnapshot,
  );
  const speechSupported = mounted && Boolean(getSpeechRecognition());
  const isBlocked = disabled || isLoading;
  const showStop = isLoading && Boolean(onStop);
  const trimmed = value.trim();
  const atLimit = value.length >= maxLength;
  const nearLimit = value.length >= Math.floor(maxLength * 0.9);
  const canSend = !isBlocked && (trimmed.length > 0 || files.length > 0);
  const canAddFiles = !isBlocked && files.length < COMPOSER_MAX_FILES;
  const remainingFileSlots = Math.max(0, COMPOSER_MAX_FILES - files.length);

  useEffect(() => {
    onFileLimitReachedRef.current = onFileLimitReached;
  }, [onFileLimitReached]);

  useEffect(() => {
    onAttachmentPersistedRef.current = onAttachmentPersisted;
  }, [onAttachmentPersisted]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Persistance réelle des pièces jointes.
   *
   * Sans elle, un fichier n'existait que dans un `URL.createObjectURL` : il
   * disparaissait au rechargement de la page. On téléverse donc dès l'ajout,
   * et l'échec est dit — jamais un fichier abandonné en silence, jamais un
   * fichier présenté comme enregistré alors qu'il ne l'est pas.
   *
   * Aucune requête n'est annulée au démontage : un téléversement déjà lancé a
   * plus de valeur terminé qu'interrompu. Seules les mises à jour d'état sont
   * gardées par `mountedRef`.
   */
  useEffect(() => {
    const tracked = persistenceRef.current;
    for (const file of [...tracked.keys()]) {
      if (!files.includes(file)) tracked.delete(file);
    }
    if (![...tracked.values()].includes("failed")) {
      setUploadError((current) => (current === null ? current : null));
    }

    const pending = files.filter((file) => !tracked.has(file));
    if (pending.length === 0) return;
    for (const file of pending) tracked.set(file, "pending");

    void (async () => {
      for (const file of pending) {
        let outcome: DocumentUploadOutcome;
        try {
          outcome = await persistDocumentAttachment(file);
        } catch {
          outcome = {
            ok: false,
            error: {
              code: "document_upload_failed",
              message: "Ce fichier n’a pas pu être enregistré.",
            },
          };
        }
        // Le fichier a pu être retiré pendant le téléversement : ne rien dire.
        if (!tracked.has(file)) continue;
        if (outcome.ok) {
          tracked.set(file, "stored");
          onAttachmentPersistedRef.current?.(file, {
            documentId: outcome.documentId,
            status: outcome.status,
          });
          continue;
        }
        tracked.set(file, "failed");
        if (mountedRef.current) {
          setUploadError(`${file.name} : ${outcome.error.message}`);
        }
      }
    })();
  }, [files]);

  useEffect(() => {
    if (!openFilePickerRef) return;
    openFilePickerRef.current = () => {
      if (!canAddFiles) return;
      fileInputRef.current?.click();
    };
    return () => {
      openFilePickerRef.current = null;
    };
  }, [openFilePickerRef, canAddFiles]);

  useEffect(() => {
    return () => {
      speechRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    function containsFiles(event: globalThis.DragEvent): boolean {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }

    function handleWindowDragEnter(event: globalThis.DragEvent) {
      if (isBlocked || !containsFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    }

    function handleWindowDragOver(event: globalThis.DragEvent) {
      if (isBlocked || !containsFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }

    function handleWindowDragLeave(event: globalThis.DragEvent) {
      if (!containsFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    }

    function handleWindowDrop(event: globalThis.DragEvent) {
      if (!containsFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (isBlocked) return;
      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      if (droppedFiles.length === 0) return;
      const slots = Math.max(0, COMPOSER_MAX_FILES - files.length);
      if (slots === 0) {
        onFileLimitReachedRef.current?.(0, droppedFiles.length);
        return;
      }
      const accepted = droppedFiles.slice(0, slots);
      onAddFiles?.(accepted);
      if (droppedFiles.length > slots) {
        onFileLimitReachedRef.current?.(accepted.length, droppedFiles.length);
      }
    }

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [files.length, isBlocked, onAddFiles]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    element.style.overflowY =
      element.scrollHeight > element.clientHeight ? "auto" : "hidden";
  }, [value]);

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      onCancelEdit?.();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    // Entrée valide une composition IME (accents, claviers asiatiques) :
    // l’envoyer à ce moment tronquerait la saisie en cours.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    event.preventDefault();
    handleSubmit();
  }

  function handleChange(next: string) {
    if (dictationError) setDictationError(null);
    onChange(next.slice(0, maxLength));
  }

  function addFiles(nextFiles: File[]) {
    if (isBlocked || nextFiles.length === 0) return;
    if (remainingFileSlots === 0) {
      onFileLimitReached?.(0, nextFiles.length);
      return;
    }
    const accepted = nextFiles.slice(0, remainingFileSlots);
    onAddFiles?.(accepted);
    if (nextFiles.length > remainingFileSlots) {
      onFileLimitReached?.(accepted.length, nextFiles.length);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = Array.from(event.clipboardData.files);
    if (pastedFiles.length > 0) addFiles(pastedFiles);
  }

  function toggleDictation() {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    setDictationError(null);
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "fr-FR";
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]?.[0]?.transcript;
      if (!result) return;
      const spacer = value.trim() ? " " : "";
      handleChange(`${value}${spacer}${result}`);
    };
    // Micro refusé, hors ligne, silence : sans message l’utilisateur croit
    // que le bouton ne fait rien.
    recognition.onerror = () => {
      setListening(false);
      setDictationError(DICTATION_ERROR_MESSAGE);
    };
    recognition.onend = () => {
      setListening(false);
      speechRef.current = null;
    };
    speechRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      speechRef.current = null;
      setListening(false);
      setDictationError(DICTATION_ERROR_MESSAGE);
    }
  }

  const dropOverlay =
    mounted && (dragActive || previewDropOverlay) ? (
      typeof document !== "undefined" ? (
        createPortal(
        <div
          data-testid="composer-drop-overlay"
          className={styles.dropOverlay}
          role="status"
          aria-live="polite"
        >
          <div className={styles.dropMessage}>
            <Icon icon={Upload} size="lg" />
            <strong>Déposez vos documents ici</strong>
            <span>Sidian les ajoutera à votre demande</span>
          </div>
        </div>,
          document.querySelector<HTMLElement>(
            '[data-testid="assistant-shell"]',
          ) ?? document.body,
        )
      ) : null
    ) : null;

  return (
    <>
      {dropOverlay}
      <AttachmentPreviewDialog
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
      <form
        data-testid="composer"
        data-loading={isLoading ? "true" : "false"}
        data-editing={editing ? "true" : "false"}
        data-variant={welcomeMode ? "welcome" : "conversation"}
        onSubmit={handleSubmit}
        className={cx(
          styles.form,
          welcomeMode && styles.welcomeForm,
          (dragActive || previewDropOverlay) && styles.dragActive,
        )}
      >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        aria-label="Choisir des fichiers"
        data-testid="composer-file-input"
        className={styles.hiddenInput}
        tabIndex={-1}
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />

      {editing ? (
        <div
          className={styles.editBanner}
          data-testid="composer-edit-banner"
          role="status"
        >
          <span className={styles.editBannerLabel}>
            <Pencil aria-hidden size={13} strokeWidth={1.8} />
            Modification
          </span>
          <IconButton
            icon={X}
            size="sm"
            label="Annuler la modification"
            data-testid="composer-edit-cancel"
            className={styles.editBannerClose}
            onClick={(event) => {
              event.preventDefault();
              onCancelEdit?.();
            }}
          />
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className={styles.attachments} aria-label="Pièces jointes">
          {files.map((file, index) => (
            <ComposerAttachmentChip
              key={`${fileKey(file)}-${index}`}
              file={file}
              disabled={isBlocked}
              onRemove={onRemoveFile}
              onPreview={setPreviewAttachment}
            />
          ))}
        </div>
      ) : null}

      <DesignSystemComposer
        ref={textareaRef}
        id={id}
        label="Instruction pour Sidian"
        hideLabel
        className={styles.field}
        controlClassName={cx(
          styles.control,
          welcomeMode && styles.welcomeControl,
        )}
        data-testid="composer-input"
        rows={1}
        value={value}
        disabled={isBlocked}
        placeholder={placeholder}
        maxLength={maxLength}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
        spellCheck
        error={error ?? uploadError ?? dictationError ?? undefined}
        errorTestId="composer-error"
        onInput={(event) => handleChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />

      <div className={styles.toolbar}>
        <div className={styles.tools} role="group" aria-label="Ajouter du contenu">
          <IconButton
            icon={Paperclip}
            size="md"
            label="Ajouter des fichiers"
            title={
              canAddFiles
                ? "Ajouter des fichiers"
                : `Maximum ${COMPOSER_MAX_FILES} fichiers`
            }
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAddFiles}
            className={styles.composerAction}
          />
        </div>

        <div className={styles.actions}>
          <IconButton
            icon={listening ? Square : Mic}
            size="md"
            label={listening ? "Arrêter la dictée" : "Dicter une demande"}
            aria-description={
              speechSupported
                ? undefined
                : "La dictée n’est pas disponible dans ce navigateur."
            }
            title={
              speechSupported
                ? listening
                  ? "Arrêter la dictée"
                  : "Dicter une demande"
                : "La dictée n’est pas disponible dans ce navigateur."
            }
            onClick={toggleDictation}
            disabled={isBlocked || !speechSupported}
            aria-pressed={listening}
            className={styles.composerAction}
          />
          <IconButton
            type={showStop ? "button" : "submit"}
            icon={showStop ? Square : ArrowUp}
            size="md"
            label={
              showStop
                ? "Arrêter la génération"
                : isLoading
                  ? "Envoi en cours"
                  : "Envoyer"
            }
            title={
              showStop
                ? "Arrêter la génération"
                : isLoading
                  ? "Envoi en cours"
                  : "Envoyer"
            }
            data-testid={showStop ? "composer-stop" : "composer-send"}
            data-ready={showStop || canSend ? "true" : "false"}
            disabled={showStop ? isStopping : !canSend}
            loading={isLoading && !showStop}
            loadingLabel="Envoi en cours"
            variant="primary"
            className={styles.send}
            onClick={showStop ? onStop : undefined}
          />
        </div>
      </div>

      {nearLimit ? (
        <div className={styles.meta}>
          <span
            data-testid="composer-char-count"
            className={cx(styles.counter, atLimit && styles.counterLimit)}
          >
            {value.length}/{maxLength}
          </span>
        </div>
      ) : null}
      </form>
    </>
  );
}
