export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_request: {
        Row: {
          approved_by: string | null
          creance_id: string | null
          created_at: string
          decided_at: string | null
          expires_at: string | null
          id: string
          payload: Json
          prestataire_id: string
          requested_by_actor_type: Database["public"]["Enums"]["actor_type"]
          requested_by_provider: string | null
          status: Database["public"]["Enums"]["approval_request_status"]
          type: Database["public"]["Enums"]["approval_request_type"]
        }
        Insert: {
          approved_by?: string | null
          creance_id?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          prestataire_id: string
          requested_by_actor_type: Database["public"]["Enums"]["actor_type"]
          requested_by_provider?: string | null
          status?: Database["public"]["Enums"]["approval_request_status"]
          type: Database["public"]["Enums"]["approval_request_type"]
        }
        Update: {
          approved_by?: string | null
          creance_id?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          prestataire_id?: string
          requested_by_actor_type?: Database["public"]["Enums"]["actor_type"]
          requested_by_provider?: string | null
          status?: Database["public"]["Enums"]["approval_request_status"]
          type?: Database["public"]["Enums"]["approval_request_type"]
        }
        Relationships: [
          {
            foreignKeyName: "approval_request_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_request_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_model: string | null
          actor_provider: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          prestataire_id: string
        }
        Insert: {
          action: string
          actor_model?: string | null
          actor_provider?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          prestataire_id: string
        }
        Update: {
          action?: string
          actor_model?: string | null
          actor_provider?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          prestataire_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      client_payeur: {
        Row: {
          created_at: string
          email: string
          historique_paiements_reguliers: number
          id: string
          nom: string
          prestataire_id: string
        }
        Insert: {
          created_at?: string
          email: string
          historique_paiements_reguliers?: number
          id?: string
          nom: string
          prestataire_id: string
        }
        Update: {
          created_at?: string
          email?: string
          historique_paiements_reguliers?: number
          id?: string
          nom?: string
          prestataire_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payeur_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation: {
        Row: {
          client_payeur_id: string | null
          creance_id: string | null
          created_at: string
          id: string
          prestataire_id: string
          updated_at: string
        }
        Insert: {
          client_payeur_id?: string | null
          creance_id?: string | null
          created_at?: string
          id?: string
          prestataire_id: string
          updated_at?: string
        }
        Update: {
          client_payeur_id?: string | null
          creance_id?: string | null
          created_at?: string
          id?: string
          prestataire_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      creance: {
        Row: {
          client_payeur_id: string
          created_at: string
          date_echeance: string
          devise: string
          etat: Database["public"]["Enums"]["creance_etat"]
          id: string
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          reference_externe: string | null
          updated_at: string
        }
        Insert: {
          client_payeur_id: string
          created_at?: string
          date_echeance: string
          devise?: string
          etat?: Database["public"]["Enums"]["creance_etat"]
          id?: string
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          reference_externe?: string | null
          updated_at?: string
        }
        Update: {
          client_payeur_id?: string
          created_at?: string
          date_echeance?: string
          devise?: string
          etat?: Database["public"]["Enums"]["creance_etat"]
          id?: string
          montant?: number
          origine?: Database["public"]["Enums"]["creance_origine"]
          prestataire_id?: string
          reference_externe?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creance_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creance_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_suivi: {
        Row: {
          clos_at: string | null
          creance_id: string
          created_at: string
          escalation_reason: string | null
          etat: Database["public"]["Enums"]["dossier_suivi_etat"]
          id: string
          last_agent_action_at: string | null
          last_client_activity_at: string | null
          next_action_at: string | null
          updated_at: string
        }
        Insert: {
          clos_at?: string | null
          creance_id: string
          created_at?: string
          escalation_reason?: string | null
          etat?: Database["public"]["Enums"]["dossier_suivi_etat"]
          id?: string
          last_agent_action_at?: string | null
          last_client_activity_at?: string | null
          next_action_at?: string | null
          updated_at?: string
        }
        Update: {
          clos_at?: string | null
          creance_id?: string
          created_at?: string
          escalation_reason?: string | null
          etat?: Database["public"]["Enums"]["dossier_suivi_etat"]
          id?: string
          last_agent_action_at?: string | null
          last_client_activity_at?: string | null
          next_action_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_suivi_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: true
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
        ]
      }
      message: {
        Row: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          canal: Database["public"]["Enums"]["message_canal"]
          contenu: string
          conversation_id: string
          created_at: string
          emetteur: Database["public"]["Enums"]["message_emetteur"]
          id: string
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          canal: Database["public"]["Enums"]["message_canal"]
          contenu: string
          conversation_id: string
          created_at?: string
          emetteur: Database["public"]["Enums"]["message_emetteur"]
          id?: string
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["actor_type"]
          canal?: Database["public"]["Enums"]["message_canal"]
          contenu?: string
          conversation_id?: string
          created_at?: string
          emetteur?: Database["public"]["Enums"]["message_emetteur"]
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
        ]
      }
      paiement: {
        Row: {
          creance_id: string
          created_at: string
          id: string
          montant: number
          source: Database["public"]["Enums"]["paiement_source"]
          tentative_paiement_id: string | null
        }
        Insert: {
          creance_id: string
          created_at?: string
          id?: string
          montant: number
          source: Database["public"]["Enums"]["paiement_source"]
          tentative_paiement_id?: string | null
        }
        Update: {
          creance_id?: string
          created_at?: string
          id?: string
          montant?: number
          source?: Database["public"]["Enums"]["paiement_source"]
          tentative_paiement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paiement_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paiement_tentative_paiement_id_fkey"
            columns: ["tentative_paiement_id"]
            isOneToOne: false
            referencedRelation: "tentative_paiement"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_authorization: {
        Row: {
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          prestataire_id: string
          revoked_at: string | null
          stripe_mandate_id: string | null
          stripe_payment_method_id: string
          type: Database["public"]["Enums"]["payment_authorization_type"]
        }
        Insert: {
          authorization_channel?: string | null
          authorization_text_version?: string | null
          authorized_at?: string | null
          client_payeur_id: string
          created_at?: string
          etat?: Database["public"]["Enums"]["payment_authorization_etat"]
          id?: string
          is_default?: boolean
          prestataire_id: string
          revoked_at?: string | null
          stripe_mandate_id?: string | null
          stripe_payment_method_id: string
          type: Database["public"]["Enums"]["payment_authorization_type"]
        }
        Update: {
          authorization_channel?: string | null
          authorization_text_version?: string | null
          authorized_at?: string | null
          client_payeur_id?: string
          created_at?: string
          etat?: Database["public"]["Enums"]["payment_authorization_etat"]
          id?: string
          is_default?: boolean
          prestataire_id?: string
          revoked_at?: string | null
          stripe_mandate_id?: string | null
          stripe_payment_method_id?: string
          type?: Database["public"]["Enums"]["payment_authorization_type"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_authorization_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_authorization_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      prestataire: {
        Row: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          subscription_started_at: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          early_access_price_locked_until?: string | null
          email: string
          id?: string
          nom: string
          platform_fee_basis_points?: number
          pricing_version?: string
          profil_agent_defaut?: Database["public"]["Enums"]["profil_agent_defaut"]
          subscription_started_at?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          early_access_price_locked_until?: string | null
          email?: string
          id?: string
          nom?: string
          platform_fee_basis_points?: number
          pricing_version?: string
          profil_agent_defaut?: Database["public"]["Enums"]["profil_agent_defaut"]
          subscription_started_at?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          user_id?: string
        }
        Relationships: []
      }
      processed_webhook_event: {
        Row: {
          id: string
          processed_at: string
          type: string
        }
        Insert: {
          id: string
          processed_at?: string
          type: string
        }
        Update: {
          id?: string
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      regle: {
        Row: {
          actif: boolean
          client_payeur_id: string | null
          created_at: string
          id: string
          libelle_instruction_origine: string | null
          origine: Database["public"]["Enums"]["regle_origine"]
          parametre: Database["public"]["Enums"]["regle_parametre"]
          prestataire_id: string
          valeur: Json
        }
        Insert: {
          actif?: boolean
          client_payeur_id?: string | null
          created_at?: string
          id?: string
          libelle_instruction_origine?: string | null
          origine?: Database["public"]["Enums"]["regle_origine"]
          parametre: Database["public"]["Enums"]["regle_parametre"]
          prestataire_id: string
          valeur: Json
        }
        Update: {
          actif?: boolean
          client_payeur_id?: string | null
          created_at?: string
          id?: string
          libelle_instruction_origine?: string | null
          origine?: Database["public"]["Enums"]["regle_origine"]
          parametre?: Database["public"]["Enums"]["regle_parametre"]
          prestataire_id?: string
          valeur?: Json
        }
        Relationships: [
          {
            foreignKeyName: "regle_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regle_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      tentative_paiement: {
        Row: {
          creance_id: string
          created_at: string
          echec_code: string | null
          echec_message: string | null
          etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          id: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"]
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_payment_intent_id: string | null
        }
        Insert: {
          creance_id: string
          created_at?: string
          echec_code?: string | null
          echec_message?: string | null
          etat?: Database["public"]["Enums"]["tentative_paiement_etat"]
          id?: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"]
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_payment_intent_id?: string | null
        }
        Update: {
          creance_id?: string
          created_at?: string
          echec_code?: string | null
          echec_message?: string | null
          etat?: Database["public"]["Enums"]["tentative_paiement_etat"]
          id?: string
          montant?: number
          moyen?: Database["public"]["Enums"]["tentative_paiement_moyen"]
          source?: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tentative_paiement_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_prestataire_id: { Args: never; Returns: string }
      ensure_prestataire_for_current_user: {
        Args: { p_nom: string }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          subscription_started_at: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sidian_assert_rls_enabled: {
        Args: never
        Returns: {
          rls_enabled: boolean
          table_name: string
        }[]
      }
      sidian_prestataire_authenticated_privileges: {
        Args: never
        Returns: Json
      }
      update_current_prestataire_name: {
        Args: { p_nom: string }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          subscription_started_at: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      actor_type: "human" | "sidian_agent" | "system" | "external_integration"
      approval_request_status: "pending" | "approved" | "rejected" | "expired"
      approval_request_type:
        | "formal_action"
        | "rule_change"
        | "depassement_seuil"
        | "autre"
      creance_etat:
        | "BROUILLON"
        | "OUVERTE"
        | "PARTIELLEMENT_REGLEE"
        | "REGLEE"
        | "EN_LITIGE"
        | "ANNULEE"
        | "IRRECOUVRABLE"
      creance_origine:
        | "facture_externe"
        | "acompte"
        | "echeancier"
        | "abonnement"
        | "import_manuel"
      dossier_suivi_etat:
        | "PREVENTION"
        | "ECHEANCE"
        | "SUIVI_AMIABLE"
        | "PAUSE_LITIGE"
        | "ATTENTE_CLIENT"
        | "ATTENTE_PRESTATAIRE"
        | "ESCALADE_HUMAINE"
        | "CLOS"
      message_canal: "email" | "interface"
      message_emetteur: "agent" | "prestataire" | "client"
      paiement_source: "lien_agent" | "prelevement_auto" | "detecte_hors_sidian"
      payment_authorization_etat:
        | "NON_PROPOSEE"
        | "PROPOSEE"
        | "EN_CONFIGURATION"
        | "ACTIVE"
        | "REFUSEE"
        | "SUSPENDUE"
        | "REVOQUEE"
        | "EXPIREE"
      payment_authorization_type: "card_off_session" | "sepa_core_mandate"
      profil_agent_defaut: "controle" | "delegation"
      regle_origine: "defaut" | "instruction_naturelle"
      regle_parametre:
        | "delai_grace"
        | "montant_max_etalement"
        | "nb_demandes_avant_escalade"
        | "seuil_validation_humaine"
        | "vitesse_escalade_ton"
        | "plafond_fermete"
        | "canaux_autorises"
        | "frequence_max_sollicitation"
        | "horaires_autorises"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      tentative_paiement_etat:
        | "CREEE"
        | "NECESSITE_ACTION_CLIENT"
        | "EN_TRAITEMENT"
        | "REUSSIE"
        | "ECHOUEE"
        | "ANNULEE"
      tentative_paiement_moyen: "carte" | "sepa_core"
      tentative_paiement_source: "lien_agent" | "prelevement_auto"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ["human", "sidian_agent", "system", "external_integration"],
      approval_request_status: ["pending", "approved", "rejected", "expired"],
      approval_request_type: [
        "formal_action",
        "rule_change",
        "depassement_seuil",
        "autre",
      ],
      creance_etat: [
        "BROUILLON",
        "OUVERTE",
        "PARTIELLEMENT_REGLEE",
        "REGLEE",
        "EN_LITIGE",
        "ANNULEE",
        "IRRECOUVRABLE",
      ],
      creance_origine: [
        "facture_externe",
        "acompte",
        "echeancier",
        "abonnement",
        "import_manuel",
      ],
      dossier_suivi_etat: [
        "PREVENTION",
        "ECHEANCE",
        "SUIVI_AMIABLE",
        "PAUSE_LITIGE",
        "ATTENTE_CLIENT",
        "ATTENTE_PRESTATAIRE",
        "ESCALADE_HUMAINE",
        "CLOS",
      ],
      message_canal: ["email", "interface"],
      message_emetteur: ["agent", "prestataire", "client"],
      paiement_source: [
        "lien_agent",
        "prelevement_auto",
        "detecte_hors_sidian",
      ],
      payment_authorization_etat: [
        "NON_PROPOSEE",
        "PROPOSEE",
        "EN_CONFIGURATION",
        "ACTIVE",
        "REFUSEE",
        "SUSPENDUE",
        "REVOQUEE",
        "EXPIREE",
      ],
      payment_authorization_type: ["card_off_session", "sepa_core_mandate"],
      profil_agent_defaut: ["controle", "delegation"],
      regle_origine: ["defaut", "instruction_naturelle"],
      regle_parametre: [
        "delai_grace",
        "montant_max_etalement",
        "nb_demandes_avant_escalade",
        "seuil_validation_humaine",
        "vitesse_escalade_ton",
        "plafond_fermete",
        "canaux_autorises",
        "frequence_max_sollicitation",
        "horaires_autorises",
      ],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      tentative_paiement_etat: [
        "CREEE",
        "NECESSITE_ACTION_CLIENT",
        "EN_TRAITEMENT",
        "REUSSIE",
        "ECHOUEE",
        "ANNULEE",
      ],
      tentative_paiement_moyen: ["carte", "sepa_core"],
      tentative_paiement_source: ["lien_agent", "prelevement_auto"],
    },
  },
} as const

