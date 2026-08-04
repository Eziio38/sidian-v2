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
      agent_audit_events: {
        Row: {
          actor_id: string
          actor_type: string
          audit_id: string
          correlation_id: string
          decision: string
          event_payload: Json
          executor_id: string | null
          mode: string | null
          occurred_at: string
          output_hash: string | null
          params_hash: string | null
          reason_code: string | null
          recorded_at: string
          requested_autonomy_level: number | null
          resource_id: string | null
          resource_kind: string | null
          result_status: string
          schema_version: string
          tenant_id: string
          tool_id: string | null
          tool_version: string | null
        }
        Insert: {
          actor_id: string
          actor_type: string
          audit_id: string
          correlation_id: string
          decision: string
          event_payload: Json
          executor_id?: string | null
          mode?: string | null
          occurred_at: string
          output_hash?: string | null
          params_hash?: string | null
          reason_code?: string | null
          recorded_at?: string
          requested_autonomy_level?: number | null
          resource_id?: string | null
          resource_kind?: string | null
          result_status: string
          schema_version: string
          tenant_id: string
          tool_id?: string | null
          tool_version?: string | null
        }
        Update: {
          actor_id?: string
          actor_type?: string
          audit_id?: string
          correlation_id?: string
          decision?: string
          event_payload?: Json
          executor_id?: string | null
          mode?: string | null
          occurred_at?: string
          output_hash?: string | null
          params_hash?: string | null
          reason_code?: string | null
          recorded_at?: string
          requested_autonomy_level?: number | null
          resource_id?: string | null
          resource_kind?: string | null
          result_status?: string
          schema_version?: string
          tenant_id?: string
          tool_id?: string | null
          tool_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_human_approvals: {
        Row: {
          approval_id: string
          consumed_at: string | null
          consumed_by_correlation_id: string | null
          consumed_idempotency_key_hash: string | null
          created_at: string
          decided_at: string | null
          decided_by_actor_id: string | null
          decision_reason_code: string | null
          expires_at: string
          mode: string
          params_hash: string
          request_fingerprint: string
          requested_at: string
          requested_autonomy_level: number
          requester_actor_id: string
          requester_actor_type: string
          resource_id: string | null
          resource_kind: string | null
          status: string
          tenant_id: string
          tool_id: string
          tool_version: string
          updated_at: string
        }
        Insert: {
          approval_id?: string
          consumed_at?: string | null
          consumed_by_correlation_id?: string | null
          consumed_idempotency_key_hash?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_actor_id?: string | null
          decision_reason_code?: string | null
          expires_at: string
          mode: string
          params_hash: string
          request_fingerprint: string
          requested_at: string
          requested_autonomy_level: number
          requester_actor_id: string
          requester_actor_type: string
          resource_id?: string | null
          resource_kind?: string | null
          status: string
          tenant_id: string
          tool_id: string
          tool_version: string
          updated_at?: string
        }
        Update: {
          approval_id?: string
          consumed_at?: string | null
          consumed_by_correlation_id?: string | null
          consumed_idempotency_key_hash?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_actor_id?: string | null
          decision_reason_code?: string | null
          expires_at?: string
          mode?: string
          params_hash?: string
          request_fingerprint?: string
          requested_at?: string
          requested_autonomy_level?: number
          requester_actor_id?: string
          requester_actor_type?: string
          resource_id?: string | null
          resource_kind?: string | null
          status?: string
          tenant_id?: string
          tool_id?: string
          tool_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_human_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_idempotency_records: {
        Row: {
          completed_at: string | null
          correlation_id: string
          created_at: string
          expires_at: string
          failure_code: string | null
          id: string
          idempotency_key: string
          mode: string
          owner_token_hash: string | null
          request_fingerprint: string
          resource_id: string | null
          resource_kind: string | null
          started_at: string
          status: string
          tenant_id: string
          terminal_result: Json | null
          terminal_result_hash: string | null
          tool_id: string
          tool_version: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          expires_at: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          mode: string
          owner_token_hash?: string | null
          request_fingerprint: string
          resource_id?: string | null
          resource_kind?: string | null
          started_at: string
          status: string
          tenant_id: string
          terminal_result?: Json | null
          terminal_result_hash?: string | null
          tool_id: string
          tool_version: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          expires_at?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          mode?: string
          owner_token_hash?: string | null
          request_fingerprint?: string
          resource_id?: string | null
          resource_kind?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          terminal_result?: Json | null
          terminal_result_hash?: string | null
          tool_id?: string
          tool_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_idempotency_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_protection_drafts: {
        Row: {
          actor_id: string
          attachments: Json
          cancelled_at: string | null
          client_creation_key: string | null
          client_payeur_id: string | null
          confirmation_nonce: string | null
          confirmed_at: string | null
          conversation_id: string | null
          creance_creation_key: string | null
          creance_id: string | null
          created_at: string
          draft_id: string
          expires_at: string
          fields: Json
          missing_fields: string[]
          open_ambiguities: Json
          pending_question: string | null
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          attachments?: Json
          cancelled_at?: string | null
          client_creation_key?: string | null
          client_payeur_id?: string | null
          confirmation_nonce?: string | null
          confirmed_at?: string | null
          conversation_id?: string | null
          creance_creation_key?: string | null
          creance_id?: string | null
          created_at?: string
          draft_id?: string
          expires_at: string
          fields?: Json
          missing_fields?: string[]
          open_ambiguities?: Json
          pending_question?: string | null
          state: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          attachments?: Json
          cancelled_at?: string | null
          client_creation_key?: string | null
          client_payeur_id?: string | null
          confirmation_nonce?: string | null
          confirmed_at?: string | null
          conversation_id?: string | null
          creance_creation_key?: string | null
          creance_id?: string | null
          created_at?: string
          draft_id?: string
          expires_at?: string
          fields?: Json
          missing_fields?: string[]
          open_ambiguities?: Json
          pending_question?: string | null
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_protection_drafts_client_payeur_id_fkey"
            columns: ["client_payeur_id"]
            isOneToOne: false
            referencedRelation: "client_payeur"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_protection_drafts_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_protection_drafts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
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
      communication_channel: {
        Row: {
          activated_at: string | null
          created_at: string
          display_name: string
          id: string
          is_default: boolean
          prestataire_id: string
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_ref: string
          public_metadata: Json
          revoked_at: string | null
          status: Database["public"]["Enums"]["communication_channel_status"]
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_default?: boolean
          prestataire_id: string
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_ref: string
          public_metadata?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["communication_channel_status"]
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_default?: boolean
          prestataire_id?: string
          provider_kind?: Database["public"]["Enums"]["communication_provider_kind"]
          provider_ref?: string
          public_metadata?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["communication_channel_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_channel_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_inbound_messages: {
        Row: {
          action_key: string | null
          business_command_id: string | null
          channel_id: string | null
          correlated_outbound_message_id: string | null
          created_at: string
          failed_at: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          interaction_kind: string
          normalized_text: string | null
          payload_snapshot: Json
          processed_at: string | null
          processing_status: Database["public"]["Enums"]["communication_inbound_processing_status"]
          provider_event_id: string
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string
          received_at: string
          reply_to_provider_message_id: string | null
          sender_reference: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          action_key?: string | null
          business_command_id?: string | null
          channel_id?: string | null
          correlated_outbound_message_id?: string | null
          created_at?: string
          failed_at?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          interaction_kind: string
          normalized_text?: string | null
          payload_snapshot?: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["communication_inbound_processing_status"]
          provider_event_id: string
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string
          received_at?: string
          reply_to_provider_message_id?: string | null
          sender_reference: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          action_key?: string | null
          business_command_id?: string | null
          channel_id?: string | null
          correlated_outbound_message_id?: string | null
          created_at?: string
          failed_at?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          interaction_kind?: string
          normalized_text?: string | null
          payload_snapshot?: Json
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["communication_inbound_processing_status"]
          provider_event_id?: string
          provider_kind?: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id?: string
          received_at?: string
          reply_to_provider_message_id?: string | null
          sender_reference?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_inbound_message_correlated_outbound_message__fkey"
            columns: ["correlated_outbound_message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "communication_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_inbound_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_interaction_sessions: {
        Row: {
          attempt_count: number
          business_entity_id: string
          business_entity_type: string
          cancelled_at: string | null
          channel_id: string
          completed_at: string | null
          created_at: string
          expected_input_kind: string
          expires_at: string
          guide_id: string
          id: string
          inbound_message_id: string
          max_attempts: number
          outbound_message_id: string
          session_kind: Database["public"]["Enums"]["communication_interaction_session_kind"]
          status: Database["public"]["Enums"]["communication_interaction_session_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          business_entity_id: string
          business_entity_type: string
          cancelled_at?: string | null
          channel_id: string
          completed_at?: string | null
          created_at?: string
          expected_input_kind: string
          expires_at: string
          guide_id: string
          id?: string
          inbound_message_id: string
          max_attempts?: number
          outbound_message_id: string
          session_kind: Database["public"]["Enums"]["communication_interaction_session_kind"]
          status?: Database["public"]["Enums"]["communication_interaction_session_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          business_entity_id?: string
          business_entity_type?: string
          cancelled_at?: string | null
          channel_id?: string
          completed_at?: string | null
          created_at?: string
          expected_input_kind?: string
          expires_at?: string
          guide_id?: string
          id?: string
          inbound_message_id?: string
          max_attempts?: number
          outbound_message_id?: string
          session_kind?: Database["public"]["Enums"]["communication_interaction_session_kind"]
          status?: Database["public"]["Enums"]["communication_interaction_session_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_interaction_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "communication_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_interaction_sessions_inbound_message_id_fkey"
            columns: ["inbound_message_id"]
            isOneToOne: false
            referencedRelation: "communication_inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_interaction_sessions_outbound_message_id_fkey"
            columns: ["outbound_message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_interaction_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_messages: {
        Row: {
          attempt_count: number
          channel_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["communication_message_direction"]
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_kind: string
          next_attempt_at: string | null
          payload_snapshot: Json
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          recipient_reference: string
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_message_status"]
          template_key: string | null
          template_locale: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel_id: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["communication_message_direction"]
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_kind: string
          next_attempt_at?: string | null
          payload_snapshot?: Json
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          recipient_reference: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_message_status"]
          template_key?: string | null
          template_locale?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["communication_message_direction"]
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_kind?: string
          next_attempt_at?: string | null
          payload_snapshot?: Json
          provider_kind?: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          recipient_reference?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_message_status"]
          template_key?: string | null
          template_locale?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "communication_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_webhook_events: {
        Row: {
          communication_message_id: string | null
          created_at: string
          dedupe_key: string
          id: string
          payload_snapshot: Json
          processed_at: string | null
          processing_error: string | null
          processing_status: Database["public"]["Enums"]["communication_webhook_processing_status"]
          provider_event_id: string | null
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          received_at: string
        }
        Insert: {
          communication_message_id?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          payload_snapshot?: Json
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["communication_webhook_processing_status"]
          provider_event_id?: string | null
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          received_at?: string
        }
        Update: {
          communication_message_id?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          payload_snapshot?: Json
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["communication_webhook_processing_status"]
          provider_event_id?: string | null
          provider_kind?: Database["public"]["Enums"]["communication_provider_kind"]
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_webhook_events_communication_message_id_fkey"
            columns: ["communication_message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
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
          project_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_payeur_id?: string | null
          creance_id?: string | null
          created_at?: string
          id?: string
          prestataire_id: string
          project_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_payeur_id?: string | null
          creance_id?: string | null
          created_at?: string
          id?: string
          prestataire_id?: string
          project_id?: string | null
          title?: string | null
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
          {
            foreignKeyName: "conversation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "conversation_project"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_project: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          prestataire_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          prestataire_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          prestataire_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_project_prestataire_id_fkey"
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
      document: {
        Row: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          checksum?: string | null
          creance_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status?: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          checksum?: string | null
          creance_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type?: string
          original_filename?: string
          prestataire_id?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_prestataire_id_fkey"
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
      email_outbox: {
        Row: {
          attempt_count: number
          body_html: string
          body_text: string
          created_at: string
          dead_lettered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          next_attempt_at: string | null
          processed_at: string | null
          provider_kind: string
          provider_message_id: string | null
          queued_at: string
          recipient_email: string
          recipient_email_hash: string
          recipient_name: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subject: string
          template_key: Database["public"]["Enums"]["email_template_key"]
          template_locale: string
          tenant_id: string
          updated_at: string
          variables_snapshot: Json
        }
        Insert: {
          attempt_count?: number
          body_html: string
          body_text: string
          created_at?: string
          dead_lettered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          processed_at?: string | null
          provider_kind?: string
          provider_message_id?: string | null
          queued_at?: string
          recipient_email: string
          recipient_email_hash: string
          recipient_name?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject: string
          template_key: Database["public"]["Enums"]["email_template_key"]
          template_locale?: string
          tenant_id: string
          updated_at?: string
          variables_snapshot?: Json
        }
        Update: {
          attempt_count?: number
          body_html?: string
          body_text?: string
          created_at?: string
          dead_lettered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          processed_at?: string | null
          provider_kind?: string
          provider_message_id?: string | null
          queued_at?: string
          recipient_email?: string
          recipient_email_hash?: string
          recipient_name?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string
          template_key?: Database["public"]["Enums"]["email_template_key"]
          template_locale?: string
          tenant_id?: string
          updated_at?: string
          variables_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_payment_confirmation_state: {
        Row: {
          amount_due_cents: number
          amount_received_cents: number
          auto_debit_neutralized: boolean
          confirmed_at: string | null
          confirmed_by_guide_id: string | null
          created_at: string
          currency: string
          id: string
          last_business_command_id: string | null
          last_inbound_message_id: string | null
          occurrence_id: string
          protection_id: string
          source_outbound_message_id: string | null
          state: Database["public"]["Enums"]["guide_payment_confirmation_status"]
          tenant_id: string
          updated_at: string
          verification_initiated_at: string | null
        }
        Insert: {
          amount_due_cents: number
          amount_received_cents?: number
          auto_debit_neutralized?: boolean
          confirmed_at?: string | null
          confirmed_by_guide_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          last_business_command_id?: string | null
          last_inbound_message_id?: string | null
          occurrence_id: string
          protection_id: string
          source_outbound_message_id?: string | null
          state?: Database["public"]["Enums"]["guide_payment_confirmation_status"]
          tenant_id: string
          updated_at?: string
          verification_initiated_at?: string | null
        }
        Update: {
          amount_due_cents?: number
          amount_received_cents?: number
          auto_debit_neutralized?: boolean
          confirmed_at?: string | null
          confirmed_by_guide_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          last_business_command_id?: string | null
          last_inbound_message_id?: string | null
          occurrence_id?: string
          protection_id?: string
          source_outbound_message_id?: string | null
          state?: Database["public"]["Enums"]["guide_payment_confirmation_status"]
          tenant_id?: string
          updated_at?: string
          verification_initiated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guide_payment_confirmation_stat_source_outbound_message_id_fkey"
            columns: ["source_outbound_message_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_payment_confirmation_state_last_inbound_message_id_fkey"
            columns: ["last_inbound_message_id"]
            isOneToOne: false
            referencedRelation: "communication_inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_payment_confirmation_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_budget_counter: {
        Row: {
          created_at: string
          expires_at: string
          request_count: number
          scope_fingerprint: string
          token_count: number
          updated_at: string
          window_kind: string
          window_start: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          request_count?: number
          scope_fingerprint: string
          token_count?: number
          updated_at?: string
          window_kind: string
          window_start: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          request_count?: number
          scope_fingerprint?: string
          token_count?: number
          updated_at?: string
          window_kind?: string
          window_start?: string
        }
        Relationships: []
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
      notification_preference: {
        Row: {
          created_at: string
          email_payment_failed: boolean
          email_reminder_before_due: boolean
          prestataire_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_payment_failed?: boolean
          email_reminder_before_due?: boolean
          prestataire_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_payment_failed?: boolean
          email_reminder_before_due?: boolean
          prestataire_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preference_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: true
            referencedRelation: "prestataire"
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
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        Insert: {
          accepted_at?: string | null
          authorization_channel?: string | null
          authorization_text_version?: string | null
          authorized_at?: string | null
          client_payeur_id: string
          created_at?: string
          etat?: Database["public"]["Enums"]["payment_authorization_etat"]
          id?: string
          is_default?: boolean
          legacy_incomplete?: boolean
          prestataire_id: string
          proposal_neutralized_at?: string | null
          public_token_expires_at?: string | null
          public_token_hash?: string | null
          reconsidered_from_authorization_id?: string | null
          resume_as_default?: boolean
          revoked_at?: string | null
          setup_lease_expires_at?: string | null
          setup_lease_token?: string | null
          setup_operation_key?: string | null
          setup_provisioning_attempts?: number
          setup_provisioning_error_code?: string | null
          setup_provisioning_status?: string
          source_tentative_paiement_id?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_mandate_id?: string | null
          stripe_mandate_status?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_checkout_session_id?: string | null
          stripe_setup_idempotency_key?: string | null
          stripe_setup_intent_id?: string | null
          stripe_setup_session_expires_at?: string | null
          suspension_reason?: string | null
          type?:
            | Database["public"]["Enums"]["payment_authorization_type"]
            | null
        }
        Update: {
          accepted_at?: string | null
          authorization_channel?: string | null
          authorization_text_version?: string | null
          authorized_at?: string | null
          client_payeur_id?: string
          created_at?: string
          etat?: Database["public"]["Enums"]["payment_authorization_etat"]
          id?: string
          is_default?: boolean
          legacy_incomplete?: boolean
          prestataire_id?: string
          proposal_neutralized_at?: string | null
          public_token_expires_at?: string | null
          public_token_hash?: string | null
          reconsidered_from_authorization_id?: string | null
          resume_as_default?: boolean
          revoked_at?: string | null
          setup_lease_expires_at?: string | null
          setup_lease_token?: string | null
          setup_operation_key?: string | null
          setup_provisioning_attempts?: number
          setup_provisioning_error_code?: string | null
          setup_provisioning_status?: string
          source_tentative_paiement_id?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_mandate_id?: string | null
          stripe_mandate_status?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_checkout_session_id?: string | null
          stripe_setup_idempotency_key?: string | null
          stripe_setup_intent_id?: string | null
          stripe_setup_session_expires_at?: string | null
          suspension_reason?: string | null
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
          {
            foreignKeyName: "payment_authorization_reconsidered_from_authorization_id_fkey"
            columns: ["reconsidered_from_authorization_id"]
            isOneToOne: false
            referencedRelation: "payment_authorization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_authorization_source_tentative_paiement_id_fkey"
            columns: ["source_tentative_paiement_id"]
            isOneToOne: false
            referencedRelation: "tentative_paiement"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_execution_job: {
        Row: {
          amount_cents: number
          attempt_count: number
          correlation_id: string | null
          creance_id: string
          created_at: string
          currency: string
          failure_code: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          prestataire_id: string
          source: Database["public"]["Enums"]["payment_execution_job_source"]
          status: Database["public"]["Enums"]["payment_execution_job_status"]
          stripe_payment_intent_id: string | null
          tentative_paiement_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempt_count?: number
          correlation_id?: string | null
          creance_id: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          lease_expires_at?: string | null
          lease_token?: string | null
          prestataire_id: string
          source: Database["public"]["Enums"]["payment_execution_job_source"]
          status?: Database["public"]["Enums"]["payment_execution_job_status"]
          stripe_payment_intent_id?: string | null
          tentative_paiement_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempt_count?: number
          correlation_id?: string | null
          creance_id?: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          prestataire_id?: string
          source?: Database["public"]["Enums"]["payment_execution_job_source"]
          status?: Database["public"]["Enums"]["payment_execution_job_status"]
          stripe_payment_intent_id?: string | null
          tentative_paiement_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_execution_job_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_execution_job_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_execution_job_tentative_paiement_id_fkey"
            columns: ["tentative_paiement_id"]
            isOneToOne: false
            referencedRelation: "tentative_paiement"
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
      payment_reconciliation_issue: {
        Row: {
          approval_request_id: string | null
          creance_id: string
          created_at: string
          id: string
          prestataire_id: string
          reason: string
          reconciliation_key: string
          tentative_paiement_id: string | null
        }
        Insert: {
          approval_request_id?: string | null
          creance_id: string
          created_at?: string
          id?: string
          prestataire_id: string
          reason: string
          reconciliation_key: string
          tentative_paiement_id?: string | null
        }
        Update: {
          approval_request_id?: string | null
          creance_id?: string
          created_at?: string
          id?: string
          prestataire_id?: string
          reason?: string
          reconciliation_key?: string
          tentative_paiement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_issue_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: true
            referencedRelation: "approval_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_issue_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_issue_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_issue_tentative_paiement_id_fkey"
            columns: ["tentative_paiement_id"]
            isOneToOne: false
            referencedRelation: "tentative_paiement"
            referencedColumns: ["id"]
          },
        ]
      }
      prestataire: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          anonymised_at?: string | null
          closed_at?: string | null
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
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          anonymised_at?: string | null
          closed_at?: string | null
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
          theme_preference?: Database["public"]["Enums"]["theme_preference"]
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
      runtime_job: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          creance_id: string
          created_at: string
          dossier_suivi_id: string | null
          id: string
          idempotency_key: string
          job_kind: Database["public"]["Enums"]["runtime_job_kind"]
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          payload: Json
          policy_version: string
          prestataire_id: string
          scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
          status: Database["public"]["Enums"]["runtime_job_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          creance_id: string
          created_at?: string
          dossier_suivi_id?: string | null
          id?: string
          idempotency_key: string
          job_kind: Database["public"]["Enums"]["runtime_job_kind"]
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          payload?: Json
          policy_version: string
          prestataire_id: string
          scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
          status?: Database["public"]["Enums"]["runtime_job_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          creance_id?: string
          created_at?: string
          dossier_suivi_id?: string | null
          id?: string
          idempotency_key?: string
          job_kind?: Database["public"]["Enums"]["runtime_job_kind"]
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          payload?: Json
          policy_version?: string
          prestataire_id?: string
          scanner_kind?: Database["public"]["Enums"]["runtime_scanner_kind"]
          status?: Database["public"]["Enums"]["runtime_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runtime_job_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runtime_job_dossier_suivi_id_fkey"
            columns: ["dossier_suivi_id"]
            isOneToOne: false
            referencedRelation: "dossier_suivi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runtime_job_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: false
            referencedRelation: "prestataire"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_scan_lease: {
        Row: {
          claimed_at: string | null
          completed_at: string | null
          creance_id: string
          created_at: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          occurrence_key: string
          policy_version: string
          scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
          status: Database["public"]["Enums"]["runtime_scan_lease_status"]
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          completed_at?: string | null
          creance_id: string
          created_at?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          occurrence_key: string
          policy_version: string
          scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
          status?: Database["public"]["Enums"]["runtime_scan_lease_status"]
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          completed_at?: string | null
          creance_id?: string
          created_at?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          occurrence_key?: string
          policy_version?: string
          scanner_kind?: Database["public"]["Enums"]["runtime_scanner_kind"]
          status?: Database["public"]["Enums"]["runtime_scan_lease_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runtime_scan_lease_creance_id_fkey"
            columns: ["creance_id"]
            isOneToOne: false
            referencedRelation: "creance"
            referencedColumns: ["id"]
          },
        ]
      }
      sidian_subscription: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          last_payment_failed_at: string | null
          last_subscription_event_at: string | null
          last_subscription_event_id: string | null
          prestataire_id: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_status: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          last_payment_failed_at?: string | null
          last_subscription_event_at?: string | null
          last_subscription_event_id?: string | null
          prestataire_id: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_status?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          last_payment_failed_at?: string | null
          last_subscription_event_at?: string | null
          last_subscription_event_id?: string | null
          prestataire_id?: string
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_status?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sidian_subscription_prestataire_id_fkey"
            columns: ["prestataire_id"]
            isOneToOne: true
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
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
          automatic_execution_guard_version?: string | null
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
          payment_authorization_id?: string | null
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
          automatic_execution_guard_version?: string | null
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
          payment_authorization_id?: string | null
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
            foreignKeyName: "tentative_paiement_payment_authorization_id_fkey"
            columns: ["payment_authorization_id"]
            isOneToOne: false
            referencedRelation: "payment_authorization"
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
      agent_human_approval_row_payload: {
        Args: {
          p_row: Database["public"]["Tables"]["agent_human_approvals"]["Row"]
        }
        Returns: Json
      }
      agent_idempotency_json_has_forbidden_key: {
        Args: { p_value: Json }
        Returns: boolean
      }
      agent_idempotency_terminal_result_is_sanitized: {
        Args: { p_value: Json }
        Returns: boolean
      }
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
      apply_charge_dispute_created_effects: {
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
      apply_checkout_session_completed_setup: {
        Args: {
          p_checkout_session_id: string
          p_connected_account_id: string
          p_customer_id: string
          p_lease_token: string
          p_processing_attempt: number
          p_setup_intent_id: string
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
      apply_checkout_session_expired_setup: {
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
      apply_mandate_updated_authorization: {
        Args: {
          p_connected_account_id: string
          p_customer_id: string
          p_lease_token: string
          p_mandate_id: string
          p_mandate_status: string
          p_payment_method_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
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
      apply_payment_method_detached_authorization: {
        Args: {
          p_connected_account_id: string
          p_lease_token: string
          p_payment_method_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
        }
        Returns: Json
      }
      apply_safe_eur_payment_reconciliation: {
        Args: {
          p_creance_id: string
          p_effect_type: string
          p_observation: Json
          p_requester_user_id: string
          p_sidian_environment: string
          p_tentative_id: string
        }
        Returns: Json
      }
      apply_setup_intent_failed_authorization: {
        Args: {
          p_authorization_id: string
          p_authorization_text_version: string
          p_connected_account_id: string
          p_customer_id: string
          p_failure_code: string
          p_lease_token: string
          p_processing_attempt: number
          p_setup_intent_id: string
          p_stripe_event_id: string
        }
        Returns: Json
      }
      apply_setup_intent_succeeded_authorization: {
        Args: {
          p_authorization_id: string
          p_authorization_text_version: string
          p_connected_account_id: string
          p_customer_id: string
          p_lease_token: string
          p_mandate_id: string
          p_mandate_status: string
          p_payment_method_id: string
          p_payment_method_type: string
          p_processing_attempt: number
          p_setup_intent_id: string
          p_stripe_event_id: string
        }
        Returns: Json
      }
      apply_sidian_subscription_event: {
        Args: {
          p_cancel_at_period_end?: boolean
          p_current_period_end?: string
          p_early_access_lock_months?: number
          p_event_created_at: string
          p_event_type: string
          p_stripe_customer_id: string
          p_stripe_event_id: string
          p_stripe_price_id?: string
          p_stripe_status: string
          p_stripe_subscription_id: string
        }
        Returns: Json
      }
      apply_sidian_subscription_payment_failure: {
        Args: {
          p_event_created_at: string
          p_stripe_customer_id: string
          p_stripe_event_id: string
          p_stripe_invoice_id: string
          p_stripe_subscription_id?: string
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
      bind_sidian_subscription_customer: {
        Args: { p_prestataire_id: string; p_stripe_customer_id: string }
        Returns: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          last_payment_failed_at: string | null
          last_subscription_event_at: string | null
          last_subscription_event_id: string | null
          prestataire_id: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_status: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sidian_subscription"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_agent_protection_draft: {
        Args: {
          p_actor_id: string
          p_draft_id: string
          p_now?: string
          p_tenant_id: string
        }
        Returns: {
          actor_id: string
          attachments: Json
          cancelled_at: string | null
          client_creation_key: string | null
          client_payeur_id: string | null
          confirmation_nonce: string | null
          confirmed_at: string | null
          conversation_id: string | null
          creance_creation_key: string | null
          creance_id: string | null
          created_at: string
          draft_id: string
          expires_at: string
          fields: Json
          missing_fields: string[]
          open_ambiguities: Json
          pending_question: string | null
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_protection_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_current_payment_receivable: {
        Args: { p_creance_id: string }
        Returns: Json
      }
      canonicalize_email: { Args: { p_email: string }; Returns: string }
      claim_automatic_payment_attempt: {
        Args: {
          p_amount_cents: number
          p_authorization_id: string
          p_creance_id: string
          p_guard_version?: string
          p_idempotency_key: string
          p_lease_seconds?: number
          p_prestataire_id: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
        }
        Returns: Json
      }
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
      claim_communication_outbound_batch: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_max_attempts?: number
        }
        Returns: {
          attempt_count: number
          channel_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["communication_message_direction"]
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_kind: string
          next_attempt_at: string | null
          payload_snapshot: Json
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          recipient_reference: string
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_message_status"]
          template_key: string | null
          template_locale: string | null
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "communication_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_current_prestataire_connect_provisioning: {
        Args: { p_lease_seconds?: number }
        Returns: {
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_email_outbox_batch: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempt_count: number
          body_html: string
          body_text: string
          created_at: string
          dead_lettered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          next_attempt_at: string | null
          processed_at: string | null
          provider_kind: string
          provider_message_id: string | null
          queued_at: string
          recipient_email: string
          recipient_email_hash: string
          recipient_name: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subject: string
          template_key: Database["public"]["Enums"]["email_template_key"]
          template_locale: string
          tenant_id: string
          updated_at: string
          variables_snapshot: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_idempotency_key: {
        Args: {
          p_correlation_id: string
          p_idempotency_key: string
          p_mode: string
          p_now?: string
          p_owner_token_hash: string
          p_request_fingerprint: string
          p_resource_id: string
          p_resource_kind: string
          p_tenant_id: string
          p_tool_id: string
          p_tool_version: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      claim_payment_authorization_setup: {
        Args: {
          p_authorization_text_version: string
          p_lease_seconds?: number
          p_public_token_hash: string
          p_source_checkout_session_id: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
        }
        Returns: Json
      }
      claim_payment_execution_job: {
        Args: { p_job_id?: string; p_lease_seconds?: number }
        Returns: Json
      }
      claim_runtime_jobs: {
        Args: {
          p_batch_size: number
          p_job_kinds?: Database["public"]["Enums"]["runtime_job_kind"][]
          p_lease_seconds: number
          p_now: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          creance_id: string
          created_at: string
          dossier_suivi_id: string | null
          id: string
          idempotency_key: string
          job_kind: Database["public"]["Enums"]["runtime_job_kind"]
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          payload: Json
          policy_version: string
          prestataire_id: string
          scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
          status: Database["public"]["Enums"]["runtime_job_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "runtime_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_runtime_scan_leases: {
        Args: {
          p_batch_size: number
          p_creance_ids: string[]
          p_lease_seconds: number
          p_now: string
          p_occurrence_keys: string[]
          p_scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
        }
        Returns: {
          creance_id: string
          lease_expires_at: string
          lease_token: string
          occurrence_key: string
        }[]
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
      close_current_account: { Args: never; Returns: Json }
      complete_automatic_payment_attempt: {
        Args: {
          p_application_fee_amount: number
          p_lease_token: string
          p_local_etat: Database["public"]["Enums"]["tentative_paiement_etat"]
          p_stripe_account_id: string
          p_stripe_customer_id: string
          p_stripe_payment_intent_id: string
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
      complete_communication_outbound_claim: {
        Args: {
          p_accepted_at?: string
          p_lease_token: string
          p_message_id: string
          p_provider_message_id: string
        }
        Returns: {
          attempt_count: number
          channel_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["communication_message_direction"]
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_kind: string
          next_attempt_at: string | null
          payload_snapshot: Json
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          recipient_reference: string
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_message_status"]
          template_key: string | null
          template_locale: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_idempotency_record: {
        Args: {
          p_completed_at?: string
          p_owner_token_hash: string
          p_record_id: string
          p_terminal_result: Json
          p_terminal_result_hash: string
        }
        Returns: Json
      }
      complete_payment_authorization_setup: {
        Args: {
          p_authorization_id: string
          p_lease_token: string
          p_session_expires_at: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
          p_stripe_setup_checkout_session_id: string
          p_stripe_setup_intent_id: string
        }
        Returns: {
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_authorization"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_payment_execution_job: {
        Args: {
          p_failure_code?: string
          p_job_id: string
          p_lease_token: string
          p_outcome: string
          p_stripe_payment_intent_id?: string
          p_tentative_paiement_id?: string
        }
        Returns: {
          amount_cents: number
          attempt_count: number
          correlation_id: string | null
          creance_id: string
          created_at: string
          currency: string
          failure_code: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          prestataire_id: string
          source: Database["public"]["Enums"]["payment_execution_job_source"]
          status: Database["public"]["Enums"]["payment_execution_job_status"]
          stripe_payment_intent_id: string | null
          tentative_paiement_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_execution_job"
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
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_runtime_job: {
        Args: { p_job_id: string; p_lease_token: string; p_now?: string }
        Returns: boolean
      }
      complete_runtime_scan_lease: {
        Args: {
          p_creance_id: string
          p_lease_token: string
          p_now?: string
          p_occurrence_key: string
          p_scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
        }
        Returns: boolean
      }
      configure_current_prestataire_profile: {
        Args: {
          p_nom: string
          p_profil_agent: Database["public"]["Enums"]["profil_agent_defaut"]
        }
        Returns: {
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_agent_protection_draft: {
        Args: {
          p_actor_id: string
          p_confirmation_nonce: string
          p_draft_id: string
          p_now?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      confirm_document_upload: {
        Args: { p_checksum?: string; p_document_id: string }
        Returns: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "document"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_human_approval: {
        Args: {
          p_approval_id: string
          p_correlation_id: string
          p_idempotency_key_hash?: string
          p_mode: string
          p_now?: string
          p_params_hash: string
          p_request_fingerprint: string
          p_requested_autonomy_level: number
          p_resource_id: string
          p_resource_kind: string
          p_tenant_id: string
          p_tool_id: string
          p_tool_version: string
        }
        Returns: Json
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
      create_human_approval: {
        Args: {
          p_expires_at?: string
          p_mode: string
          p_now?: string
          p_params_hash: string
          p_request_fingerprint: string
          p_requested_autonomy_level: number
          p_requester_actor_id: string
          p_requester_actor_type: string
          p_resource_id: string
          p_resource_kind: string
          p_tenant_id: string
          p_tool_id: string
          p_tool_version: string
          p_ttl_seconds?: number
        }
        Returns: Json
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
      decide_human_approval: {
        Args: {
          p_approval_id: string
          p_decided_by_actor_id: string
          p_decision: string
          p_decision_reason_code?: string
          p_now?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      decline_payment_authorization_proposal: {
        Args: {
          p_public_token_hash: string
          p_source_checkout_session_id: string
        }
        Returns: Json
      }
      document_allowed_mime_types: { Args: never; Returns: string[] }
      document_max_size_bytes: { Args: never; Returns: number }
      document_mime_allowed: { Args: { p_mime: string }; Returns: boolean }
      drain_stripe_connect_audit_outbox_batch: {
        Args: { p_limit?: number }
        Returns: number
      }
      enqueue_payment_execution_job: {
        Args: {
          p_amount_cents: number
          p_correlation_id?: string
          p_creance_id: string
          p_currency: string
          p_idempotency_key: string
          p_prestataire_id: string
          p_source: Database["public"]["Enums"]["payment_execution_job_source"]
        }
        Returns: {
          amount_cents: number
          attempt_count: number
          correlation_id: string | null
          creance_id: string
          created_at: string
          currency: string
          failure_code: string | null
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          prestataire_id: string
          source: Database["public"]["Enums"]["payment_execution_job_source"]
          status: Database["public"]["Enums"]["payment_execution_job_status"]
          stripe_payment_intent_id: string | null
          tentative_paiement_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_execution_job"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_runtime_job: {
        Args: {
          p_available_at?: string
          p_creance_id: string
          p_dossier_suivi_id: string
          p_idempotency_key: string
          p_job_kind: Database["public"]["Enums"]["runtime_job_kind"]
          p_now?: string
          p_payload?: Json
          p_policy_version: string
          p_prestataire_id: string
          p_scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
        }
        Returns: Json
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
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_runtime_scan_leases: {
        Args: {
          p_creance_ids: string[]
          p_occurrence_keys: string[]
          p_policy_version: string
          p_scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
        }
        Returns: number
      }
      ensure_whatsapp_sidian_channel: {
        Args: { p_prestataire_id: string }
        Returns: {
          activated_at: string | null
          created_at: string
          display_name: string
          id: string
          is_default: boolean
          prestataire_id: string
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_ref: string
          public_metadata: Json
          revoked_at: string | null
          status: Database["public"]["Enums"]["communication_channel_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_channel"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      export_current_account_data: { Args: never; Returns: Json }
      fail_automatic_payment_attempt: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_retryable: boolean
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
      fail_checkout_provisioning: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_retryable: boolean
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
      fail_communication_outbound_claim: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_lease_token: string
          p_max_attempts?: number
          p_message_id: string
          p_retry_delay_seconds?: number
          p_retryable: boolean
        }
        Returns: {
          attempt_count: number
          channel_id: string
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["communication_message_direction"]
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_kind: string
          next_attempt_at: string | null
          payload_snapshot: Json
          provider_kind: Database["public"]["Enums"]["communication_provider_kind"]
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          recipient_reference: string
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_message_status"]
          template_key: string | null
          template_locale: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "communication_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_idempotency_record: {
        Args: {
          p_completed_at?: string
          p_failure_code: string
          p_owner_token_hash: string
          p_record_id: string
          p_terminal_result: Json
          p_terminal_result_hash: string
        }
        Returns: Json
      }
      fail_payment_authorization_setup: {
        Args: {
          p_authorization_id: string
          p_error_code: string
          p_lease_token: string
          p_retryable: boolean
        }
        Returns: {
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_authorization"
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
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_runtime_job: {
        Args: {
          p_backoff_base_seconds?: number
          p_error_code: string
          p_job_id: string
          p_lease_token: string
          p_max_attempts?: number
          p_now?: string
          p_retryable?: boolean
        }
        Returns: string
      }
      fail_runtime_scan_lease: {
        Args: {
          p_creance_id: string
          p_error_code?: string
          p_lease_token: string
          p_now?: string
          p_occurrence_key: string
          p_scanner_kind: Database["public"]["Enums"]["runtime_scanner_kind"]
        }
        Returns: boolean
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
      get_agent_protection_draft: {
        Args: { p_draft_id: string; p_now?: string; p_tenant_id: string }
        Returns: {
          actor_id: string
          attachments: Json
          cancelled_at: string | null
          client_creation_key: string | null
          client_payeur_id: string | null
          confirmation_nonce: string | null
          confirmed_at: string | null
          conversation_id: string | null
          creance_creation_key: string | null
          creance_id: string | null
          created_at: string
          draft_id: string
          expires_at: string
          fields: Json
          missing_fields: string[]
          open_ambiguities: Json
          pending_question: string | null
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_protection_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_current_document: {
        Args: { p_document_id: string }
        Returns: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "document"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_human_approval_status: {
        Args: { p_approval_id: string; p_now?: string; p_tenant_id: string }
        Returns: Json
      }
      invalidate_payment_authorization_setup_session: {
        Args: {
          p_authorization_id: string
          p_reason: string
          p_stripe_setup_checkout_session_id: string
        }
        Returns: {
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_authorization"
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
      list_current_documents: {
        Args: {
          p_creance_id?: string
          p_include_deleted?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "document"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      llm_budget_consume: {
        Args: {
          p_estimated_tokens: number
          p_max_requests_per_minute: number
          p_max_requests_per_scope_per_hour: number
          p_max_tokens_per_minute: number
          p_now?: string
          p_scope_fingerprint: string
        }
        Returns: Json
      }
      llm_budget_record_usage: {
        Args: { p_now?: string; p_tokens: number }
        Returns: number
      }
      load_automatic_payment_checklist: {
        Args: { p_creance_id: string; p_prestataire_id: string }
        Returns: Json
      }
      map_stripe_subscription_status: {
        Args: { p_stripe_status: string }
        Returns: Database["public"]["Enums"]["subscription_status"]
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
      neutralize_unexposed_authorization_proposal: {
        Args: {
          p_checkout_lease_token: string
          p_public_token_hash: string
          p_reason: string
          p_tentative_id: string
        }
        Returns: Json
      }
      normalize_creance_devise: { Args: { p_devise: string }; Returns: string }
      normalize_creance_montant: {
        Args: { p_montant: number }
        Returns: number
      }
      normalize_person_name: { Args: { p_nom: string }; Returns: string }
      open_payment_receivable: { Args: { p_creance_id: string }; Returns: Json }
      prepare_payment_authorization_proposal: {
        Args: {
          p_authorization_text_version: string
          p_public_token_expires_at: string
          p_public_token_hash: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      prepare_reconsidered_authorization_proposal: {
        Args: {
          p_authorization_text_version: string
          p_payment_link_token_hash: string
          p_public_token_expires_at: string
          p_public_token_hash: string
          p_refused_authorization_id: string
          p_stripe_account_id: string
          p_stripe_customer_id: string
        }
        Returns: Json
      }
      purge_abandoned_document_uploads: {
        Args: { p_limit?: number; p_older_than_hours?: number }
        Returns: {
          id: string
          storage_path: string
        }[]
      }
      purge_expired_llm_budget_counters: {
        Args: { p_batch_size?: number; p_now?: string }
        Returns: number
      }
      purge_expired_public_rate_limits: {
        Args: { p_batch_size?: number; p_now?: string }
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
      register_document_upload: {
        Args: {
          p_creance_id?: string
          p_mime_type: string
          p_original_filename: string
          p_size_bytes: number
        }
        Returns: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "document"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_payment_reconciliation_human_required: {
        Args: {
          p_creance_id: string
          p_reason: string
          p_reconciliation_key: string
          p_requester_user_id: string
          p_tentative_id: string
        }
        Returns: Json
      }
      release_runtime_job: {
        Args: { p_job_id: string; p_lease_token: string; p_now?: string }
        Returns: boolean
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
      resolve_authorization_reconsideration_context: {
        Args: { p_payment_link_token_hash: string }
        Returns: Json
      }
      resolve_payment_authorization_public: {
        Args: {
          p_public_token_hash: string
          p_setup_checkout_session_id?: string
          p_source_checkout_session_id: string
        }
        Returns: Json
      }
      resolve_payment_authorization_setup_context: {
        Args: {
          p_public_token_hash: string
          p_source_checkout_session_id: string
        }
        Returns: Json
      }
      resolve_payment_intent_tentative: {
        Args: {
          p_connected_account_id: string
          p_payment_intent_id: string
          p_tentative_id: string
        }
        Returns: {
          application_fee_amount: number | null
          automatic_execution_guard_version: string | null
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
          payment_authorization_id: string | null
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
      resolve_setup_authorization: {
        Args: {
          p_authorization_id: string
          p_authorization_text_version: string
          p_connected_account_id: string
          p_customer_id: string
          p_setup_intent_id: string
        }
        Returns: {
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
          type: Database["public"]["Enums"]["payment_authorization_type"] | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_authorization"
          isOneToOne: true
          isSetofReturn: false
        }
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
      runtime_close_dossier: {
        Args: { p_creance_id: string; p_now?: string }
        Returns: string
      }
      runtime_job_backlog: {
        Args: { p_now?: string }
        Returns: {
          due_now: number
          job_kind: Database["public"]["Enums"]["runtime_job_kind"]
          oldest_created_at: string
          status: Database["public"]["Enums"]["runtime_job_status"]
          total: number
        }[]
      }
      runtime_load_job_context: {
        Args: { p_creance_id: string }
        Returns: Json
      }
      schema_migration_head: { Args: never; Returns: string }
      service_role_healthcheck: { Args: never; Returns: boolean }
      set_current_prestataire_notification_preferences: {
        Args: {
          p_email_payment_failed: boolean
          p_email_reminder_before_due: boolean
        }
        Returns: {
          created_at: string
          email_payment_failed: boolean
          email_reminder_before_due: boolean
          prestataire_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_preference"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_current_prestataire_theme_preference: {
        Args: { p_theme: Database["public"]["Enums"]["theme_preference"] }
        Returns: Database["public"]["Enums"]["theme_preference"]
      }
      set_default_payment_authorization: {
        Args: { p_authorization_id: string }
        Returns: {
          accepted_at: string | null
          authorization_channel: string | null
          authorization_text_version: string | null
          authorized_at: string | null
          client_payeur_id: string
          created_at: string
          etat: Database["public"]["Enums"]["payment_authorization_etat"]
          id: string
          is_default: boolean
          legacy_incomplete: boolean
          prestataire_id: string
          proposal_neutralized_at: string | null
          public_token_expires_at: string | null
          public_token_hash: string | null
          reconsidered_from_authorization_id: string | null
          resume_as_default: boolean
          revoked_at: string | null
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_key: string | null
          setup_provisioning_attempts: number
          setup_provisioning_error_code: string | null
          setup_provisioning_status: string
          source_tentative_paiement_id: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_mandate_id: string | null
          stripe_mandate_status: string | null
          stripe_payment_method_id: string | null
          stripe_setup_checkout_session_id: string | null
          stripe_setup_idempotency_key: string | null
          stripe_setup_intent_id: string | null
          stripe_setup_session_expires_at: string | null
          suspension_reason: string | null
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
      soft_delete_document: {
        Args: { p_document_id: string }
        Returns: {
          checksum: string | null
          creance_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          original_filename: string
          prestataire_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        SetofOptions: {
          from: "*"
          to: "document"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      suspend_payment_authorization_for_dispute: {
        Args: {
          p_connected_account_id: string
          p_dispute_id: string
          p_lease_token: string
          p_payment_intent_id: string
          p_processing_attempt: number
          p_stripe_event_id: string
        }
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
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
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
          account_status: Database["public"]["Enums"]["account_status"]
          anonymised_at: string | null
          closed_at: string | null
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
          theme_preference: Database["public"]["Enums"]["theme_preference"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prestataire"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_agent_protection_draft: {
        Args: {
          p_actor_id: string
          p_attachments: Json
          p_client_creation_key: string
          p_confirmation_nonce: string
          p_conversation_id: string
          p_creance_creation_key: string
          p_draft_id: string
          p_expires_at: string
          p_fields: Json
          p_missing_fields: string[]
          p_now?: string
          p_open_ambiguities: Json
          p_pending_question: string
          p_state: string
          p_tenant_id: string
        }
        Returns: {
          actor_id: string
          attachments: Json
          cancelled_at: string | null
          client_creation_key: string | null
          client_payeur_id: string | null
          confirmation_nonce: string | null
          confirmed_at: string | null
          conversation_id: string | null
          creance_creation_key: string | null
          creance_id: string | null
          created_at: string
          draft_id: string
          expires_at: string
          fields: Json
          missing_fields: string[]
          open_ambiguities: Json
          pending_question: string | null
          state: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_protection_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_status: "active" | "closed"
      actor_type: "human" | "sidian_agent" | "system" | "external_integration"
      approval_request_status: "pending" | "approved" | "rejected" | "expired"
      approval_request_type:
        | "formal_action"
        | "rule_change"
        | "depassement_seuil"
        | "autre"
      communication_channel_status:
        | "inactive"
        | "active"
        | "degraded"
        | "revoked"
      communication_inbound_processing_status:
        | "received"
        | "validated"
        | "correlated"
        | "processing"
        | "processed"
        | "unresolved"
        | "rejected"
        | "failed"
      communication_interaction_session_kind: "payment_partial_amount_collection"
      communication_interaction_session_status:
        | "awaiting_input"
        | "completed"
        | "expired"
        | "cancelled"
        | "failed"
      communication_message_direction: "outbound" | "inbound"
      communication_message_status:
        | "queued"
        | "sending"
        | "accepted"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "cancelled"
      communication_provider_kind:
        | "whatsapp_sidian"
        | "whatsapp_business_personal"
      communication_webhook_processing_status:
        | "received"
        | "processed"
        | "ignored"
        | "failed"
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
      document_status:
        | "pending_upload"
        | "stored"
        | "awaiting_processing"
        | "quarantined"
        | "deleted"
      dossier_suivi_etat:
        | "PREVENTION"
        | "ECHEANCE"
        | "SUIVI_AMIABLE"
        | "PAUSE_LITIGE"
        | "ATTENTE_CLIENT"
        | "ATTENTE_PRESTATAIRE"
        | "ESCALADE_HUMAINE"
        | "CLOS"
      email_delivery_status:
        | "queued"
        | "processing"
        | "sent"
        | "failed"
        | "dead_letter"
      email_template_key:
        | "reminder_before_due"
        | "reminder_after_due"
        | "payment_received"
        | "payment_failed"
        | "update_payment_method"
        | "cancellation_notice"
        | "partial_payment_notice"
        | "guide_internal_notice"
      guide_payment_confirmation_status:
        | "awaiting_guide_response"
        | "confirmed_received"
        | "confirmed_not_received"
        | "verification_in_progress"
        | "partially_received"
      message_canal: "email" | "interface" | "whatsapp"
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
      payment_execution_job_source: "scanner" | "agent_tool"
      payment_execution_job_status:
        | "pending"
        | "claimed"
        | "succeeded_pending_webhook"
        | "failed_terminal"
        | "failed_retryable"
        | "unknown"
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
      runtime_job_kind:
        | "prevention_notice"
        | "due_send_link"
        | "silence_escalate"
        | "closure_close_dossier"
        | "autopay_intent"
        | "retry_failed_notify"
      runtime_job_status:
        | "pending"
        | "claimed"
        | "completed"
        | "failed_retryable"
        | "failed_terminal"
        | "cancelled"
      runtime_scan_lease_status: "open" | "claimed" | "completed" | "failed"
      runtime_scanner_kind:
        | "prevention"
        | "due"
        | "silence"
        | "closure"
        | "auto_pay"
        | "retries"
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
      theme_preference: "light" | "dark" | "system"
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
      account_status: ["active", "closed"],
      actor_type: ["human", "sidian_agent", "system", "external_integration"],
      approval_request_status: ["pending", "approved", "rejected", "expired"],
      approval_request_type: [
        "formal_action",
        "rule_change",
        "depassement_seuil",
        "autre",
      ],
      communication_channel_status: [
        "inactive",
        "active",
        "degraded",
        "revoked",
      ],
      communication_inbound_processing_status: [
        "received",
        "validated",
        "correlated",
        "processing",
        "processed",
        "unresolved",
        "rejected",
        "failed",
      ],
      communication_interaction_session_kind: [
        "payment_partial_amount_collection",
      ],
      communication_interaction_session_status: [
        "awaiting_input",
        "completed",
        "expired",
        "cancelled",
        "failed",
      ],
      communication_message_direction: ["outbound", "inbound"],
      communication_message_status: [
        "queued",
        "sending",
        "accepted",
        "sent",
        "delivered",
        "read",
        "failed",
        "cancelled",
      ],
      communication_provider_kind: [
        "whatsapp_sidian",
        "whatsapp_business_personal",
      ],
      communication_webhook_processing_status: [
        "received",
        "processed",
        "ignored",
        "failed",
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
      document_status: [
        "pending_upload",
        "stored",
        "awaiting_processing",
        "quarantined",
        "deleted",
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
      email_delivery_status: [
        "queued",
        "processing",
        "sent",
        "failed",
        "dead_letter",
      ],
      email_template_key: [
        "reminder_before_due",
        "reminder_after_due",
        "payment_received",
        "payment_failed",
        "update_payment_method",
        "cancellation_notice",
        "partial_payment_notice",
        "guide_internal_notice",
      ],
      guide_payment_confirmation_status: [
        "awaiting_guide_response",
        "confirmed_received",
        "confirmed_not_received",
        "verification_in_progress",
        "partially_received",
      ],
      message_canal: ["email", "interface", "whatsapp"],
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
      payment_execution_job_source: ["scanner", "agent_tool"],
      payment_execution_job_status: [
        "pending",
        "claimed",
        "succeeded_pending_webhook",
        "failed_terminal",
        "failed_retryable",
        "unknown",
      ],
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
      runtime_job_kind: [
        "prevention_notice",
        "due_send_link",
        "silence_escalate",
        "closure_close_dossier",
        "autopay_intent",
        "retry_failed_notify",
      ],
      runtime_job_status: [
        "pending",
        "claimed",
        "completed",
        "failed_retryable",
        "failed_terminal",
        "cancelled",
      ],
      runtime_scan_lease_status: ["open", "claimed", "completed", "failed"],
      runtime_scanner_kind: [
        "prevention",
        "due",
        "silence",
        "closure",
        "auto_pay",
        "retries",
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
      theme_preference: ["light", "dark", "system"],
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

