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
          archived_at: string | null
          created_at: string
          creation_key: string
          email: string
          historique_paiements_reguliers: number
          id: string
          nom: string
          prestataire_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          creation_key?: string
          email: string
          historique_paiements_reguliers?: number
          id?: string
          nom: string
          prestataire_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          creation_key?: string
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
          archived_at: string | null
          client_payeur_id: string
          created_at: string
          creation_key: string
          date_echeance: string
          devise: string
          etat: Database["public"]["Enums"]["creance_etat"]
          id: string
          libelle: string | null
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          ready_for_collection_at: string | null
          reference_externe: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_payeur_id: string
          created_at?: string
          creation_key?: string
          date_echeance: string
          devise?: string
          etat?: Database["public"]["Enums"]["creance_etat"]
          id?: string
          libelle?: string | null
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          ready_for_collection_at?: string | null
          reference_externe?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_payeur_id?: string
          created_at?: string
          creation_key?: string
          date_echeance?: string
          devise?: string
          etat?: Database["public"]["Enums"]["creance_etat"]
          id?: string
          libelle?: string | null
          montant?: number
          origine?: Database["public"]["Enums"]["creance_origine"]
          prestataire_id?: string
          ready_for_collection_at?: string | null
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
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_intent_id: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
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
          stripe_payment_method_id?: string | null
          stripe_setup_checkout_session_id?: string | null
          stripe_setup_intent_id?: string | null
          type?:
            | Database["public"]["Enums"]["payment_authorization_type"]
            | null
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
          stripe_payment_method_id?: string | null
          stripe_setup_checkout_session_id?: string | null
          stripe_setup_intent_id?: string | null
          type?:
            | Database["public"]["Enums"]["payment_authorization_type"]
            | null
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
      payment_link: {
        Row: {
          creance_id: string
          created_at: string
          id: string
          revoked_at: string | null
          status: Database["public"]["Enums"]["payment_link_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          creance_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["payment_link_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          creance_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["payment_link_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
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
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
          onboarding_profile_completed_at?: string | null
          platform_fee_basis_points?: number
          pricing_version?: string
          profil_agent_defaut?: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_connect_attempts?: number
          stripe_connect_idempotency_key?: string | null
          stripe_connect_last_error_code?: string | null
          stripe_connect_lease_expires_at?: string | null
          stripe_connect_operation_key?: string | null
          stripe_connect_provisioning_status?: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at?: string | null
          stripe_details_submitted?: boolean
          stripe_disabled_reason?: string | null
          stripe_onboarding_status?: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled?: boolean
          stripe_requirements_currently_due?: Json
          stripe_requirements_past_due?: Json
          stripe_requirements_pending_verification?: Json
          stripe_sepa_debit_payments_status?: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at?: string | null
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
          onboarding_profile_completed_at?: string | null
          platform_fee_basis_points?: number
          pricing_version?: string
          profil_agent_defaut?: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_connect_attempts?: number
          stripe_connect_idempotency_key?: string | null
          stripe_connect_last_error_code?: string | null
          stripe_connect_lease_expires_at?: string | null
          stripe_connect_operation_key?: string | null
          stripe_connect_provisioning_status?: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at?: string | null
          stripe_details_submitted?: boolean
          stripe_disabled_reason?: string | null
          stripe_onboarding_status?: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled?: boolean
          stripe_requirements_currently_due?: Json
          stripe_requirements_past_due?: Json
          stripe_requirements_pending_verification?: Json
          stripe_sepa_debit_payments_status?: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          user_id?: string
        }
        Relationships: []
      }
      processed_webhook_event: {
        Row: {
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string | null
          processed_at: string | null
          processing_attempts: number
          processing_status: Database["public"]["Enums"]["webhook_processing_status"]
          received_at: string
          stripe_connected_account_id: string | null
          type: string
        }
        Insert: {
          id: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          received_at?: string
          stripe_connected_account_id?: string | null
          type: string
        }
        Update: {
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string | null
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          received_at?: string
          stripe_connected_account_id?: string | null
          type?: string
        }
        Relationships: []
      }
      public_rate_limit_event: {
        Row: {
          category: Database["public"]["Enums"]["public_rate_limit_category"]
          expires_at: string
          id: string
          occurred_at: string
          subject_hash: string
        }
        Insert: {
          category: Database["public"]["Enums"]["public_rate_limit_category"]
          expires_at: string
          id?: string
          occurred_at?: string
          subject_hash: string
        }
        Update: {
          category?: Database["public"]["Enums"]["public_rate_limit_category"]
          expires_at?: string
          id?: string
          occurred_at?: string
          subject_hash?: string
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
      stripe_connect_audit_outbox: {
        Row: {
          action: string
          created_at: string
          delivered_at: string | null
          id: string
          operation_key: string
          prestataire_id: string
          status: Database["public"]["Enums"]["stripe_connect_audit_outbox_status"]
          stripe_account_id: string
        }
        Insert: {
          action: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          operation_key: string
          prestataire_id: string
          status?: Database["public"]["Enums"]["stripe_connect_audit_outbox_status"]
          stripe_account_id: string
        }
        Update: {
          action?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          operation_key?: string
          prestataire_id?: string
          status?: Database["public"]["Enums"]["stripe_connect_audit_outbox_status"]
          stripe_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_connect_audit_outbox_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customer_binding: {
        Row: {
          client_payeur_id: string
          created_at: string
          id: string
          prestataire_id: string
          status: Database["public"]["Enums"]["stripe_customer_binding_status"]
          stripe_account_id: string
          stripe_customer_id: string
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          client_payeur_id: string
          created_at?: string
          id?: string
          prestataire_id: string
          status?: Database["public"]["Enums"]["stripe_customer_binding_status"]
          stripe_account_id: string
          stripe_customer_id: string
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          client_payeur_id?: string
          created_at?: string
          id?: string
          prestataire_id?: string
          status?: Database["public"]["Enums"]["stripe_customer_binding_status"]
          stripe_account_id?: string
          stripe_customer_id?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customer_binding_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_customer_binding_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_effect: {
        Row: {
          applied_at: string
          effect_type: string
          stripe_event_id: string
          stripe_object_id: string
        }
        Insert: {
          applied_at?: string
          effect_type: string
          stripe_event_id: string
          stripe_object_id: string
        }
        Update: {
          applied_at?: string
          effect_type?: string
          stripe_event_id?: string
          stripe_object_id?: string
        }
        Relationships: []
      }
      tentative_paiement: {
        Row: {
          application_fee_amount: number | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_key: string | null
          checkout_provisioning_attempts: number
          checkout_provisioning_error_code: string | null
          checkout_provisioning_status: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id: string
          created_at: string
          echec_code: string | null
          echec_message: string | null
          etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          id: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id: string | null
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id: string | null
          stripe_checkout_idempotency_key: string | null
          stripe_checkout_session_expires_at: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          application_fee_amount?: number | null
          checkout_lease_expires_at?: string | null
          checkout_lease_token?: string | null
          checkout_operation_key?: string | null
          checkout_provisioning_attempts?: number
          checkout_provisioning_error_code?: string | null
          checkout_provisioning_status?: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id: string
          created_at?: string
          echec_code?: string | null
          echec_message?: string | null
          etat?: Database["public"]["Enums"]["tentative_paiement_etat"]
          id?: string
          montant: number
          moyen?: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id?: string | null
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id?: string | null
          stripe_checkout_idempotency_key?: string | null
          stripe_checkout_session_expires_at?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          application_fee_amount?: number | null
          checkout_lease_expires_at?: string | null
          checkout_lease_token?: string | null
          checkout_operation_key?: string | null
          checkout_provisioning_attempts?: number
          checkout_provisioning_error_code?: string | null
          checkout_provisioning_status?: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id?: string
          created_at?: string
          echec_code?: string | null
          echec_message?: string | null
          etat?: Database["public"]["Enums"]["tentative_paiement_etat"]
          id?: string
          montant?: number
          moyen?: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id?: string | null
          source?: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id?: string | null
          stripe_checkout_idempotency_key?: string | null
          stripe_checkout_session_expires_at?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
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
          {
            foreignKeyName: "tentative_paiement_payment_link_id_fkey"
            columns: ["payment_link_id"]
            isOneToOne: false
            referencedRelation: "payment_link"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_account_updated_projection: {
        Args: {
          p_charges_enabled: boolean
          p_currently_due: Json
          p_details_submitted: boolean
          p_disabled_reason: string
          p_lease_token: string
          p_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          p_past_due: Json
          p_payouts_enabled: boolean
          p_pending_verification: Json
          p_prestataire_id: string
          p_processing_attempt: number
          p_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          p_stripe_account_id: string
          p_stripe_event_id: string
          p_stripe_object_id: string
        }
        Returns: Json
      }
      apply_checkout_session_completed_payment: {
        Args: {
          p_checkout_session_id: string
          p_connected_account_id: string
          p_customer_id: string
          p_lease_token: string
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
        }
        Returns: Json
      }
      apply_checkout_session_expired_payment: {
        Args: {
          p_checkout_session_id: string
          p_connected_account_id: string
          p_lease_token: string
          p_processing_attempt: number
          p_stripe_event_id: string
        }
        Returns: Json
      }
      apply_eur_payment_intent_succeeded: {
        Args: {
          p_amount_received: number
          p_connected_account_id: string
          p_currency: string
          p_lease_token: string
          p_moyen: Database["public"]["Enums"]["tentative_paiement_moyen"]
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      apply_payment_intent_payment_failed: {
        Args: {
          p_connected_account_id: string
          p_echec_code: string
          p_echec_message: string
          p_lease_token: string
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      apply_payment_intent_processing: {
        Args: {
          p_connected_account_id: string
          p_lease_token: string
          p_moyen: Database["public"]["Enums"]["tentative_paiement_moyen"]
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      apply_payment_intent_succeeded: {
        Args: {
          p_amount_received: number
          p_connected_account_id: string
          p_lease_token: string
          p_moyen: Database["public"]["Enums"]["tentative_paiement_moyen"]
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      archive_current_client_payeur: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          creation_key: string
          email: string
          historique_paiements_reguliers: number
          id: string
          nom: string
          prestataire_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_payeur"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_current_creance: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          client_payeur_id: string
          created_at: string
          creation_key: string
          date_echeance: string
          devise: string
          etat: Database["public"]["Enums"]["creance_etat"]
          id: string
          libelle: string | null
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          ready_for_collection_at: string | null
          reference_externe: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "creance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_stripe_webhook_lease: {
        Args: {
          p_connected_account_id: string
          p_event_id: string
          p_expected_type: string
          p_lease_token: string
          p_processing_attempt: number
        }
        Returns: undefined
      }
      attest_sidian_environment: { Args: never; Returns: Json }
      cancel_current_payment_receivable: {
        Args: { p_creance_id: string }
        Returns: Json
      }
      canonicalize_email: { Args: { p_email: string }; Returns: string }
      claim_checkout_provisioning: {
        Args: {
          p_creance_id: string
          p_idempotency_key: string
          p_lease_seconds?: number
          p_operation_key: string
          p_payment_link_id: string
          p_stripe_account_id: string
        }
        Returns: Json
      }
      claim_current_prestataire_connect_provisioning: {
        Args: { p_lease_seconds?: number }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      claim_stripe_webhook_event: {
        Args: {
          p_event_id: string
          p_lease_seconds?: number
          p_max_attempts?: number
          p_stripe_connected_account_id?: string
          p_type: string
        }
        Returns: Json
      }
      complete_checkout_provisioning: {
        Args: {
          p_application_fee_amount: number
          p_lease_token: string
          p_session_expires_at: string
          p_stripe_account_id: string
          p_stripe_checkout_session_id: string
          p_stripe_customer_id: string
          p_stripe_payment_intent_id: string
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_key: string | null
          checkout_provisioning_attempts: number
          checkout_provisioning_error_code: string | null
          checkout_provisioning_status: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id: string
          created_at: string
          echec_code: string | null
          echec_message: string | null
          etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          id: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id: string | null
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id: string | null
          stripe_checkout_idempotency_key: string | null
          stripe_checkout_session_expires_at: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tentative_paiement"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_prestataire_connect_provisioning: {
        Args: {
          p_audit_action: string
          p_operation_key: string
          p_prestataire_id: string
          p_stripe_account_id: string
        }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      configure_current_prestataire_profile: {
        Args: {
          p_nom: string
          p_profil_agent: Database["public"]["Enums"]["profil_agent_defaut"]
        }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      consume_public_rate_limit: {
        Args: {
          p_category: Database["public"]["Enums"]["public_rate_limit_category"]
          p_subject_hash: string
        }
        Returns: Json
      }
      create_current_client_payeur: {
        Args: { p_creation_key: string; p_email: string; p_nom: string }
        Returns: {
          archived_at: string | null
          created_at: string
          creation_key: string
          email: string
          historique_paiements_reguliers: number
          id: string
          nom: string
          prestataire_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_payeur"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_current_creance: {
        Args: {
          p_client_payeur_id: string
          p_creation_key: string
          p_date_echeance: string
          p_devise?: string
          p_libelle?: string
          p_montant: number
          p_reference_externe?: string
        }
        Returns: {
          archived_at: string | null
          client_payeur_id: string
          created_at: string
          creation_key: string
          date_echeance: string
          devise: string
          etat: Database["public"]["Enums"]["creance_etat"]
          id: string
          libelle: string | null
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          ready_for_collection_at: string | null
          reference_externe: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "creance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_prestataire_id: { Args: never; Returns: string }
      decide_current_approval_request: {
        Args: {
          p_approval_request_id: string
          p_decision: Database["public"]["Enums"]["approval_request_status"]
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "approval_request"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_current_dossier_suivi: {
        Args: { p_creance_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "dossier_suivi"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_prestataire_for_current_user: {
        Args: { p_nom: string }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      fail_checkout_provisioning: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_retryable: boolean
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_key: string | null
          checkout_provisioning_attempts: number
          checkout_provisioning_error_code: string | null
          checkout_provisioning_status: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id: string
          created_at: string
          echec_code: string | null
          echec_message: string | null
          etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          id: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id: string | null
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id: string | null
          stripe_checkout_idempotency_key: string | null
          stripe_checkout_session_expires_at: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tentative_paiement"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_prestataire_connect_provisioning: {
        Args: {
          p_error_code: string
          p_operation_key: string
          p_prestataire_id: string
          p_retryable: boolean
        }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      flush_stripe_connect_audit_outbox: {
        Args: { p_operation_key: string; p_prestataire_id: string }
        Returns: {
          action: string
          created_at: string
          delivered_at: string | null
          id: string
          operation_key: string
          prestataire_id: string
          status: Database["public"]["Enums"]["stripe_connect_audit_outbox_status"]
          stripe_account_id: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_connect_audit_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_dossier_suivi_transition_allowed: {
        Args: {
          p_creance_etat: Database["public"]["Enums"]["creance_etat"]
          p_from: Database["public"]["Enums"]["dossier_suivi_etat"]
          p_to: Database["public"]["Enums"]["dossier_suivi_etat"]
        }
        Returns: boolean
      }
      mark_stripe_webhook_event_status: {
        Args: {
          p_attempt: number
          p_error_code?: string
          p_event_id: string
          p_lease_token: string
          p_retry_delay_seconds?: number
          p_status: Database["public"]["Enums"]["webhook_processing_status"]
        }
        Returns: {
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string | null
          processed_at: string | null
          processing_attempts: number
          processing_status: Database["public"]["Enums"]["webhook_processing_status"]
          received_at: string
          stripe_connected_account_id: string | null
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "processed_webhook_event"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      normalize_creance_devise: { Args: { p_devise: string }; Returns: string }
      normalize_creance_montant: {
        Args: { p_montant: number }
        Returns: number
      }
      normalize_person_name: { Args: { p_nom: string }; Returns: string }
      open_payment_receivable: { Args: { p_creance_id: string }; Returns: Json }
      purge_expired_public_rate_limits: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      recalculate_creance_settlement: {
        Args: { p_creance_id: string }
        Returns: Json
      }
      record_charge_dispute_opened: {
        Args: {
          p_connected_account_id: string
          p_dispute_id: string
          p_lease_token: string
          p_payment_intent_id: string
          p_processing_attempt: number
          p_reason: string
          p_stripe_event_id: string
        }
        Returns: Json
      }
      renew_stripe_webhook_event_lease: {
        Args: {
          p_attempt: number
          p_event_id: string
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: {
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string | null
          processed_at: string | null
          processing_attempts: number
          processing_status: Database["public"]["Enums"]["webhook_processing_status"]
          received_at: string
          stripe_connected_account_id: string | null
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "processed_webhook_event"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_verified_stripe_customer_binding: {
        Args: {
          p_client_payeur_id: string
          p_prestataire_id: string
          p_sidian_environment: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
        }
        Returns: {
          client_payeur_id: string
          created_at: string
          id: string
          prestataire_id: string
          status: Database["public"]["Enums"]["stripe_customer_binding_status"]
          stripe_account_id: string
          stripe_customer_id: string
          superseded_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_customer_binding"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_current_prestataire_id: { Args: never; Returns: string }
      resolve_payment_intent_tentative: {
        Args: {
          p_connected_account_id: string
          p_payment_intent_id: string
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_key: string | null
          checkout_provisioning_attempts: number
          checkout_provisioning_error_code: string | null
          checkout_provisioning_status: Database["public"]["Enums"]["stripe_checkout_provisioning_status"]
          creance_id: string
          created_at: string
          echec_code: string | null
          echec_message: string | null
          etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          id: string
          montant: number
          moyen: Database["public"]["Enums"]["tentative_paiement_moyen"] | null
          payment_link_id: string | null
          source: Database["public"]["Enums"]["tentative_paiement_source"]
          stripe_account_id: string | null
          stripe_checkout_idempotency_key: string | null
          stripe_checkout_session_expires_at: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tentative_paiement"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_payment_link_by_token_hash: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      resolve_payment_status_by_checkout_session_id: {
        Args: { p_checkout_session_id: string }
        Returns: Json
      }
      revoke_payment_link: {
        Args: { p_payment_link_id: string }
        Returns: {
          creance_id: string
          created_at: string
          id: string
          revoked_at: string | null
          status: Database["public"]["Enums"]["payment_link_status"]
          token_hash: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_link"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_stripe_customer_binding: {
        Args: { p_client_payeur_id: string; p_prestataire_id: string }
        Returns: {
          client_payeur_id: string
          created_at: string
          id: string
          prestataire_id: string
          status: Database["public"]["Enums"]["stripe_customer_binding_status"]
          stripe_account_id: string
          stripe_customer_id: string
          superseded_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_customer_binding"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      service_role_healthcheck: { Args: never; Returns: boolean }
      set_default_payment_authorization: {
        Args: { p_authorization_id: string }
        Returns: {
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
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_intent_id: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_authorization"
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
      sidian_table_authenticated_privileges: {
        Args: { p_table: string }
        Returns: Json
      }
      sync_prestataire_stripe_projection: {
        Args: {
          p_charges_enabled: boolean
          p_currently_due: Json
          p_details_submitted: boolean
          p_disabled_reason: string
          p_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          p_past_due: Json
          p_payouts_enabled: boolean
          p_pending_verification: Json
          p_prestataire_id: string
          p_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          p_stripe_account_id: string
        }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      update_current_client_payeur: {
        Args: { p_email: string; p_id: string; p_nom: string }
        Returns: {
          archived_at: string | null
          created_at: string
          creation_key: string
          email: string
          historique_paiements_reguliers: number
          id: string
          nom: string
          prestataire_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_payeur"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_current_creance_draft: {
        Args: {
          p_client_payeur_id: string
          p_date_echeance: string
          p_devise?: string
          p_id: string
          p_libelle?: string
          p_montant: number
          p_reference_externe?: string
        }
        Returns: {
          archived_at: string | null
          client_payeur_id: string
          created_at: string
          creation_key: string
          date_echeance: string
          devise: string
          etat: Database["public"]["Enums"]["creance_etat"]
          id: string
          libelle: string | null
          montant: number
          origine: Database["public"]["Enums"]["creance_origine"]
          prestataire_id: string
          ready_for_collection_at: string | null
          reference_externe: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "creance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_current_dossier_suivi: {
        Args: {
          p_creance_id: string
          p_escalation_reason: string
          p_next_action_at: string
          p_target_state: Database["public"]["Enums"]["dossier_suivi_etat"]
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "dossier_suivi"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_current_prestataire_name: {
        Args: { p_nom: string }
        Returns: {
          created_at: string
          early_access_price_locked_until: string | null
          email: string
          id: string
          nom: string
          onboarding_profile_completed_at: string | null
          platform_fee_basis_points: number
          pricing_version: string
          profil_agent_defaut: Database["public"]["Enums"]["profil_agent_defaut"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_connect_attempts: number
          stripe_connect_idempotency_key: string | null
          stripe_connect_last_error_code: string | null
          stripe_connect_lease_expires_at: string | null
          stripe_connect_operation_key: string | null
          stripe_connect_provisioning_status: Database["public"]["Enums"]["stripe_connect_provisioning_status"]
          stripe_connect_provisioning_updated_at: string | null
          stripe_details_submitted: boolean
          stripe_disabled_reason: string | null
          stripe_onboarding_status: Database["public"]["Enums"]["stripe_onboarding_status"]
          stripe_payouts_enabled: boolean
          stripe_requirements_currently_due: Json
          stripe_requirements_past_due: Json
          stripe_requirements_pending_verification: Json
          stripe_sepa_debit_payments_status: Database["public"]["Enums"]["stripe_capability_status"]
          stripe_status_synced_at: string | null
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
      payment_link_status: "active" | "revoked"
      profil_agent_defaut: "controle" | "delegation"
      public_rate_limit_category:
        | "link_resolution_ip"
        | "link_resolution_token"
        | "checkout_creation_ip"
        | "checkout_new_operation_link"
        | "auth_signup_ip"
        | "auth_signup_email"
        | "auth_signin_ip"
        | "auth_signin_email"
        | "auth_password_reset_ip"
        | "auth_password_reset_email"
        | "auth_password_update_ip"
        | "auth_password_update_user"
        | "auth_callback_ip"
        | "auth_callback_code"
        | "stripe_webhook_ip"
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
      stripe_capability_status: "inactive" | "pending" | "active"
      stripe_checkout_provisioning_status:
        | "not_started"
        | "creating"
        | "created"
        | "failed_retryable"
        | "failed_terminal"
      stripe_connect_audit_outbox_status: "pending" | "delivered"
      stripe_connect_provisioning_status:
        | "not_started"
        | "creating"
        | "created"
        | "failed_retryable"
        | "failed_terminal"
      stripe_customer_binding_status: "active" | "superseded"
      stripe_onboarding_status:
        | "non_commence"
        | "configuration_commencee"
        | "informations_requises"
        | "verification_en_cours"
        | "paiements_actives"
        | "paiements_indisponibles"
        | "action_requise"
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
      webhook_processing_status:
        | "received"
        | "processing"
        | "processed"
        | "failed_retryable"
        | "failed_terminal"
        | "ignored"
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
      payment_link_status: ["active", "revoked"],
      profil_agent_defaut: ["controle", "delegation"],
      public_rate_limit_category: [
        "link_resolution_ip",
        "link_resolution_token",
        "checkout_creation_ip",
        "checkout_new_operation_link",
        "auth_signup_ip",
        "auth_signup_email",
        "auth_signin_ip",
        "auth_signin_email",
        "auth_password_reset_ip",
        "auth_password_reset_email",
        "auth_password_update_ip",
        "auth_password_update_user",
        "auth_callback_ip",
        "auth_callback_code",
        "stripe_webhook_ip",
      ],
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
      stripe_capability_status: ["inactive", "pending", "active"],
      stripe_checkout_provisioning_status: [
        "not_started",
        "creating",
        "created",
        "failed_retryable",
        "failed_terminal",
      ],
      stripe_connect_audit_outbox_status: ["pending", "delivered"],
      stripe_connect_provisioning_status: [
        "not_started",
        "creating",
        "created",
        "failed_retryable",
        "failed_terminal",
      ],
      stripe_customer_binding_status: ["active", "superseded"],
      stripe_onboarding_status: [
        "non_commence",
        "configuration_commencee",
        "informations_requises",
        "verification_en_cours",
        "paiements_actives",
        "paiements_indisponibles",
        "action_requise",
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
      webhook_processing_status: [
        "received",
        "processing",
        "processed",
        "failed_retryable",
        "failed_terminal",
        "ignored",
      ],
    },
  },
} as const

